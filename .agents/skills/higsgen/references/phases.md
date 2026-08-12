# フェーズ詳細手順

各フェーズの入出力と手順。テンプレートは `../templates/` にある。
成果物はすべて `projects/<slug>/` 直下に置く。

> **生成方式 = シングルジェネレーション**: 動画は Phase 5 で **1 回の生成で完成尺を 1 本**作る。
> エンジンは brief.md で確定する:
>
> | エンジン | model | 尺（固定） | 解像度 | 特記 |
> |---------|-------|-----------|--------|------|
> | Seedance 2 | `seedance_2_0` | **15 秒** | 〜4K（std） | image/video/audio_references、genre ヒント、ネイティブ音声 |
> | Seedance 2.5 | `seedance_2_5` | **30 秒** | 〜720p | mode: t2v / omni_reference（参照あり時）、ネイティブ音声 |
> | MiniMax H3 | `minimax_h3` | **15 秒** | 2K 固定 | image/video/audio_references。**音声生成なし（無音出力）** |
>
> カットごとの尺配分は **AI（Codex/Claude）に一任**。合計だけ厳守する。
> MiniMax H3 選択時は、セリフ・ナレーション・BGM を Phase 5c で別生成し Phase 6 で合成する
> （Phase 1 の音声原稿とタイミング設計が特に重要になる）。

---

## Phase 0 — 企画（Claude ＝ アートディレクター）

**入力**: ユーザーの依頼文（または UI が確定済みの brief.md）
**出力**: `brief.md`（templates/brief.md を埋める）

**UI（ui/server.mjs）から作成されたプロジェクトは brief.md が「ステータス: confirmed」で
確定済み。その場合このフェーズはスキップし、スタイルキーワードの磨き込みだけ Phase 1 冒頭で行う。**

1. 依頼から以下を確定する（不明項目は提案値で埋めて明記）:
   - **エンジン**: Seedance 2（15 秒）/ Seedance 2.5（30 秒）/ MiniMax H3（15 秒・2K・無音）
     → 尺はエンジンで自動確定。**おまかせモード**の場合はセリフあり → Seedance 2.0、
     なし → MiniMax H3 で解決する（Phase 1 でセリフ有無が変わったら再解決し
     brief.md と meta.json を更新する）
   - **スタイル**: アニメ / 実写（フォトリアル）/ 3Dスタイライズド + 具体的なルック
   - **スタイルキーワード**: 全プロンプト末尾に付ける英語キーワード列
   - **アスペクト比**: 16:9 / 9:16 / 1:1
   - **音声方針**: ネイティブ音声（generate_audio）、ナレーション有無、言語
   - **クレジット上限**: 既定 100
2. 概算クレジット（キャラシート数枚 + 動画 1 本）を見積り、brief.md に記載する。

---

## Phase 1 — ストーリー（Claude ＝ 脚本家）

**入力**: `brief.md`
**出力**: `story.md`（templates/story.md を埋める）

1. ログライン（1 文）→ あらすじ（3〜5 文）→ 三幕構成 → シーンリストの順に書く。
2. 完成尺が 15/30 秒と短いため、**1 つの感情・1 つの出来事に絞る**（起承転結のミニマル版）。
3. シーンリストは各シーンに「場所 / 時間帯 / 登場キャラ / 起きること / 感情ビート」を持たせる。
4. セリフ・ナレーションがある場合は下書きまで書く。尺内で読み切れる文字数にする
   （日本語ナレーション目安: 15 秒 ≒ 90 字、30 秒 ≒ 180 字）。

---

## Phase 2 — キャラクター（Codex ＝ デザイナー、Higgsfield ＝ 作画）

**入力**: `brief.md`, `story.md`
**出力**: `characters.md` + `assets/characters/` のキャラシート画像

### 2a. 設計（Codex に委譲）

1. `references/codex-delegation.md` に従い、templates/codex-character-prompt.md を埋めて
   Codex を実行。Codex が `characters.md` を書く。
2. Claude がレビュー: 全キャラに **英語カノニカル記述ブロック** があるか、ストーリーの
   役割と矛盾がないかを確認。不足があれば差し戻すか Claude が補筆する。

