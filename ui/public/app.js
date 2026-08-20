// HIGSGEN Studio — FinalCut風 NLE レイアウト + AI 可視化
const $ = (sel, el = document) => el.querySelector(sel);

const state = {
  engines: {},
  styles: {},
  balance: null,
  projects: [],
  slug: null,
  project: null,
  preview: null, // { kind, ... }
  selectedCut: null, // タイムラインで選択中のカット番号
  pollTimer: null,
};

// ---------- utils ----------
const api = async (path, opts = {}) => {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/session') showLogin();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
};

const showLogin = () => {
  $('#login').hidden = false;
  $('#login-key')?.focus();
};

const authenticate = async () => {
  const res = await fetch('/api/session');
  if (res.ok) return true;
  showLogin();
  return false;
};

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const toast = (msg) => {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
};

const fmtCr = (n) => Number(n).toLocaleString('ja-JP', { maximumFractionDigits: 2 });
const fmtTs = (ts) =>
  ts ? new Date(ts).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

// ---------- 最小 Markdown レンダラ ----------
const inlineMd = (s) =>
  esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');

const renderMd = (text) => {
  const lines = String(text ?? '').split('\n');
  const out = [];
  const listBuf = [];
  const tableBuf = [];
  const codeBuf = [];
  const flags = { code: false };
  const flushList = () => {
    if (listBuf.length === 0) return;
    out.push(`<ul>${listBuf.map((l) => `<li>${inlineMd(l)}</li>`).join('')}</ul>`);
    listBuf.length = 0;
  };
  const flushTable = () => {
    if (tableBuf.length === 0) return;
    const rows = tableBuf.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
    const html = rows
      .map((row, i) => {
        const cells = row.replace(/^\s*\||\|\s*$/g, '').split('|');
        const tag = i === 0 ? 'th' : 'td';
        return `<tr>${cells.map((c) => `<${tag}>${inlineMd(c.trim())}</${tag}>`).join('')}</tr>`;
      })
      .join('');
    out.push(`<table>${html}</table>`);
    tableBuf.length = 0;
  };
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (flags.code) { out.push(`<pre>${esc(codeBuf.join('\n'))}</pre>`); codeBuf.length = 0; }
      flags.code = !flags.code;
      continue;
    }
    if (flags.code) { codeBuf.push(line); continue; }
    if (/^\s*\|/.test(line)) { flushList(); tableBuf.push(line); continue; }
    flushTable();
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { flushList(); out.push(`<h${h[1].length}>${inlineMd(h[2])}</h${h[1].length}>`); continue; }
    if (/^\s*[-*]\s+/.test(line)) { listBuf.push(line.replace(/^\s*[-*]\s+/, '')); continue; }
    flushList();
    if (/^\s*>\s?/.test(line)) { out.push(`<blockquote>${inlineMd(line.replace(/^\s*>\s?/, ''))}</blockquote>`); continue; }
    if (line.trim() === '') { out.push(''); continue; }
    out.push(`<p>${inlineMd(line)}</p>`);
  }
  if (flags.code) out.push(`<pre>${esc(codeBuf.join('\n'))}</pre>`);
  flushList();
  flushTable();
  return out.join('\n');
};

// ---------- 残高 ----------
const renderBalance = () => {
  const el = $('#balance');
  const b = state.balance;
  if (!b || b.credits === null || b.credits === undefined) {
    el.innerHTML = '残高 <span class="num">—</span>';
    return;
  }
  const minCost = Math.min(...Object.values(state.engines).map((e) => e.estCost ?? Infinity));
  el.classList.toggle('low', b.credits < minCost);
  el.innerHTML = `残高 <span class="num">${fmtCr(b.credits)} cr</span><span class="asof">${fmtTs(b.updatedAt)} 時点</span>`;
};

const refreshBalance = async () => {
  try { state.balance = await api('/api/balance'); } catch { state.balance = null; }
  renderBalance();
};

