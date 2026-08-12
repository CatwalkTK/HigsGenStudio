---
name: higsgen
description: キャラクターを使ったストーリー動画（アニメ・実写・3Dスタイライズド）をゼロから制作するパイプライン。「動画を作って」「アニメを作って」「ショートフィルム」「キャラクター動画」「ストーリー動画」「PV/MV風」などの制作依頼、および projects/ 配下の既存プロジェクトの続行・再生成・修正の依頼で必ず使用する。Codex=監督/脚本/プロンプト、Codex=キャラ設計/絵コンテ、Higgsfield MCP=画像/動画/音声生成。
---

# HIGSGEN パイプライン

ユーザーの依頼から、キャラクター一貫性のあるストーリー動画を 6 フェーズで制作する。
アニメも実写も同じフローで作る（スタイルは Phase 0 で決め、キャラシートのプリセットと
モデル選定だけが変わる）。

**生成方式はシングルジェネレーション**: 動画エンジンを brief.md で選び、Phase 5 で
1 回の生成で完成尺の動画を 1 本作る。カットごとの尺配分は AI（Codex/Codex）に一任。

| エンジン | model | 尺（固定） | 音声 |
|---------|-------|-----------|------|
| Seedance 2 | `seedance_2_0` | 15 秒 | ネイティブ生成 |
| Seedance 2.5 | `seedance_2_5` | 30 秒 | ネイティブ生成 |
| MiniMax H3 | `minimax_h3` | 15 秒（2K） | **非対応 → 別撮り + Phase 6 合成** |
| おまかせ | （自動解決） | 15 秒 | **セリフあり → Seedance 2.0 / なし → MiniMax H3** |

**おまかせモードのルール**: brief.md の「セリフ」有無で決まる。Phase 1 のストーリー執筆で
セリフの有無が brief と変わった場合、Codex が同ルールで再解決し brief.md と meta.json
（engine / model / duration / estCost 相当欄）を更新してから先へ進む。

## 最初にやること

1. `projects/` を確認。依頼が既存プロジェクトの続き・修正なら、そのフォルダの
   成果物（brief〜ledger）を読み、**完了している最後のフェーズの次から再開**する。
   **UI（ui/server.mjs）で作られたプロジェクトは brief.md が confirmed 済み → Phase 1 から。**
2. 新規なら `scripts/new-project.sh <slug>` で雛形を作る（slug は英小文字ケバブケース）。
3. 必要な Higgsfield MCP ツールのスキーマを ToolSearch で**一括ロード**する
   （references/higgsfield-handoff.md の冒頭にロードリストあり）。

## フェーズ一覧

| Phase | 担当 | 成果物 | ゲート（次へ進む条件） |
|-------|------|--------|----------------------|
| 0 企画 | Codex | `brief.md` | エンジン（＝尺）・スタイル・アスペクト比・クレジット上限が確定 |
| 1 ストーリー | Codex | `story.md` | ユーザー確認（対話中の場合）または自己レビュー |
| 2 キャラクター | Codex → Higgsfield | `characters.md` + `assets/characters/` + `approvals.json` | **全キャラのシートがユーザー承認済み**（rejected はフィードバック反映で再生成） |
| 3 絵コンテ | Codex | `storyboard.md` + `approvals.json` | カット合計＝エンジン尺に厳密一致 + **ユーザー承認済み** |
| 4 ショットプロンプト | Codex | `shotlist.md` | マスタープロンプト・参照 job_id・params が揃う |
| 5 生成 | Codex → Higgsfield | `assets/clips/main.mp4` + `ledger.md` | **`scripts/gate-phase5.sh` が OK**（未承認はフックが generate_video をブロック）+ 本編が QC 通過 |
| 6 編集 | Codex + ffmpeg | `out/<slug>_final.mp4` | 尺・ショット進行・音声が絵コンテと一致 |

各フェーズの詳細手順: **references/phases.md**（フェーズ開始時に該当セクションを読む）
Codex への委譲方法: **references/codex-delegation.md**（Phase 2, 3 で読む）
Higgsfield MCP の呼び方: **references/higgsfield-handoff.md**（Phase 2, 5 で読む）

## 絶対ルール

- **クレジットガード**: 生成系ツールは実行前に `get_cost: true` で見積る。プロジェクト累計が
  brief.md のクレジット上限（既定 100）を超える見込みなら、必ずユーザーに金額を提示して
  承認を得る。`use_unlim` は自分の判断で付けない。
- **台帳**: すべての生成（失敗含む）を `ledger.md` と `ledger.json`（UI の生成履歴用・
  プロンプト全文入り）に追記する。job_id が後続フェーズの medias 参照になるため、
  記録漏れ＝再生成コストになる。Codex への設計委譲も `kind: "design"` で記録する。
- **承認ゲート（キャラクター + 絵コンテ）**: シート生成後・絵コンテレビュー後は
  `approvals.json` を pending にしてユーザー承認を待つ。**全承認が揃うまで Phase 5
  （動画生成）を実行しない** — `scripts/gate-phase5.sh <slug>` で OK を確認してから
  生成する（未承認時は PreToolUse フックが generate_video をブロックする）。
  rejected のフィードバックはプロンプトに反映して再生成する（references/phases.md 2c・3）。
  ヘッドレス実行では承認待ちの時点で終了し、UI での承認を依頼する。
- **キャラクター一貫性**（OiiOii のアセットライブラリに相当）:
  - `characters.md` の英語カノニカル記述ブロックを、画像プロンプトで一字一句再利用する
  - キャラシート画像の job_id / media_id を、そのキャラが写る全カットの medias に渡す
- **スタイル一貫性**: brief.md の「スタイルキーワード」を全画像プロンプトの末尾に付ける。
- **Codex フォールバック**: Codex CLI が失敗・不在なら Codex が同じテンプレートで直接
  作成し、報告にその旨を明記する。
- **検証**: 生成 URL は実際に開いて（またはダウンロードして）確認してから次へ進む。

## 進行報告

フェーズ完了ごとに、成果物パス・消費クレジット累計・次フェーズをユーザーに 2〜3 行で報告する。
