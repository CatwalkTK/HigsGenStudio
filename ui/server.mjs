// HIGSGEN UI サーバー（依存パッケージなし / Node 18+）
// 起動: node ui/server.mjs  → http://localhost:4649
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat, copyFile, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearSessionCookie,
  isAuthorized,
  isValidApiKey,
  sessionCookie,
} from './auth.mjs';

const UI_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(UI_DIR, '..');
const PROJECTS_DIR = path.join(ROOT, 'projects');
const TEMPLATES_DIR = path.join(ROOT, '.claude', 'skills', 'higsgen', 'templates');
const PUBLIC_DIR = path.join(UI_DIR, 'public');
const BALANCE_FILE = path.join(ROOT, 'state', 'balance.json');
const PORT = Number(process.env.PORT ?? 4649);
const API_KEY = process.env.HIGSGEN_API_KEY;
const SECURE_COOKIE = process.env.HIGSGEN_SECURE_COOKIE === 'true';

if (!API_KEY || API_KEY.length < 16) {
  throw new Error('HIGSGEN_API_KEY must be set to at least 16 characters');
}

// エンジン定義（Higgsfield MCP の実モデル仕様に基づく。1 生成 = 1 本の動画）
const ENGINES = {
  'seedance-2': {
    model: 'seedance_2_0',
    duration: 15,
    estCost: 67.5,
    suggestedLimit: 100,
    nativeAudio: true,
    label: 'Seedance 2.0 — 15秒 / 最大4K / 参照・ネイティブ音声対応 / 約67.5cr',
  },
  'seedance-2.5': {
    model: 'seedance_2_5',
    duration: 30,
    estCost: 195,
    suggestedLimit: 250,
    nativeAudio: true,
    label: 'Seedance 2.5 — 30秒 / 720p / omni-reference・ネイティブ音声対応 / 約195cr',
  },
  'minimax-h3': {
    model: 'minimax_h3',
    duration: 15,
    estCost: 60,
    suggestedLimit: 100,
    nativeAudio: false,
    label: 'MiniMax H3 — 15秒 / 2K高精細 / 参照対応・音声は別撮り合成 / 約60cr',
  },
  // 仮想エンジン: POST 時にセリフの有無で実エンジンに解決される
  auto: {
    virtual: true,
    model: '(自動選択)',
    duration: 15,
    estCost: null,
    suggestedLimit: 100,
    nativeAudio: null,
    label: 'おまかせ — 15秒 / セリフあり→Seedance 2.0（67.5cr・ネイティブ音声）・セリフなし→MiniMax H3（60cr・2K）を自動選択',
  },
};

const resolveAutoEngine = (dialogue) => (dialogue ? 'seedance-2' : 'minimax-h3');

const STYLE_KEYWORDS = {
  anime: 'anime style, cel shading, clean line art, vibrant colors, cinematic lighting, high detail',
  live: 'photorealistic, cinematic film still, shot on 35mm, natural skin texture, shallow depth of field',
  '3d': '3D stylized render, soft global illumination, subsurface scattering, cinematic composition',
};

const STYLE_LABELS = { anime: 'アニメ', live: '実写（フォトリアル）', '3d': '3Dスタイライズド' };

const PHASES = [
  { key: 'brief', file: 'brief.md', label: 'Phase 0 企画' },
  { key: 'story', file: 'story.md', label: 'Phase 1 ストーリー' },
  { key: 'characters', file: 'characters.md', label: 'Phase 2 キャラクター' },
  { key: 'storyboard', file: 'storyboard.md', label: 'Phase 3 絵コンテ' },
  { key: 'shotlist', file: 'shotlist.md', label: 'Phase 4 ショットプロンプト' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

// 実行中の headless ジョブ（slug → { proc, startedAt }）
const runningJobs = new Map();
// 実行中の書き出しジョブ（slug → { startedAt }）
const runningRenders = new Map();

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });

const isValidSlug = (slug) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);

const safeProjectPath = (slug, ...rest) => {
  if (!isValidSlug(slug)) return null;
  const p = path.join(PROJECTS_DIR, slug, ...rest);
  return p.startsWith(path.join(PROJECTS_DIR, slug)) ? p : null;
};

const readTextIfExists = async (p) => {
  try {
    return await readFile(p, 'utf-8');
  } catch {
    return null;
  }
};

