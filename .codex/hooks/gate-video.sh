#!/bin/bash
# PreToolUse フック: Higgsfield 動画生成（mcp__*__generate_video*）を承認ゲートで保護する。
# scripts/gate-phase5.sh が発行した 2 時間以内の通行証がなければブロック（exit 2）。
INPUT="$(cat)"
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

# get_cost:true（コスト見積りのみ・課金なし）は常に許可
if printf '%s' "$INPUT" | grep -q '"get_cost"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

FRESH="$(find "$ROOT/projects" -maxdepth 3 -name 'phase5-clearance.json' -mmin -120 2>/dev/null | head -1)"
if [ -n "$FRESH" ]; then
  exit 0
fi

{
  echo "ブロック: 動画生成にはキャラクターと絵コンテのユーザー承認が必要です。"
  echo "手順:"
  echo "  1. UI（http://localhost:4649）の承認カードで全キャラクター + 絵コンテを承認してもらう"
  echo "     （rejected の場合はフィードバックを反映して再生成 → 再承認待ち）"
  echo "  2. scripts/gate-phase5.sh <slug> を実行して OK を確認する"
  echo "  3. その後で動画生成を再実行する"
} >&2
exit 2
