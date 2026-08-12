# HIGSGEN プロジェクト規約

このリポジトリは「キャラクター動画生成パイプライン」。動画制作の依頼が来たら
**必ず `.claude/skills/higsgen/SKILL.md`（/higsgen スキル）に従って進める。**
場当たり的に generate_video を直接叩かない。

## 鉄則

1. **フェーズ順守**: brief → story → characters → storyboard → shotlist → 生成 → 編集。
   成果物ファイルを書いてから次のフェーズへ進む。途中再開は既存ファイルを読んで続きから。
2. **クレジットガード**: 生成前に `get_cost: true` で見積り、合計が brief.md の上限
   （既定 100 クレジット）を超える場合は必ずユーザーに確認してから実行する。
   `use_unlim: true` を自分の判断で付けない。
3. **台帳必須**: すべての生成ジョブ（成功・失敗とも）を `ledger.md` に記録する
   （日時・フェーズ・model・prompt 要約・job_id・クレジット・結果URL）。
4. **キャラクター一貫性**: `characters.md` の英語カノニカル記述ブロックは
   全プロンプトで一字一句そのまま再利用し、キャラシート画像を medias 参照で渡す。
5. **Codex 委譲**: キャラ設計・絵コンテは Codex に委譲（references/codex-delegation.md）。
   Codex が使えない・失敗した場合は Claude が直接作成し、その旨を報告する。
6. **検証なくして完了なし**: 生成物は URL/ファイルを実際に確認してから完了報告する。