// ---------- 絵コンテのカット解析（タイムライン用） ----------
const parseCuts = (md) => {
  if (!md || md.includes('{{')) return [];
  return md
    .split(/\n##\s+/)
    .filter((b) => /^Cut/i.test(b))
    .map((b) => ({
      num: b.match(/^Cut\s*0?(\d+)/i)?.[1] ?? '?',
      dur: Number(b.match(/\|\s*秒数\s*\|\s*([\d.]+)/)?.[1] ?? 0),
      scene: (b.match(/\|\s*シーン[^|]*\|\s*([^|\n]+)/)?.[1] ?? '').trim(),
      camera: (b.match(/\|\s*カメラ\s*\|\s*([^|\n]+)/)?.[1] ?? '').trim(),
      dialogue: (b.match(/\|\s*セリフ[^|]*\|\s*([^|\n]+)/)?.[1] ?? '').trim(),
    }))
    .filter((c) => c.dur > 0);
};

// ---------- プレビュー ----------
const mainVideoOf = (p) => {
  if (p.assets.out[0]) return { src: `/files/${p.slug}/out/${encodeURIComponent(p.assets.out[0])}`, label: `完成動画: ${p.assets.out[0]}` };
  if (p.assets.clips[0]) return { src: `/files/${p.slug}/assets/clips/${encodeURIComponent(p.assets.clips[0])}`, label: `本編クリップ: ${p.assets.clips[0]}` };
  return null;
};

const setPreview = (item) => {
  state.preview = item;
  const title = $('#preview-title');
  const body = $('#preview-body');
  if (!item) {
    title.textContent = 'プレビュー';
    body.innerHTML = '<p class="empty">左のライブラリから素材・ドキュメントを選択してください</p>';
    return;
  }
  if (item.kind === 'video') {
    title.textContent = `🎞 ${item.label}`;
    body.innerHTML = `<video id="preview-video" controls src="${item.src}"></video>`;
    bindTimelineSync();
  } else if (item.kind === 'image') {
    title.textContent = `🖼 ${item.label}`;
    body.innerHTML = `<img src="${item.src}" alt="${esc(item.label)}">`;
  } else if (item.kind === 'audio') {
    title.textContent = `🎵 ${item.label}`;
    body.innerHTML = `<audio controls src="${item.src}" style="width:100%"></audio>`;
  } else if (item.kind === 'doc') {
    title.textContent = `📄 ${item.label}`;
    body.innerHTML = `<div class="preview-doc">${renderMd(state.project?.artifacts?.[item.name] ?? '（未作成）')}</div>`;
  } else if (item.kind === 'history') {
    const r = item.record;
    title.textContent = `🕘 生成履歴: ${r.label ?? r.kind}`;
    const media = r.local
      ? r.kind === 'video'
        ? `<video id="preview-video" controls src="/files/${state.slug}/${r.local}"></video>`
        : r.kind === 'image'
          ? `<img src="/files/${state.slug}/${r.local}" alt="">`
          : ''
      : '';
    body.innerHTML = `${media}
      <div class="preview-meta">
        <span class="badge">${esc(r.kind)}</span>
        ${r.model ? `<span class="badge">${esc(r.model)}</span>` : ''}
        ${r.credits !== undefined ? `<span class="badge warn">${esc(fmtCr(r.credits))} cr</span>` : ''}
        ${r.job_id ? `<span class="badge">job: ${esc(r.job_id.slice(0, 8))}…</span>` : ''}
        <span class="note">${esc(fmtTs(r.ts))}</span>
      </div>
      ${r.note ? `<p class="note" style="align-self:stretch">${esc(r.note)}</p>` : ''}
      <div class="preview-prompt">${esc(r.prompt ?? '（プロンプト記録なし）')}</div>`;
  }
  document.querySelectorAll('.lib-item').forEach((li) => {
    li.classList.toggle('selected', li.dataset.key === item?.key);
  });
};

// ---------- 左: ライブラリ ----------
const DOC_ITEMS = [
  ['brief', '📋', 'ブリーフ（企画）'],
  ['story', '📖', 'ストーリー'],
  ['characters', '🧑‍🎨', 'キャラクター設計書'],
  ['storyboard', '🎬', '絵コンテ'],
  ['shotlist', '✍️', 'ショットリスト'],
  ['ledger', '📒', '生成台帳'],
];

const libMedia = (p, dir, files, kind, icon) =>
  files
    .map((f) => {
      const src = `/files/${p.slug}/${dir}/${encodeURIComponent(f)}`;
      const key = `${kind}:${dir}/${f}`;
      const thumb = kind === 'image' ? `<img class="thumb" src="${src}" loading="lazy">` : `<span class="licon">${icon}</span>`;
      return `<div class="lib-item" data-key="${esc(key)}" data-kind="${kind}" data-src="${esc(src)}" data-label="${esc(f)}">${thumb}<span class="lname">${esc(f)}</span></div>`;
    })
    .join('') || '<p class="note" style="padding-left:8px">なし</p>';

const renderBrowser = (p) => {
  const body = $('#browser-body');
  body.innerHTML = `
    <details class="lib-section" open>
      <summary>完成・本編</summary>
      ${libMedia(p, 'out', p.assets.out, 'video', '🎞')}
      ${libMedia(p, 'assets/clips', p.assets.clips, 'video', '🎞')}
    </details>
    <details class="lib-section" open>
      <summary>キャラクター</summary>
      ${libMedia(p, 'assets/characters', p.assets.characters, 'image', '🖼')}
    </details>
    <details class="lib-section">
      <summary>フレーム</summary>
      ${libMedia(p, 'assets/frames', p.assets.frames, 'image', '🖼')}
    </details>
    <details class="lib-section">
      <summary>音声</summary>
      ${libMedia(p, 'assets/audio', p.assets.audio, 'audio', '🎵')}
    </details>
    <details class="lib-section" open>
      <summary>ドキュメント</summary>
      ${DOC_ITEMS.map(([name, icon, label]) => {
        const done = p.artifacts[name] && !p.artifacts[name].includes('{{');
        return `<div class="lib-item" data-key="doc:${name}" data-kind="doc" data-name="${name}" data-label="${esc(label)}">
          <span class="licon">${icon}</span><span class="lname">${esc(label)}</span>
          ${done ? '<span class="badge ok">✓</span>' : '<span class="badge">雛形</span>'}
        </div>`;
      }).join('')}
    </details>`;

  body.querySelectorAll('.lib-item').forEach((li) => {
    li.addEventListener('click', () => {
      const { kind, src, label, name, key } = li.dataset;
      if (kind === 'doc') setPreview({ kind: 'doc', name, label, key });
      else setPreview({ kind, src, label, key });
    });
  });
};

// ---------- 右: AI パネル ----------
const FLOW_NODES = [
  { icon: '🎬', label: '企画', owner: 'Claude', phaseKey: 'brief' },
  { icon: '📝', label: 'ストーリー', owner: 'Claude', phaseKey: 'story' },
  { icon: '🧑‍🎨', label: 'キャラクター', owner: 'Codex→Higgsfield', phaseKey: 'characters' },
  { icon: '🎞', label: '絵コンテ', owner: 'Codex', phaseKey: 'storyboard' },
  { icon: '✍️', label: 'ショット', owner: 'Claude', phaseKey: 'shotlist' },
  { icon: '⚡', label: '動画生成', owner: 'Higgsfield', phaseKey: '_generation' },
  { icon: '🎉', label: '完成', owner: '', phaseKey: '_final' },
];

const charsAllApproved = (p) => {
  const entries = Object.values(p.approvals?.characters ?? {});
  return entries.length > 0 && entries.every((a) => a.status === 'approved');
};
const storyboardApproved = (p) => p.approvals?.storyboard?.status === 'approved';

const flowStatuses = (p) => {
  const phaseDone = (key) => p.phases.find((ph) => ph.key === key)?.status === 'done';
  return FLOW_NODES.map((node) => {
    if (node.phaseKey === '_generation') return p.generation !== 'missing' ? 'done' : 'todo';
    if (node.phaseKey === '_final') return p.generation === 'done' ? 'done' : 'todo';
    if (node.phaseKey === 'characters') return !phaseDone('characters') ? 'todo' : charsAllApproved(p) ? 'done' : 'review';
    if (node.phaseKey === 'storyboard') return !phaseDone('storyboard') ? 'todo' : storyboardApproved(p) ? 'done' : 'review';
    return phaseDone(node.phaseKey) ? 'done' : 'todo';
  });
};

const renderVFlow = (p) => {
  const statuses = flowStatuses(p);
  const activeIdx = statuses.findIndex((s) => s !== 'done');
  return `<div class="vflow">${FLOW_NODES.map((node, i) => {
    const st = statuses[i];
    const cls = st === 'done' ? 'done' : st === 'review' ? 'review' : i === activeIdx ? 'active' : '';
    const icon = st === 'done' ? '✓' : st === 'review' ? '👀' : node.icon;
    const stateBadge = st === 'review' ? '<span class="badge warn">承認待ち</span>' : '';
    const edge = i === 0 ? '' : `<div class="vflow-edge ${statuses[i - 1] === 'done' ? (st === 'done' ? 'done' : 'flowing') : ''}"></div>`;
    return `${edge}<div class="vflow-row ${cls}">
      <div class="vicon">${icon}</div>
      <span class="vlabel">${esc(node.label)}</span> ${stateBadge}
      <span class="vowner">${esc(node.owner)}</span>
    </div>`;
  }).join('')}</div>`;
};

const approvalBadge = (status) => {
  if (status === 'approved') return '<span class="badge ok">✔ 承認済み</span>';
  if (status === 'rejected') return '<span class="badge err">✗ 差し戻し中</span>';
  return '<span class="badge warn">承認待ち</span>';
};

const approvalCard = ({ type, name, title, status, feedback, mediaHtml, placeholder }) => `
  <div class="approval-card" data-type="${esc(type)}" data-name="${esc(name ?? '')}">
    <div class="approval-head"><strong>${esc(title)}</strong> ${approvalBadge(status)}</div>
    ${mediaHtml}
    ${feedback ? `<p class="note">フィードバック: ${esc(feedback)}</p>` : ''}
    <div class="actions">
      <button class="btn sm ok-btn" data-act="approved">✔ 承認</button>
      <button class="btn sm err-btn" data-act="rejected">✗ やり直し</button>
    </div>
    <div class="reject-form" hidden>
      <textarea placeholder="${esc(placeholder)}"></textarea>
      <button class="btn sm primary" data-act="send-reject">差し戻す</button>
    </div>
  </div>`;

const renderApprovalsSection = (p) => {
  const charEntries = Object.entries(p.approvals?.characters ?? {});
  const storyboardDone = p.phases.find((ph) => ph.key === 'storyboard')?.status === 'done';
  if (charEntries.length === 0 && !storyboardDone) return '';
  const charCards = charEntries
    .map(([name, a]) =>
      approvalCard({
        type: 'character', name, title: name, status: a.status, feedback: a.feedback,
        placeholder: '修正点（例: 髪を短く、服を赤系に）',
        mediaHtml: a.image ? `<img class="approval-img" src="/files/${p.slug}/${a.image}" data-preview="1" alt="${esc(name)}">` : '',
      }),
    )
    .join('');
  const sb = p.approvals?.storyboard ?? { status: 'pending', feedback: '' };
  const sbCard = storyboardDone
    ? approvalCard({
        type: 'storyboard', name: '', title: '絵コンテ', status: sb.status, feedback: sb.feedback,
        placeholder: '修正点（例: Cut3 を寄りに、ラストを長めに）',
        mediaHtml: '<span class="sb-open">📄 絵コンテをプレビューで確認 →</span>',
      })
    : '';
  return `<div class="ai-section"><h3>承認ゲート（Phase 5 の前提）</h3>${charCards}${sbCard}</div>`;
};

const bindApprovalHandlers = (p) => {
  document.querySelectorAll('.approval-card').forEach((card) => {
    const { type, name } = card.dataset;
    const label = type === 'storyboard' ? '絵コンテ' : `「${name}」`;
    const rejectForm = card.querySelector('.reject-form');
    card.querySelector('img[data-preview]')?.addEventListener('click', (ev) => {
      const a = p.approvals.characters[name];
      setPreview({ kind: 'image', src: `/files/${p.slug}/${a.image}`, label: name, key: `image:${a.image}` });
      ev.stopPropagation();
    });
    card.querySelector('.sb-open')?.addEventListener('click', () => {
      setPreview({ kind: 'doc', name: 'storyboard', label: '絵コンテ', key: 'doc:storyboard' });
    });
    card.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.act;
        if (act === 'rejected') { rejectForm.hidden = !rejectForm.hidden; return; }
        const status = act === 'send-reject' ? 'rejected' : 'approved';
        const feedback = act === 'send-reject' ? rejectForm.querySelector('textarea').value.trim() : '';
        try {
          await api(`/api/projects/${p.slug}/approvals`, { method: 'POST', body: JSON.stringify({ type, name, status, feedback }) });
          toast(status === 'approved' ? `${label}を承認しました` : `${label}を差し戻しました`);
          loadProject(p.slug, { keepPreview: true });
        } catch (e) { toast(`エラー: ${e.message}`); }
      });
    });
  });
};