const readJsonIfExists = async (p) => {
  const text = await readTextIfExists(p);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const listFiles = async (dir, exts) => {
  try {
    const entries = await readdir(dir);
    return entries
      .filter((f) => !f.startsWith('.') && exts.includes(path.extname(f).toLowerCase()))
      .sort();
  } catch {
    return [];
  }
};

// フェーズ状態: missing（未着手）/ template（雛形のまま）/ done（記入済み）
const phaseStatus = async (projectDir) => {
  const statuses = await Promise.all(
    PHASES.map(async (ph) => {
      const text = await readTextIfExists(path.join(projectDir, ph.file));
      if (text === null) return { ...ph, status: 'missing' };
      return { ...ph, status: text.includes('{{') ? 'template' : 'done' };
    }),
  );
  return statuses;
};

const projectSummary = async (slug) => {
  const dir = path.join(PROJECTS_DIR, slug);
  const meta = await readJsonIfExists(path.join(dir, 'meta.json'));
  const phases = await phaseStatus(dir);
  const clips = await listFiles(path.join(dir, 'assets', 'clips'), ['.mp4']);
  const finals = await listFiles(path.join(dir, 'out'), ['.mp4']);
  const generation = finals.length > 0 ? 'done' : clips.length > 0 ? 'partial' : 'missing';
  return { slug, meta, phases, generation, running: runningJobs.has(slug) };
};

const listProjects = async () => {
  try {
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    const slugs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
      .map((e) => e.name)
      .sort();
    return Promise.all(slugs.map(projectSummary));
  } catch {
    return [];
  }
};

const projectDetail = async (slug) => {
  const dir = path.join(PROJECTS_DIR, slug);
  const summary = await projectSummary(slug);
  const artifactNames = ['brief', 'story', 'characters', 'storyboard', 'shotlist', 'ledger'];
  const artifactEntries = await Promise.all(
    artifactNames.map(async (name) => [name, await readTextIfExists(path.join(dir, `${name}.md`))]),
  );
  const assets = {
    characters: await listFiles(path.join(dir, 'assets', 'characters'), ['.png', '.jpg', '.jpeg', '.webp']),
    frames: await listFiles(path.join(dir, 'assets', 'frames'), ['.png', '.jpg', '.jpeg', '.webp']),
    clips: await listFiles(path.join(dir, 'assets', 'clips'), ['.mp4']),
    audio: await listFiles(path.join(dir, 'assets', 'audio'), ['.mp3', '.wav']),
    out: await listFiles(path.join(dir, 'out'), ['.mp4']),
  };
  const runLog = await readTextIfExists(path.join(dir, '_ui', 'run.log'));
  const renderLog = await readTextIfExists(path.join(dir, '_ui', 'render.log'));
  const ledger = (await readJsonIfExists(path.join(dir, 'ledger.json'))) ?? [];
  const approvals = (await readJsonIfExists(path.join(dir, 'approvals.json'))) ?? { characters: {} };
  const edits = (await readJsonIfExists(path.join(dir, 'edits.json'))) ?? { clips: {} };
  return {
    ...summary,
    artifacts: Object.fromEntries(artifactEntries),
    assets,
    runLog,
    renderLog,
    ledger,
    approvals,
    edits,
    rendering: runningRenders.has(slug),
  };
};

const buildBrief = (p) => {
  const engine = ENGINES[p.engine];
  const cuts = Math.round(engine.duration / 5);
  return `# 企画ブリーフ — ${p.title}

- **作成日**: ${new Date().toISOString().slice(0, 10)}
- **ステータス**: confirmed（UI で確定済み）

## 依頼内容（原文）

> ${p.request.replace(/\n/g, '\n> ')}

## 確定事項

| 項目 | 値 | 確定/提案 |
|------|-----|----------|
| エンジン | ${engine.label}（model: \`${engine.model}\`） | 確定 |
${p.engineMode === 'auto' ? `| エンジン選択モード | **おまかせ**（セリフ${p.dialogue ? 'あり → Seedance 2.0' : 'なし → MiniMax H3'} と判定。Phase 1 でストーリー上セリフの有無が変わったら Claude がルールに従い再解決し brief/meta を更新する） | 確定 |\n` : ''}| 生成方式 | シングルジェネレーション（1 回の生成で完成尺の動画を 1 本作る） | 確定 |
| セリフ | ${p.dialogue ? 'あり（キャラクターが話す）' : 'なし'} | 確定 |
| 尺 | ${engine.duration} 秒（エンジンにより固定） | 確定 |
| スタイル | ${STYLE_LABELS[p.style] ?? p.style} | 確定 |
| ルック | ${p.look || '（Phase 1 で Claude が具体化）'} | ${p.look ? '確定' : '提案'} |
| アスペクト比 | ${p.aspect} | 確定 |
| 想定カット数 | ${cuts} 前後（**各カットの尺配分は AI に一任**） | 提案 |
| 音声 | ${engine.nativeAudio ? `ネイティブ音声（generate_audio: ${p.nativeAudio ? 'true' : 'false'}）` : '⚠ このエンジンはネイティブ音声非対応 → セリフ/BGM は別撮りして Phase 6 で合成'}・ナレーション: ${p.narration ? 'あり' : 'なし'} | 確定 |
| 言語 | ${p.language} | 確定 |
| クレジット上限 | ${p.creditLimit} | 確定 |

## スタイルキーワード（全画像・動画プロンプト末尾に付ける英語キーワード列）

\`\`\`
${STYLE_KEYWORDS[p.style] ?? ''}
\`\`\`

（初期値。Phase 1 で Claude がルックに合わせて磨き込むこと）

## 概算クレジット見積り

Phase 5 実行前に get_cost で実測見積りを取り、ここに記入する。

| 内訳 | 数量 | 概算 |
|------|------|------|
| キャラシート | キャラ数分 | |
| 動画（${engine.model} / ${engine.duration}s） | 1 本 | |
| **合計** | | |
`;
};

const scaffoldProject = async (slug, briefText, meta) => {
  const dir = path.join(PROJECTS_DIR, slug);
  await mkdir(path.join(dir, 'assets', 'characters'), { recursive: true });
  await mkdir(path.join(dir, 'assets', 'frames'), { recursive: true });
  await mkdir(path.join(dir, 'assets', 'clips'), { recursive: true });
  await mkdir(path.join(dir, 'assets', 'audio'), { recursive: true });
  await mkdir(path.join(dir, 'out'), { recursive: true });
  await mkdir(path.join(dir, '_codex'), { recursive: true });
  await mkdir(path.join(dir, '_ui'), { recursive: true });
  const templateCopies = ['story', 'characters', 'storyboard', 'shotlist', 'ledger'];
  await Promise.all(
    templateCopies.map((name) =>
      copyFile(path.join(TEMPLATES_DIR, `${name}.md`), path.join(dir, `${name}.md`)),
    ),
  );
  await writeFile(path.join(dir, 'brief.md'), briefText, 'utf-8');
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
};

// ---- タイムライン編集（ffmpeg） ----
const runFfmpeg = (args, logStream) =>
  new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    proc.stderr.on('data', (d) => logStream?.write(d));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
    proc.on('error', reject);
  });

