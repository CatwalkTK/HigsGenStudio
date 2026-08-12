# Codex 委譲手順（Phase 2a キャラ設計 / Phase 3 絵コンテ）

Codex CLI（`codex`）を非対話モードで実行し、設計系の成果物を書かせる。
Claude は指揮官として「プロンプト準備 → 実行 → レビュー → 差し戻し/承認」を行う。

## 前提確認

```bash
codex --version
```

失敗する（未インストール・認証切れ等）場合は**委譲せず Claude が直接作成**し、
報告に「Codex 不在のため Claude が代行」と明記する。

## 実行手順

1. テンプレート（`templates/codex-character-prompt.md` または
   `templates/codex-storyboard-prompt.md`）の `{{ }}` プレースホルダを埋め、
   `projects/<slug>/_codex/` に保存する（例: `_codex/character-prompt.md`）。
2. プロジェクトフォルダを作業ディレクトリにして実行:

```bash
codex exec \
  --skip-git-repo-check \
  --sandbox workspace-write \
  -C "projects/<slug>" \
  "$(cat projects/<slug>/_codex/character-prompt.md)"
```

- `--skip-git-repo-check`: このリポジトリは git 管理外でも動かすため必須
- `--sandbox workspace-write`: プロジェクトフォルダ内のみ書き込み許可
- タイムアウトは 10 分（Bash timeout 600000）を目安に設定する

3. 実行後、期待する出力ファイル（`characters.md` / `storyboard.md`）が
   **実際に書かれたか確認**する。Codex は会話出力だけしてファイルを書かないことが
   あるため、ファイルがなければ stdout から内容を回収して Claude が保存する。
4. **担当の記録（必須）**: 完了後、`ledger.json` に `kind: "design"` のレコードを追記し、
   `tool` に実際の担当（`codex` / フォールバック時は `claude-fallback`）と、使用した
   Codex プロンプト（充填済みの全文または要約）を記録する。成果物ファイルの冒頭にも
   `<!-- designed by: codex | claude-fallback (理由) -->` の 1 行を入れる。
   UI の「生成履歴」タブはこの記録から「誰が設計したか」を表示する。

## レビュー（差し戻し基準）

Codex の出力は鵜呑みにしない。以下を Claude が確認し、不合格ならプロンプトに
不足点を追記して 1 回だけ再実行。それでも不合格なら Claude が修正・補筆する:

- **characters.md**: 全キャラに英語カノニカル記述ブロックがあるか。ブロックが
  「1 段落・具体的（色/形/素材/年齢感）・小道具まで固定」になっているか。
  ストーリー上の役割・関係性と矛盾していないか。
- **storyboard.md**: phases.md の Phase 3 レビュー基準（尺・必須項目・つながり・
  1 カット 3〜10 秒）を満たすか。

## 失敗パターンと対処

| 症状 | 対処 |
|------|------|
| sandbox エラーで書き込めない | `-C` のパスがセッションのワークスペース内か確認。外なら Claude が代行 |
| git リポジトリ要求エラー | `--skip-git-repo-check` を付け忘れていないか確認 |
| 出力が途中で切れる | プロンプトに「ファイルに書き込むこと」「完了時に DONE と出力」を明記して再実行 |
| 2 回失敗 | Claude が直接作成に切り替え、その旨を報告 |
