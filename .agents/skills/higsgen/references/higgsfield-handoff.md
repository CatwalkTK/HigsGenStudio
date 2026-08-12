# Higgsfield MCP ハンドオフ規約（Phase 2b / Phase 5）

Higgsfield MCP ツールは遅延ロードされている。**フェーズ開始時に ToolSearch で一括ロード**する:

```
ToolSearch query: "select:mcp__<higgsfield-server>__models_explore,mcp__<higgsfield-server>__generate_image,mcp__<higgsfield-server>__generate_video,mcp__<higgsfield-server>__generate_audio,mcp__<higgsfield-server>__jobs_wait,mcp__<higgsfield-server>__show_generation_by_ids,mcp__<higgsfield-server>__media_import_url,mcp__<higgsfield-server>__balance,mcp__<higgsfield-server>__get_workflow_instructions"
```

（`<higgsfield-server>` はセッションのツール一覧に出る Higgsfield サーバーの ID/名前。
generate_image / generate_video / balance 等が生えているサーバーがそれ）

## 共通ルール

1. **クレジットガード**（最重要）:
   - 実行前に本番と同じパラメータ + `get_cost: true` で見積る
   - `ledger.md` の累計 + 見積りが brief.md の上限を超えるなら、金額を提示して
     ユーザー承認を得るまで実行しない
   - `use_unlim` は**渡さない**（ユーザーが明示的に頼んだ場合のみ true）
2. **medias の値は URL 禁止**: 過去生成の `job_id`、または `media_import_url` /
   `media_upload` が返す `media_id` を使う。
3. **`recovery_tool` が返ったら即座にそのツールを呼ぶ**（説明・確認より先）。
4. **`adjustments` が返ったら内容を確認して従う**（パラメータが補正されている）。
5. すべての実行結果を**2 つの台帳**に即記録する:
   - `ledger.md`（人間可読の要約）
   - `ledger.json`（UI の「生成履歴」タブのデータソース。**prompt は全文**を入れる）:
     ```json
     { "ts": "<ISO8601>", "phase": "2b|5|...", "kind": "image|video|audio|design",
       "tool": "higgsfield|codex|claude-fallback", "model": "<model (params)>",
       "label": "<表示名>", "job_id": "...", "credits": 0,
       "status": "done|failed", "url": "...", "local": "assets/...",
       "refs": [{ "value": "<job_id>", "role": "image_references", "label": "..." }],
       "prompt": "<使用プロンプト全文>", "note": "<特記事項>" }
     ```
   - Codex への設計委譲（Phase 2a / 3）も `kind: "design"` で記録する
     （tool は実際に使ったもの: `codex` または `claude-fallback`）。
6. **残高の同期（UI 表示用）**: 生成の完了後（および Phase 5 終了時）に `balance` を呼び、
   リポジトリ直下の `state/balance.json` を更新する:
   `{ "credits": <残高>, "updatedAt": "<ISO8601>" }`
   UI のヘッダー残高とエンジン別「あと何回生成可能」表示はこのファイルを参照している。

---

## 動画エンジン仕様（確定・2026-08 時点の実カタログ値）

brief.md のエンジン選択に対応するモデルと必須パラメータ:

### Seedance 2 → `seedance_2_0`（15 秒モード）

| パラメータ | 値 |
|-----------|-----|
| duration | **15**（範囲 4〜15） |
| resolution | 480p / 720p / 1080p / 4k（4k・1080p は mode: "std" 必須。既定 720p） |
| mode | "std"（高品質）/ "fast"（安価・480p/720p のみ） |
| genre | auto / action / horror / comedy / noir / drama / epic（作品トーンに合わせる） |
| generate_audio | true（ネイティブ音声）/ false |
| medias roles | start_image / end_image / **image_references** / video_references / audio_references |
| aspect_ratios | auto, 16:9, 9:16, 4:3, 3:4, 1:1, 21:9 |

### Seedance 2.5 → `seedance_2_5`（30 秒モード）

| パラメータ | 値 |
|-----------|-----|
| duration | **30**（範囲 4〜30） |
| resolution | 480p / 720p（既定 720p） |
| mode | **"omni_reference"**（キャラ参照を渡すとき・通常こちら）/ "t2v"（参照なし） |
| generate_audio | true / false |
| medias roles | start_image / end_image / **image_references** / video_references / audio_references |
| aspect_ratios | auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 |

### MiniMax H3 → `minimax_h3`（15 秒・2K モード / 実測コスト 60cr）

| パラメータ | 値 |
|-----------|-----|
| duration | **15**（範囲 4〜15） |
| resolution | **"2K" 固定**（他の選択肢なし） |
| mode / genre | **なし**（どちらのパラメータも持たない） |
| generate_audio | **なし — 出力は無音**。セリフ/BGM は Phase 5c で別生成し Phase 6 で ffmpeg 合成 |
| medias roles | start_image / end_image / **image_references** / video_references / audio_references |
| aspect_ratios | auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 |