const ffprobeDims = (src) =>
  new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', src]);
    const chunks = [];
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.on('close', (code) => {
      const m = Buffer.concat(chunks).toString().trim().match(/^(\d+)x(\d+)/);
      if (code === 0 && m) resolve({ w: Number(m[1]), h: Number(m[2]) });
      else reject(new Error('ffprobe に失敗しました'));
    });
    proc.on('error', reject);
  });

const sourceVideoOf = (dir) => {
  const main = path.join(dir, 'assets', 'clips', 'main.mp4');
  if (existsSync(main)) return main;
  return null;
};

// EDL セグメント列を ffmpeg で適用して out/<slug>_edit.mp4 に書き出す（非同期ジョブ）
const startRender = async (slug, segments) => {
  if (runningRenders.has(slug)) return { ok: false, error: '書き出しが既に実行中です' };
  const dir = path.join(PROJECTS_DIR, slug);
  const src = sourceVideoOf(dir);
  if (!src) return { ok: false, error: '本編動画（assets/clips/main.mp4）がありません' };
  const tmp = path.join(dir, '_ui', 'render-tmp');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const log = createWriteStream(path.join(dir, '_ui', 'render.log'));
  log.write(`=== 書き出し開始 ${new Date().toISOString()} / ${segments.length} セグメント ===\n`);
  runningRenders.set(slug, { startedAt: Date.now() });

  (async () => {
    try {
      const { w, h } = await ffprobeDims(src);
      const files = [];
      for (const [i, s] of segments.entries()) {
        const vf = [];
        const af = [];
        const c = s.crop ?? { l: 0, r: 0, t: 0, b: 0 };
        if (c.l + c.r + c.t + c.b > 0) {
          vf.push(`crop=iw*${(1 - c.l - c.r).toFixed(4)}:ih*${(1 - c.t - c.b).toFixed(4)}:iw*${c.l.toFixed(4)}:ih*${c.t.toFixed(4)}`, `scale=${w}:${h}`);
        }
        const speed = s.speed ?? 1;
        if (speed !== 1) {
          vf.push(`setpts=(PTS-STARTPTS)/${speed}`);
          af.push(`atempo=${speed}`);
        }
        af.push(`volume=${s.mute ? 0 : 1}`);
        const seg = path.join(tmp, `seg-${String(i).padStart(2, '0')}.mp4`);
        // -ss/-to は入力オプションとして -i より前に置く（フィルタ適用前のソース時刻でトリムする）
        const args = ['-y', '-ss', String(s.start), '-to', String(s.end), '-i', src];
        if (vf.length > 0) args.push('-vf', vf.join(','));
        args.push('-af', af.join(','), '-r', '24', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '160k', seg);
        log.write(`\n--- seg ${i + 1}/${segments.length}: ${JSON.stringify(s)} ---\n`);
        await runFfmpeg(args, log);
        files.push(seg);
      }
      const listPath = path.join(tmp, 'list.txt');
      await writeFile(listPath, files.map((f) => `file '${f}'`).join('\n'), 'utf-8');
      const outPath = path.join(dir, 'out', `${slug}_edit.mp4`);
      await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath], log);
      log.write(`\n=== 書き出し完了: out/${slug}_edit.mp4 ===\n`);
    } catch (err) {
      log.write(`\n=== 書き出し失敗: ${err.message} ===\n`);
    } finally {
      log.end();
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
      runningRenders.delete(slug);
    }
  })();
  return { ok: true };
};