const TOOL_ICONS = { higgsfield: '⚡', codex: '🤖', 'claude-fallback': '🧠' };
const TOOL_LABELS = { higgsfield: 'Higgsfield', codex: 'Codex CLI', 'claude-fallback': 'Claude 代行' };

const renderAiPanel = (p, runPrompt) => {
  const body = $('#ai-body');
  const statuses = flowStatuses(p);
  const activeIdx = statuses.findIndex((s) => s !== 'done');
  const nowText = p.rendering
    ? '<span class="spinner"></span>タイムライン編集を書き出し中（ffmpeg）…'
    : p.running
    ? '<span class="spinner"></span>パイプライン実行中（claude -p）… ログは下部'
    : activeIdx === -1
      ? '✅ 全フェーズ完了'
      : statuses[activeIdx] === 'review'
        ? `👀 ユーザーの承認待ち: ${FLOW_NODES[activeIdx].label}`
        : `⏸ 次の作業: ${FLOW_NODES[activeIdx].label}（担当: ${FLOW_NODES[activeIdx].owner || '—'}）`;

  const feed = [...(p.ledger ?? [])].reverse().slice(0, 30)
    .map((r, i) => `
      <div class="feed-item" data-idx="${(p.ledger.length - 1) - i}">
        <span class="ficon">${TOOL_ICONS[r.tool] ?? '•'}</span>
        <div class="fbody">
          <div class="flabel">${esc(r.label ?? r.kind)}</div>
          <div class="fmeta">
            <span>${esc(TOOL_LABELS[r.tool] ?? r.tool ?? '')}</span>
            ${r.credits !== undefined ? `<span>${esc(fmtCr(r.credits))} cr</span>` : ''}
            <span>${esc(fmtTs(r.ts))}</span>
          </div>
        </div>
      </div>`)
    .join('') || '<p class="note">まだ活動記録がありません</p>';

  const cost = state.engines[p.meta?.engine]?.estCost;
  body.innerHTML = `
    <div class="ai-section">
      <div class="ai-now ${p.running ? '' : 'idle'}">${nowText}</div>
    </div>
    <div class="ai-section"><h3>ワークフロー</h3>${renderVFlow(p)}</div>
    ${renderApprovalsSection(p)}
    <div class="ai-section runbox">
      <h3>パイプライン実行</h3>
      <p class="note">動画生成コスト目安: <strong>${cost ? fmtCr(cost) + ' cr' : '?'}</strong> ／ 残高 ${state.balance?.credits != null ? fmtCr(state.balance.credits) + ' cr' : '—'}</p>
      <pre id="run-prompt">${esc(runPrompt)}</pre>
      <div class="actions">
        <button id="btn-copy" class="btn sm">📋 指示文コピー</button>
        <button id="btn-run" class="btn sm primary" ${p.running ? 'disabled' : ''}>${p.running ? '実行中…' : '▶ ヘッドレス実行'}</button>
      </div>
      ${p.runLog ? `<div class="log" style="margin-top:8px">${esc(p.runLog.slice(-3000))}</div>` : ''}
    </div>
    <div class="ai-section"><h3>AI 活動履歴（クリックで詳細）</h3>${feed}</div>`;

  $('#btn-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(runPrompt);
    toast('コピーしました。Claude Code に貼り付けてください');
  });
  $('#btn-run').addEventListener('click', async () => {
    try {
      await api(`/api/projects/${p.slug}/run`, { method: 'POST' });
      toast('ヘッドレス実行を開始しました');
      loadProject(p.slug, { keepPreview: true });
    } catch (e) { toast(`エラー: ${e.message}`); }
  });
  body.querySelectorAll('.feed-item').forEach((el) => {
    el.addEventListener('click', () => {
      const record = p.ledger[Number(el.dataset.idx)];
      if (record) setPreview({ kind: 'history', record, key: `hist:${el.dataset.idx}` });
    });
  });
  bindApprovalHandlers(p);
};