MiniMax H3 の注意:
- master_prompt に `dialogue:` / `sfx:` 行を書いても音は付かない。**プロンプトには
  口の動き（speaking, mouthing the words）だけ指示**し、音声原稿は Phase 5c の TTS で
  生成してタイミングを合わせる（リップシンクは概ねになる旨をユーザーに伝える）
- プロンプト上限は Seedance と同様に長文で失敗し得るため、圧縮フォーマット
  （キャラ識別子の冒頭集約）を使うこと

※ カタログは更新されうる。生成直前に `models_explore(action:"get", model_id:...)` で
duration 範囲・roles を再確認すること。

### 実運用で確認済みの制約（2026-08-12 実測）

- **seedance_2_5 の prompt 上限は 4000 文字**（422 で拒否される）。マスタープロンプトは
  キャラ識別子の繰り返しをやめ、冒頭に
  `MIO is the 26-year-old Japanese woman from the reference image: <服装・髪>` の形で
  1 回だけ定義し、各ショット行では名前だけで参照する。t2v フォールバック時の
  カノニカル記述ブロック挿入も文字数に注意。
- **アンリミテッド（use_unlim）対応は seedance_2_0 / seedance_2_0_mini のみ**。
  seedance_2_5 は非対応（型付き拒否が返り課金はされない）。ユーザーが無料枠を
  希望した場合のみ use_unlim: true を付け、拒否されたら理由を報告する。
- **preset_recommendation 通知**が返ることがある（例: "IN THE DARK"）。絵コンテと
  無関係なプリセットなら `declined_preset_id` を付けてリテラル生成で再実行する。
  作品の意図に合いそうな場合のみユーザーに確認する。
- ジョブ投入後は `jobs_wait`（timeout 15s / `poll_after_seconds` に従い再呼び出し）で
  完了を待つ。30 秒動画の生成は数分かかる。

---

## Phase 2b — キャラシート生成

1. `get_workflow_instructions { workflow: "character-sheet" }` をロードし、その指示を正とする。
2. プリセット対応: アニメ → anime/2D、実写 → photoreal-unretouched、3D → 3D-stylized。
3. プロンプトの人物記述には characters.md のカノニカル記述ブロックをそのまま使う。
4. 生成後、承認された job_id を characters.md に記録する。
   **この job_id が Phase 5 の `image_references` になる。**

---

## Phase 5 — シングルジェネレーション実行

shotlist.md の master_prompt / refs / params をそのまま 1 回の `generate_video` に渡す。

```
generate_video({
  params: {
    model: "seedance_2_0" | "seedance_2_5",     // brief のエンジン
    prompt: <master_prompt 全文>,
    duration: 15 | 30,                           // エンジンで固定
    aspect_ratio: <brief の値>,
    resolution: <brief / shotlist の値>,
    generate_audio: <brief の音声方針>,
    mode: "omni_reference",                      // seedance_2_5 + 参照あり時のみ
    genre: <トーン>,                              // seedance_2_0 のみ任意
    medias: [
      { value: "<キャラAシートの job_id>", role: "image_references" },
      { value: "<キャラBシートの job_id>", role: "image_references" }
    ]
  }
})
```

手順:

1. 上記と同一パラメータ + `get_cost: true` で見積り → クレジットガード判定。
2. 本番実行（count は付けない = 1 本）。ウィジェットに結果が出る。
3. 生成完了後、結果 URL を確認して QC:
   - キャラの外見がショット間で一貫しているか（image_references の効き）
   - ショット進行が storyboard.md の順序・内容と合っているか
   - 尺が指定どおりか
4. NG の場合: master_prompt の該当ショット行を修正して再生成（**1 回まで**。
   2 回目以降はユーザーに相談。genre や参照画像の見直しも検討）。
5. 結果を `assets/clips/main.mp4` にダウンロード（curl）し、ledger.md に記録。

### 音声の追加（必要時のみ）

- **ナレーション**: `models_explore(action:"recommend", query:"text-to-speech narration <言語>")`
  でモデル選定 → 原稿から生成 → `assets/audio/vo.mp3`
- **BGM**: `generate_audio`（雰囲気・テンポ・尺を指定）→ `assets/audio/bgm.mp3`
- ナレーション中心の作品は動画側 `generate_audio: false` で競合を避ける選択肢もある
- 合成は Phase 6（ffmpeg）で行う

---

## 拡張モード（参考: カット別生成）

Seedance 以外のエンジンや 30 秒超の作品を作る場合のみ、旧方式（カットごとに
開始フレーム画像 → image-to-video → ffmpeg 結合）を使う:

1. `generate_image_batch`（medias にキャラシート）→ `jobs_wait`（最大 12 job、
   `all_terminal: false` の間は `poll_after_seconds` 待って再呼び出し）→
   全件終了後 `show_generation_by_ids` を **1 回だけ**呼ぶ
2. 承認フレームの job_id を `start_image` にして `generate_video_batch` → 同上
3. Phase 6 で ffmpeg 結合

## エラー時

- 生成失敗 job も ledger.md に記録（原因メモつき）
- 同じプロンプトの再投入は 1 回まで。2 回失敗したらプロンプト・モデル・参照を見直す
- コンテンツポリシー起因の失敗は、プロンプトの該当表現を修正して再挑戦する