const isValidSegments = (segments) =>
  Array.isArray(segments) &&
  segments.length > 0 &&
  segments.length <= 32 &&
  segments.every(
    (s) =>
      Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start &&
      (s.speed === undefined || (s.speed >= 0.5 && s.speed <= 2)) &&
      (s.crop === undefined || ['l', 'r', 't', 'b'].every((k) => (s.crop[k] ?? 0) >= 0 && (s.crop[k] ?? 0) <= 0.45)),
  );

const runPrompt = (slug) =>
  `/higsgen projects/${slug} を続行してください。brief.md は UI で確定済み（ステータス: confirmed）なので Phase 0 はスキップし、Phase 1 から進めてください。生成実行前のクレジット見積り確認以外は自律で進めて構いません。`;

const startHeadlessRun = async (slug) => {
  if (runningJobs.has(slug)) return { ok: false, error: 'already-running' };
  const dir = path.join(PROJECTS_DIR, slug);
  const logPath = path.join(dir, '_ui', 'run.log');
  await mkdir(path.dirname(logPath), { recursive: true });
  const header = `=== HIGSGEN headless run ${new Date().toISOString()} ===\n`;
  await writeFile(logPath, header, 'utf-8');
  const proc = spawn('claude', ['-p', runPrompt(slug), '--permission-mode', 'acceptEdits'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = (chunk) => writeFile(logPath, chunk, { flag: 'a' }).catch(() => {});
  proc.stdout.on('data', append);
  proc.stderr.on('data', append);
  proc.on('close', (code) => {
    append(`\n=== 終了 (exit ${code}) ===\n`);
    runningJobs.delete(slug);
  });
  proc.on('error', (err) => {
    append(`\n=== 起動失敗: ${err.message}（claude CLI が見つからないか実行不可）===\n`);
    runningJobs.delete(slug);
  });
  runningJobs.set(slug, { proc, startedAt: Date.now() });
  return { ok: true };
};

const serveFile = async (res, filePath, rangeHeader) => {
  try {
    const st = await stat(filePath);
    if (!st.isFile()) throw new Error('not a file');
    const contentType = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    // 動画・音声のシークに必要な HTTP Range 対応
    const range = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && (range[1] !== '' || range[2] !== '')) {
      const start = range[1] === '' ? Math.max(0, st.size - Number(range[2])) : Number(range[1]);
      const end = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Type': contentType,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      });
      return createReadStream(filePath, { start, end }).pipe(res);
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': st.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
};

const handleApi = async (req, res, url) => {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  if (req.method === 'GET' && url.pathname === '/api/engines') {
    return json(res, 200, { engines: ENGINES, styles: STYLE_LABELS });
  }
  if (req.method === 'GET' && url.pathname === '/api/balance') {
    // Claude が生成のたびに state/balance.json を更新する（UI サーバーは表示のみ）
    const balance = await readJsonIfExists(BALANCE_FILE);
    return json(res, 200, balance ?? { credits: null, updatedAt: null });
  }
  if (req.method === 'GET' && url.pathname === '/api/projects') {
    return json(res, 200, { projects: await listProjects() });
  }
  if (req.method === 'POST' && url.pathname === '/api/projects') {
    const body = await readBody(req);
    const required = ['title', 'request', 'style', 'engine', 'aspect'];
    const missing = required.filter((k) => !body[k]);
    if (missing.length > 0) return json(res, 422, { error: `必須項目が不足: ${missing.join(', ')}` });
    if (!ENGINES[body.engine]) return json(res, 422, { error: `不明なエンジン: ${body.engine}` });
    const slug = body.slug && isValidSlug(body.slug) ? body.slug : `prj-${Date.now().toString(36)}`;
    if (existsSync(path.join(PROJECTS_DIR, slug))) {
      return json(res, 409, { error: `プロジェクト ${slug} は既に存在します` });
    }
    // おまかせモード: セリフあり → Seedance 2.0（ネイティブ音声）/ なし → MiniMax H3（2K）
    const dialogue = body.dialogue === true;
    const engineMode = body.engine === 'auto' ? 'auto' : 'manual';
    const resolvedEngine = body.engine === 'auto' ? resolveAutoEngine(dialogue) : String(body.engine);
    const params = {
      title: String(body.title),
      request: String(body.request),
      style: String(body.style),
      look: String(body.look ?? ''),
      engine: resolvedEngine,
      engineMode,
      dialogue,
      aspect: String(body.aspect),
      nativeAudio: body.nativeAudio !== false,
      narration: body.narration === true,
      language: String(body.language ?? '日本語'),
      creditLimit: Number(body.creditLimit ?? 100),
    };
    const meta = { ...params, slug, createdAt: new Date().toISOString(), model: ENGINES[params.engine].model, duration: ENGINES[params.engine].duration };
    await scaffoldProject(slug, buildBrief(params), meta);
    return json(res, 201, { slug, runPrompt: runPrompt(slug) });
  }

  if (parts[0] === 'api' && parts[1] === 'projects' && parts[2]) {
    const slug = parts[2];
    if (!isValidSlug(slug) || !existsSync(path.join(PROJECTS_DIR, slug))) {
      return json(res, 404, { error: 'プロジェクトが見つかりません' });
    }
    if (req.method === 'GET' && parts.length === 3) {
      return json(res, 200, { project: await projectDetail(slug), runPrompt: runPrompt(slug) });
    }
    if (req.method === 'POST' && parts[3] === 'run') {
      const result = await startHeadlessRun(slug);
      return json(res, result.ok ? 202 : 409, result);
    }
    // 承認/差し戻し（type: character | storyboard）。パイプラインは approvals.json を読んで再生成を判断する
    if (req.method === 'POST' && parts[3] === 'approvals') {
      const body = await readBody(req);
      const type = String(body.type ?? 'character');
      const status = String(body.status ?? '');
      if (!['approved', 'rejected', 'pending'].includes(status)) {
        return json(res, 422, { error: 'status は approved / rejected / pending のいずれか' });
      }
      const approvalsPath = path.join(PROJECTS_DIR, slug, 'approvals.json');
      const current = (await readJsonIfExists(approvalsPath)) ?? { characters: {} };
      const entry = { status, feedback: String(body.feedback ?? ''), updatedAt: new Date().toISOString() };
      const next = (() => {
        if (type === 'storyboard') {
          return { ...current, storyboard: { ...(current.storyboard ?? {}), ...entry } };
        }
        const name = String(body.name ?? '');
        if (!name) return null;
        return {
          ...current,
          characters: {
            ...current.characters,
            [name]: { ...(current.characters?.[name] ?? {}), ...entry },
          },
        };
      })();
      if (!next) return json(res, 422, { error: 'type=character の場合は name が必要です' });
      // 承認状態が変わったら Phase 5 通行証を失効させる（再検証を強制）
      await writeFile(approvalsPath, JSON.stringify(next, null, 2), 'utf-8');
      await rm(path.join(PROJECTS_DIR, slug, '_ui', 'phase5-clearance.json'), { force: true });
      return json(res, 200, { ok: true, approvals: next });
    }
    // タイムライン編集（EDL）の保存
    if (req.method === 'POST' && parts[3] === 'edits') {
      const body = await readBody(req);
      if (typeof body.clips !== 'object' || body.clips === null) {
        return json(res, 422, { error: 'clips オブジェクトが必要です' });
      }
      const editsPath = path.join(PROJECTS_DIR, slug, 'edits.json');
      const edits = { clips: body.clips, updatedAt: new Date().toISOString() };
      await writeFile(editsPath, JSON.stringify(edits, null, 2), 'utf-8');
      return json(res, 200, { ok: true, edits });
    }
    // 音声分離: 本編の音声トラックを assets/audio/ に抽出する
    if (req.method === 'POST' && parts[3] === 'detach-audio') {
      const dir = path.join(PROJECTS_DIR, slug);
      const src = sourceVideoOf(dir);
      if (!src) return json(res, 409, { error: '本編動画（assets/clips/main.mp4）がありません' });
      const outAudio = path.join(dir, 'assets', 'audio', 'main-audio.mp3');
      try {
        await runFfmpeg(['-y', '-i', src, '-vn', '-codec:a', 'libmp3lame', '-q:a', '2', outAudio], null);
        return json(res, 200, { ok: true, file: 'assets/audio/main-audio.mp3' });
      } catch (err) {
        return json(res, 500, { error: `音声分離に失敗: ${err.message}` });
      }
    }
    // タイムライン編集の書き出し（ffmpeg レンダリング）
    if (req.method === 'POST' && parts[3] === 'render') {
      const body = await readBody(req);
      if (!isValidSegments(body.segments)) {
        return json(res, 422, { error: 'segments が不正です（start/end 必須、speed 0.5〜2、crop 各 0〜0.45）' });
      }
      const result = await startRender(slug, body.segments);
      return json(res, result.ok ? 202 : 409, result);
    }
  }

  return json(res, 404, { error: 'unknown endpoint' });
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/api/session') {
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!isValidApiKey(body.apiKey, API_KEY)) return json(res, 401, { error: 'APIキーが正しくありません' });
        res.setHeader('Set-Cookie', sessionCookie(API_KEY, SECURE_COOKIE));
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET') return json(res, isAuthorized(req, API_KEY) ? 200 : 401, { authenticated: isAuthorized(req, API_KEY) });
      if (req.method === 'DELETE') {
        res.setHeader('Set-Cookie', clearSessionCookie(SECURE_COOKIE));
        return json(res, 200, { ok: true });
      }
    }

    if ((url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) && !isAuthorized(req, API_KEY)) {
      return json(res, 401, { error: 'APIキー認証が必要です' });
    }

    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    // プロジェクト内ファイル配信: /files/<slug>/<relative path>
    if (url.pathname.startsWith('/files/')) {
      const [, , slug, ...rest] = url.pathname.split('/').map(decodeURIComponent);
      const p = rest.length > 0 ? safeProjectPath(slug, ...rest) : null;
      if (!p) {
        res.writeHead(400);
        return res.end('bad path');
      }
      return await serveFile(res, p, req.headers.range);
    }

    // 静的ファイル
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const staticPath = path.join(PUBLIC_DIR, path.normalize(rel));
    if (!staticPath.startsWith(PUBLIC_DIR)) {
      res.writeHead(400);
      return res.end('bad path');
    }
    return await serveFile(res, staticPath, req.headers.range);
  } catch (err) {
    json(res, 500, { error: String(err?.message ?? err) });
  }
});

server.listen(PORT, () => {
  console.log(`HIGSGEN UI: http://localhost:${PORT}`);
});