// ---------- 下: タイムライン（編集機能つき） ----------
const cutStarts = (cuts) => {
  const starts = [];
  let acc = 0;
  for (const c of cuts) { starts.push(acc); acc += c.dur; }
  return starts;
};

const defaultEdit = () => ({ trimIn: 0, trimOut: 0, speed: 1, crop: { l: 0, r: 0, t: 0, b: 0 }, mute: false });
const editOf = (p, num) => {
  const saved = p.edits?.clips?.[num] ?? {};
  return { ...defaultEdit(), ...saved, crop: { ...defaultEdit().crop, ...(saved.crop ?? {}) } };
};
const hasEdit = (e) =>
  e.mute || e.speed !== 1 || e.trimIn > 0 || e.trimOut > 0 || e.crop.l + e.crop.r + e.crop.t + e.crop.b > 0;
const effDur = (c, e) => Math.max(0.2, (c.dur - e.trimIn - e.trimOut) / (e.speed || 1));
const editBadges = (e) =>
  [
    e.mute ? '🔇' : '',
    e.speed !== 1 ? `⏩${e.speed}x` : '',
    e.crop.l + e.crop.r + e.crop.t + e.crop.b > 0 ? '✂' : '',
    e.trimIn > 0 || e.trimOut > 0 ? '⏱' : '',
  ].filter(Boolean).join(' ');