### 2b. キャラシート生成（Higgsfield）

1. `get_workflow_instructions { workflow: "character-sheet" }` を呼び、その指示に従う。
   プリセット: アニメ → anime/2D、実写 → photoreal-unretouched、3D → 3D-stylized。
2. キャラごとにシートを生成（プロンプトにはカノニカル記述ブロックをそのまま使う）。
3. job_id・URL を `characters.md` と台帳（ledger.md / ledger.json）に記録し、画像を
   `assets/characters/<name>.png` にダウンロードする。
4. **このシート画像が Phase 5 の `image_references` になる**（キャラ一貫性の要）。

### 2c. キャラクター承認ゲート（必須）

**全キャラクターがユーザー承認されるまで Phase 3 以降（特に Phase 5 の動画生成）に進まない。**

1. シート生成後、`approvals.json` にキャラごとのエントリを書く:
   ```json
   { "characters": { "<キャラ名>": {
       "image": "assets/characters/<name>.png",
       "status": "pending", "feedback": "", "updatedAt": "<ISO8601>" } } }
   ```
2. 承認の取り方（両方対応）:
   - **対話セッション**: シート画像を見せて AskUserQuestion で「承認 / やり直し」を確認し、
     結果を approvals.json に反映する
   - **UI**: ユーザーが UI の「キャラクター承認」カードで承認/差し戻しすると
     approvals.json が更新される。パイプライン再開時に必ずこのファイルを読む
3. `status: "rejected"` の場合: `feedback` の内容をカノニカル記述ブロックと
   シート生成プロンプトに反映して**再生成**し、approvals.json を `pending` に戻して
   再承認を待つ。**再生成は 2 回まで**。3 回目以降はユーザーと直接相談する。
4. 再生成もひとつの生成として台帳（ledger.json）に記録する（旧シートの job_id は
   使用しないこと）。

---

## Phase 3 — 絵コンテ（Codex ＝ 絵コンテアーティスト）

**入力**: `story.md`, `characters.md`, `brief.md`（エンジン＝合計尺）
**出力**: `storyboard.md`

1. `references/codex-delegation.md` に従い、templates/codex-storyboard-prompt.md を埋めて
   Codex を実行。Codex が `storyboard.md` を書く。
2. Claude がレビュー（差し戻し基準）:
   - **カット合計秒数がエンジンの尺（15 or 30 秒）に一致**しているか（±0 秒。1 生成なので厳密）
   - 各カットの尺は Codex の裁量（目安 2〜8 秒）だが、極端な偏りがないか
   - 各カットに「シーン / 登場キャラ / カメラ / 芝居 / セリフ・SE / 秒数 / トランジション」が揃うか
   - 180度ルール違反・つながらないアクションがないか
   - 冒頭カットで状況設定、ラストカットで感情の着地ができているか
3. **絵コンテ承認ゲート（必須）**: レビュー通過後、`approvals.json` の `storyboard` を
   `{"status": "pending", "feedback": "", "updatedAt": "<ISO8601>"}` にしてユーザー承認を待つ。
   - 対話セッション: 絵コンテの要約を見せて AskUserQuestion で承認/差し戻しを確認
   - UI: ユーザーが「承認」カードで判断する。**ヘッドレス実行時はここで終了**し、
     UI での承認を依頼して報告する
   - `rejected` の場合: feedback を Codex プロンプトに追記して再委譲（design レコードを
     ledger.json に記録）→ pending に戻して再承認待ち。再生成は 2 回まで
   - **承認されるまで Phase 4 以降に進まない**

---

## Phase 4 — ショットプロンプト（Claude ＝ アニメーター指示）

**入力**: `storyboard.md`, `characters.md`, `brief.md`
**出力**: `shotlist.md`（＝ **1 本のマスタープロンプト** + パラメータ）

絵コンテ全体を **1 つのマルチショット動画プロンプト**に翻訳する（Seedance 2.x は
ショット区切りの構造化プロンプトを解釈できる）。templates/shotlist.md の形式で:

