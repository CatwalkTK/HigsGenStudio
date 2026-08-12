#!/bin/bash
# 新規動画プロジェクトの雛形を projects/<slug>/ に作成する
# 使い方: scripts/new-project.sh <slug>
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "使い方: $0 <slug>  (英小文字ケバブケース 例: cat-astronaut-ramen)" >&2
  exit 1
fi

SLUG="$1"
if ! echo "$SLUG" | grep -qE '^[a-z0-9]+(-[a-z0-9]+)*$'; then
  echo "エラー: slug は英小文字ケバブケースで指定してください: $SLUG" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATES="$ROOT/.claude/skills/higsgen/templates"
PROJECT="$ROOT/projects/$SLUG"

if [ -e "$PROJECT" ]; then
  echo "エラー: $PROJECT は既に存在します" >&2
  exit 1
fi

mkdir -p "$PROJECT"/{assets/{characters,frames,clips,audio},out,_codex}

for f in brief story characters storyboard shotlist ledger; do
  cp "$TEMPLATES/$f.md" "$PROJECT/$f.md"
done

echo "作成完了: $PROJECT"
echo "次: brief.md から Phase 0 を開始（.claude/skills/higsgen/SKILL.md 参照）"