const saveEdits = async (p, clips) => {
  await api(`/api/projects/${p.slug}/edits`, { method: 'POST', body: JSON.stringify({ clips }) });
  toast('編集を保存しました（書き出しで反映）');
  loadProject(p.slug, { keepPreview: true });
};

const renderTlToolbar = (p, cuts) => {
  const globalBtns = `
    <button id="btn-detach" class="btn sm" title="本編の音声トラックを assets/audio/main-audio.mp3 に抽出">🔊 音声を分離</button>
    <button id="btn-render" class="btn sm primary" ${p.rendering || cuts.length === 0 ? 'disabled' : ''} title="編集を適用した動画を out/ に書き出し">
      ${p.rendering ? '<span class="spinner"></span>書き出し中…' : '📤 編集を書き出し'}
    </button>`;

  if (state.selectedCut === null) {
    return `<div class="tl-toolbar"><span class="note">クリップをクリックで選択 → クロップ・速度・トリム・ミュートを編集</span>${globalBtns}</div>`;
  }
  const cut = cuts.find((c) => c.num === state.selectedCut);
  if (!cut) { state.selectedCut = null; return `<div class="tl-toolbar">${globalBtns}</div>`; }
  const e = editOf(p, cut.num);
  const speedOpts = [0.5, 0.75, 1, 1.25, 1.5, 2]
    .map((s) => `<option value="${s}" ${e.speed === s ? 'selected' : ''}>${s}x</option>`)
    .join('');
  return `<div class="tl-toolbar" data-cut="${esc(cut.num)}">
    <strong>Cut ${esc(cut.num)}</strong><span class="note">（${cut.dur}s → ${effDur(cut, e).toFixed(1)}s）</span>
    <label class="tb-field">速度 <select id="ed-speed">${speedOpts}</select></label>
    <label class="tb-field">IN <input id="ed-in" type="number" min="0" max="${cut.dur - 0.5}" step="0.1" value="${e.trimIn}">s</label>
    <label class="tb-field">OUT <input id="ed-out" type="number" min="0" max="${cut.dur - 0.5}" step="0.1" value="${e.trimOut}">s</label>
    <label class="tb-field">✂ 左<input id="ed-cl" type="number" min="0" max="45" step="1" value="${Math.round(e.crop.l * 100)}">%</label>
    <label class="tb-field">右<input id="ed-cr" type="number" min="0" max="45" step="1" value="${Math.round(e.crop.r * 100)}">%</label>
    <label class="tb-field">上<input id="ed-ct" type="number" min="0" max="45" step="1" value="${Math.round(e.crop.t * 100)}">%</label>
    <label class="tb-field">下<input id="ed-cb" type="number" min="0" max="45" step="1" value="${Math.round(e.crop.b * 100)}">%</label>
    <label class="tb-field"><input id="ed-mute" type="checkbox" ${e.mute ? 'checked' : ''}> 🔇 ミュート</label>
    <button id="ed-apply" class="btn sm primary">適用</button>
    <button id="ed-reset" class="btn sm">リセット</button>
    ${globalBtns}
  </div>`;
};