1. **master_prompt**: 冒頭にスタイル・トーン・カメラ全体方針 → 続けてカットごとに
   `Shot N (Xs): カメラ + 登場キャラ（名前で参照）+ 芝居 + 背景・照明` を時系列で列挙 →
   末尾にスタイルキーワード。
   - キャラの外見の長文再記述はしない（image_references が担保）。ただし各キャラの
     識別子（例: "MIKA, the silver-haired girl in a red jacket"）は毎ショットで一貫させる
   - セリフ・効果音がある場合はショット行に `dialogue:` / `sfx:` として書く
     （ネイティブ音声生成が拾う）
2. **refs**: characters.md のキャラシート job_id 一覧（role: `image_references`）
3. **params**: model（brief のエンジン）/ duration（15 or 30）/ aspect_ratio /
   resolution / generate_audio /（seedance_2_5 のみ）mode: omni_reference（参照あり時）/
   （seedance_2_0 のみ）genre ヒント
4. ナレーション原稿を確定する（別撮り VO にする場合は Phase 5c で生成）。

---

## Phase 5 — 生成（Higgsfield MCP ハンドオフ）

**入力**: `shotlist.md`
**出力**: `assets/clips/`（本編）+ `assets/audio/`（VO/BGM）+ 更新された `ledger.md`

ツール呼び出し規約は **references/higgsfield-handoff.md** に従う。

0. **承認ゲート通過（必須・機械的に強制）**: `scripts/gate-phase5.sh <slug>` を実行し、
   `OK`（exit 0）を確認する。全キャラクター + 絵コンテが approved でないと通行証
   （`_ui/phase5-clearance.json`・有効 2 時間）が発行されず、`.claude/settings.json` の
   PreToolUse フックが `generate_video` の実行自体をブロックする（`get_cost` は通る）。
   NG の場合は未承認項目を解消（承認依頼 or フィードバック反映の再生成）してから戻る。
1. **コスト見積り**: 本番と同じパラメータに `get_cost: true` を付けて見積り →
   クレジットガード判定（上限超過見込みならユーザー承認を待つ）。
2. **動画生成（1 回）**: `generate_video` を master_prompt + refs + params で実行。
   - medias: キャラシート job_id を `image_references` で渡す
   - `recovery_tool` が返ったら即座に呼ぶ / `adjustments` に従う
3. **QC**: 結果を確認（キャラ一貫性・カット進行・尺）。NG の場合は master_prompt の
   該当ショット行を修正して再生成（**再生成は 1 回まで。それ以上はユーザーに相談**）。
4. **音声（必要時）**: ナレーションは音声モデルで別生成 → `assets/audio/vo.mp3`。
   BGM を足す場合は generate_audio 系モデルで生成 → `assets/audio/bgm.mp3`。
   ※ ネイティブ音声（SFX・環境音）は動画生成に含まれる。ナレーション中心の作品では
   競合を避けるため `generate_audio: false` も検討する。
5. 本編を `assets/clips/main.mp4` にダウンロードし、`ledger.md` に記録する。

---

## Phase 6 — 編集・納品（Claude ＝ エディター）

**入力**: `assets/clips/main.mp4`, `assets/audio/`
**出力**: `out/<slug>_final.mp4`

1. 追加音声がない場合: `assets/clips/main.mp4` を `out/<slug>_final.mp4` にコピーして完了。
2. VO/BGM がある場合: `which ffmpeg` を確認し、音声を合成する
   （音量: セリフ > ナレーション > BGM。BGM は -14〜-18dB 目安でダッキング）。
   ffmpeg がなければ素材一式と合成指示を納品する。
3. **QA チェックリスト**:
   - [ ] 尺がエンジン規定（15/30 秒）どおり
   - [ ] カット進行が storyboard.md と一致
   - [ ] キャラの外見が全ショットで一貫
   - [ ] 音声と映像のタイミングが合っている
4. 完成ファイルを SendUserFile で送り、消費クレジット合計・ledger の場所を報告する。
   UI 利用時は `out/` に置けば完成動画としてプレビューされる。
