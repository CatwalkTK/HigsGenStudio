#!/bin/sh
set -eu

if [ -d /claude-config ]; then
  cp -R /claude-config/. /home/node/.claude/
fi

exec "$@"