const bindTlToolbar = (p, cuts) => {
  $('#btn-detach')?.addEventListener('click', async () => {
    try {
      const r = await api(`/api/projects/${p.slug}/detach-audio`, { method: 'POST' });
      toast(`音声を分離しました: ${r.file}`);
      loadProject(p.slug, { keepPreview: true });
    } catch (e) { toast(`エラー: ${e.message}`); }
  });
  $('#btn-render')?.addEventListener('click', async () => {
    const starts = cutStarts(cuts);
    const segments = cuts
      .map((c, i) => {
        const e = editOf(p, c.num);
        return {
          start: starts[i] + e.trimIn,
          end: starts[i] + c.dur - e.trimOut,
          speed: e.speed,
          crop: e.crop,
          mute: e.mute,
        };
      })
      .filter((s) => s.end > s.start + 0.2);
    try {
      await api(`/api/projects/${p.slug}/render`, { method: 'POST', body: JSON.stringify({ segments }) });
      toast('書き出しを開始しました（完了すると out/ に表示されます）');
      loadProject(p.slug, { keepPreview: true });
    } catch (e) { toast(`エラー: ${e.message}`); }
  });
  const apply = $('#ed-apply');
  if (!apply) return;
  apply.addEventListener('click', () => {
    const num = state.selectedCut;
    const clips = { ...(p.edits?.clips ?? {}) };
    clips[num] = {
      speed: Number($('#ed-speed').value),
      trimIn: Math.max(0, Number($('#ed-in').value) || 0),
      trimOut: Math.max(0, Number($('#ed-out').value) || 0),
      crop: {
        l: (Number($('#ed-cl').value) || 0) / 100,
        r: (Number($('#ed-cr').value) || 0) / 100,
        t: (Number($('#ed-ct').value) || 0) / 100,
        b: (Number($('#ed-cb').value) || 0) / 100,
      },
      mute: $('#ed-mute').checked,
    };
    saveEdits(p, clips).catch((e) => toast(`エラー: ${e.message}`));
  });
  $('#ed-reset').addEventListener('click', () => {
    const clips = { ...(p.edits?.clips ?? {}) };
    delete clips[state.selectedCut];
    saveEdits(p, clips).catch((e) => toast(`エラー: ${e.message}`));
  });
};

const renderTimeline = (p) => {
  const body = $('#timeline-body');
  const cuts = parseCuts(p.artifacts.storyboard);
  const total = cuts.reduce((s, c) => s + c.dur, 0) || p.meta?.duration || 30;
  $('#timeline-title').textContent = `タイムライン — ${esc(p.meta?.title ?? p.slug)}（${total}秒 / ${cuts.length || '?'} カット / ${p.meta?.aspect ?? ''}）`;

  const ticks = [];
  for (let t = 0; t <= total; t += 5) {
    ticks.push(`<span class="tick" style="left:${(t / total) * 100}%">${t}s</span>`);
  }
  const starts = cutStarts(cuts);

  const videoClips = cuts.length
    ? cuts.map((c, i) => {
        const e = editOf(p, c.num);
        const badges = editBadges(e);
        const durLabel = hasEdit(e) && effDur(c, e) !== c.dur ? `${c.dur}s→${effDur(c, e).toFixed(1)}s` : `${c.dur}s`;
        const selected = state.selectedCut === c.num ? 'selected' : '';
        return `
        <div class="tl-clip video v${i % 6} ${selected}" style="flex-basis:${(c.dur / total) * 100}%" data-start="${starts[i]}" data-num="${esc(c.num)}" title="Cut ${c.num}: ${esc(c.scene)} / ${esc(c.camera)}">
          <div class="tc-title">Cut ${esc(c.num)} · ${durLabel} ${badges}</div>
          <div class="tc-sub">${esc(c.scene || c.camera)}</div>
        </div>`;
      }).join('')
    : `<div class="tl-clip video v0" style="flex-basis:100%" data-start="0"><div class="tc-title">本編 ${total}s</div><div class="tc-sub">絵コンテ未解析</div></div>`;

  const dialogueClips = cuts.length
    ? cuts.map((c, i) => {
        const muted = editOf(p, c.num).mute;
        return `
        <div class="tl-clip audio aud ${muted ? 'muted' : ''}" style="flex-basis:${(c.dur / total) * 100}%" data-start="${starts[i]}" data-num="${esc(c.num)}" title="${esc(c.dialogue)}">
          <div class="tc-sub">${muted ? '🔇 ' : ''}${esc(c.dialogue || '—')}</div>
        </div>`;
      }).join('')
    : '';

  const nativeAudio = p.meta?.nativeAudio
    ? `<div class="tl-clip audio bgm" style="flex-basis:100%"><div class="tc-sub">🔊 ネイティブ音声（セリフ・環境音 / ${esc(p.meta?.model ?? '')} 生成）</div></div>`
    : '';
  const audioFiles = p.assets.audio.length
    ? `<div class="tl-track"><div class="tl-track-label">🎵 A2 追加音声</div><div class="tl-lane">${p.assets.audio
        .map((f) => `<div class="tl-clip audio bgm" style="flex-basis:${100 / p.assets.audio.length}%"><div class="tc-sub">${esc(f)}</div></div>`)
        .join('')}</div></div>`
    : '';

  body.innerHTML = `
    ${renderTlToolbar(p, cuts)}
    <div class="tl-ruler">${ticks.join('')}</div>
    <div class="tl-track"><div class="tl-track-label">🎞 V1 映像</div><div class="tl-lane" id="v1-lane">${videoClips}</div></div>
    ${dialogueClips ? `<div class="tl-track"><div class="tl-track-label">💬 A1 セリフ</div><div class="tl-lane">${dialogueClips}</div></div>` : ''}
    ${nativeAudio ? `<div class="tl-track"><div class="tl-track-label">🔊 音声ベッド</div><div class="tl-lane">${nativeAudio}</div></div>` : ''}
    ${audioFiles}`;

  body.querySelectorAll('.tl-clip[data-start]').forEach((clip) => {
    clip.addEventListener('click', () => {
      if (clip.dataset.num) {
        state.selectedCut = clip.dataset.num;
        renderTimeline(p);
      }
      seekPreview(Number(clip.dataset.start));
    });
  });
  bindTlToolbar(p, cuts);
};

