#!/bin/bash
# Phase 5（動画生成）の承認ゲート
# 使い方: scripts/gate-phase5.sh <slug>
# 全キャラクター + 絵コンテが approved のときだけ通行証
# projects/<slug>/_ui/phase5-clearance.json を発行する（フックが参照・有効2時間）
set -euo pipefail
SLUG="${1:?使い方: $0 <slug>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="$ROOT/projects/$SLUG"

if [ ! -d "$PROJ" ]; then
  echo "NG: プロジェクトが見つかりません: $PROJ" >&2
  exit 1
fi

python3 - "$PROJ" <<'PY'
import json, sys, os, datetime

proj = sys.argv[1]
path = os.path.join(proj, 'approvals.json')
try:
    with open(path) as f:
        data = json.load(f)
except Exception as e:
    print(f'NG: approvals.json を読めません: {e}')
    sys.exit(1)

problems = []
chars = data.get('characters') or {}
if not chars:
    problems.append('キャラクターの承認エントリがありません（Phase 2c 未実施）')
for name, entry in chars.items():
    if entry.get('status') != 'approved':
        problems.append(f'キャラクター「{name}」: {entry.get("status", "pending")}')
sb = data.get('storyboard') or {}
if sb.get('status') != 'approved':
    problems.append(f'絵コンテ: {sb.get("status", "pending")}')

if problems:
    print('NG: 動画生成は許可されません。未承認の項目:')
    for p in problems:
        print(' -', p)
    print('→ UI（http://localhost:4649）で承認するか、差し戻しフィードバックを反映して再生成してください')
    sys.exit(1)

os.makedirs(os.path.join(proj, '_ui'), exist_ok=True)
clearance = {
    'slug': os.path.basename(proj),
    'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
with open(os.path.join(proj, '_ui', 'phase5-clearance.json'), 'w') as f:
    json.dump(clearance, f, ensure_ascii=False, indent=2)
print('OK: 全承認を確認。phase5-clearance.json を発行しました（有効 2 時間）')
PY