// タイムラインクリック → プレビューを頭出し
const seekPreview = (t) => {
  const p = state.project;
  const vid = $('#preview-video');
  const isMainLoaded = vid && state.preview?.kind === 'video';
  if (isMainLoaded) {
    vid.currentTime = t;
    vid.play().catch(() => {});
    return;
  }
  const main = mainVideoOf(p);
  if (!main) { toast('再生できる本編動画がまだありません'); return; }
  setPreview({ kind: 'video', src: main.src, label: main.label, key: `video:${main.src}` });
  const v = $('#preview-video');
  v.addEventListener('loadedmetadata', () => { v.currentTime = t; v.play().catch(() => {}); }, { once: true });
};

// 再生位置とタイムラインのハイライトを同期
const bindTimelineSync = () => {
  const vid = $('#preview-video');
  if (!vid) return;
  vid.addEventListener('timeupdate', () => {
    const t = vid.currentTime;
    document.querySelectorAll('#v1-lane .tl-clip').forEach((clip, i, all) => {
      const start = Number(clip.dataset.start);
      const next = all[i + 1] ? Number(all[i + 1].dataset.start) : Infinity;
      clip.classList.toggle('playing', t >= start && t < next);
    });
  });
};

// ---------- 新規プロジェクトモーダル ----------
const engineCostHtml = (engine) => {
  const cost = engine.estCost;
  if (!cost) return '';
  const credits = state.balance?.credits;
  const runs = credits != null ? Math.floor(credits / cost) : null;
  const runsHtml = runs === null ? '' : runs === 0
    ? '<span class="runs insufficient">⚠ 残高不足（生成不可）</span>'
    : `<span class="runs">残高で約 ${runs} 回生成可能</span>`;
  return `<span class="engine-cost">1回の生成 = <span class="cr">${fmtCr(cost)} cr</span>${runsHtml}</span>`;
};

const openModal = () => {
  const modal = $('#modal');
  const body = $('#modal-body');
  // おまかせを先頭に（既定選択）
  const engineEntries = Object.entries(state.engines).sort(([a], [b]) => (a === 'auto' ? -1 : b === 'auto' ? 1 : 0));
  const engineCards = engineEntries
    .map(([id, e], i) => `<label>
      <input type="radio" name="engine" value="${esc(id)}" ${i === 0 ? 'checked' : ''}>
      <strong>${esc(e.label.split(' — ')[0])}</strong> — 1回の生成で ${e.duration} 秒の動画を1本作成
      ${engineCostHtml(e)}
      <span class="desc">${esc(e.label.split(' — ')[1] ?? '')}（model: ${esc(e.model)}）</span>
    </label>`)
    .join('');
  const styleOptions = Object.entries(state.styles)
    .map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`)
    .join('');

  body.innerHTML = `
    <form id="new-form" class="form-grid">
      <label class="field full"><span class="name">タイトル *</span>
        <input type="text" name="title" required placeholder="例: 猫の宇宙飛行士、月でラーメン屋を開く">
      </label>
      <label class="field full"><span class="name">作りたい動画（依頼内容）*</span>
        <textarea name="request" required placeholder="どんなストーリー・キャラクター・雰囲気の動画を作りたいか自由に"></textarea>
      </label>
      <div class="field full">
        <span class="name">AI 動画エンジン *（カットごとの尺配分は AI にお任せ）</span>
        <div class="radio-cards">${engineCards}</div>
      </div>
      <label class="field"><span class="name">スタイル *</span><select name="style">${styleOptions}</select></label>
      <label class="field"><span class="name">ルック補足（任意）</span><input type="text" name="look" placeholder="例: 90年代セルアニメ風"></label>
      <label class="field"><span class="name">アスペクト比</span>
        <select name="aspect"><option value="16:9">16:9（横）</option><option value="9:16">9:16（縦）</option><option value="1:1">1:1</option></select>
      </label>
      <label class="field"><span class="name">言語</span>
        <select name="language"><option value="日本語">日本語</option><option value="英語">英語</option><option value="なし">なし</option></select>
      </label>
      <div class="field check-row full">
        <label title="おまかせモードのエンジン判定にも使われます"><input type="checkbox" name="dialogue" checked> セリフあり（キャラが話す）</label>
        <label><input type="checkbox" name="nativeAudio" checked> ネイティブ音声を生成</label>
        <label><input type="checkbox" name="narration"> ナレーションあり</label>
        <label class="field"><span class="name">クレジット上限</span><input type="number" name="creditLimit" value="100" min="10" style="width:90px"></label>
      </div>
      <div class="full"><button type="submit" class="btn primary">プロジェクト作成 → ブリーフ確定</button></div>
    </form>`;

  const form = $('#new-form');
  const applyLimit = () => {
    const sel = form.querySelector('input[name="engine"]:checked');
    form.creditLimit.value = state.engines[sel?.value]?.suggestedLimit ?? 100;
  };
  form.querySelectorAll('input[name="engine"]').forEach((r) => r.addEventListener('change', applyLimit));
  applyLimit();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    try {
      const { slug } = await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          title: f.title.value.trim(),
          request: f.request.value.trim(),
          engine: f.engine.value,
          style: f.style.value,
          look: f.look.value.trim(),
          aspect: f.aspect.value,
          language: f.language.value,
          dialogue: f.dialogue.checked,
          nativeAudio: f.nativeAudio.checked,
          narration: f.narration.checked,
          creditLimit: Number(f.creditLimit.value) || 100,
        }),
      });
      toast('プロジェクトを作成しました');
      modal.hidden = true;
      await refreshProjects();
      location.hash = `#/p/${slug}`;
    } catch (e) { toast(`エラー: ${e.message}`); }
  });
  modal.hidden = false;
};

// ---------- プロジェクト管理 ----------
const refreshProjects = async () => {
  const { projects } = await api('/api/projects');
  state.projects = projects;
  const sel = $('#project-select');
  sel.innerHTML = projects
    .map((p) => `<option value="${esc(p.slug)}" ${p.slug === state.slug ? 'selected' : ''}>${esc(p.meta?.title ?? p.slug)}${p.running ? '（実行中）' : ''}</option>`)
    .join('') || '<option value="">（プロジェクトなし）</option>';
};

const loadProject = async (slug, { keepPreview = false } = {}) => {
  clearTimeout(state.pollTimer);
  try {
    const { project, runPrompt } = await api(`/api/projects/${slug}`);
    const switched = state.slug !== slug;
    state.slug = slug;
    state.project = project;
    renderBrowser(project);
    renderAiPanel(project, runPrompt);
    renderTimeline(project);
    if (switched || (!keepPreview && !state.preview)) {
      const main = mainVideoOf(project);
      setPreview(main ? { kind: 'video', src: main.src, label: main.label, key: `video:${main.src}` } : null);
    }
    $('#project-select').value = slug;
    if (project.running || project.rendering) state.pollTimer = setTimeout(() => loadProject(slug, { keepPreview: true }), 4000);
  } catch (e) {
    $('#preview-body').innerHTML = `<p class="empty">読み込みエラー: ${esc(e.message)}</p>`;
  }
  refreshBalance().catch(() => {});
};

const route = async () => {
  await refreshProjects();
  const m = location.hash.match(/^#\/p\/([a-z0-9-]+)/);
  const slug = m?.[1] ?? state.projects[0]?.slug;
  if (slug) {
    await loadProject(slug);
  } else {
    openModal();
  }
};

const init = async () => {
  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const error = $('#login-error');
    error.textContent = '';
    try {
      await api('/api/session', { method: 'POST', body: JSON.stringify({ apiKey: $('#login-key').value }) });
      $('#login-key').value = '';
      $('#login').hidden = true;
      await startStudio();
    } catch (e) { error.textContent = e.message; }
  });
  if (await authenticate()) await startStudio();
};

const startStudio = async () => {
  const { engines, styles } = await api('/api/engines');
  state.engines = engines;
  state.styles = styles;
  await refreshBalance();
  $('#btn-new').addEventListener('click', openModal);
  $('#modal-close').addEventListener('click', () => { $('#modal').hidden = true; });
  $('#project-select').addEventListener('change', (ev) => { location.hash = `#/p/${ev.target.value}`; });
  window.addEventListener('hashchange', route);
  await route();
};

init();
