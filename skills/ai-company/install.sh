#!/bin/bash
# Install the ai-company skill for the current user (macOS). No sudo, no downloads.
#   bash install.sh [--dry-run] [--home DIR]
# 1. copies this folder to DIR (default: ~/ai-company) unless it already runs from there
# 2. links it as a Claude Code skill: ~/.claude/skills/ai-company -> DIR
# 3. links the commands ai-dispatch / ai-route / ai-status / ai-snap into ~/.local/bin
# Existing files are never overwritten: the script stops and tells you instead.
set -euo pipefail
DRY=0; DEST="$HOME/ai-company"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1;;
    --home) DEST="$2"; shift;;
    *) echo "usage: $0 [--dry-run] [--home DIR]" >&2; exit 2;;
  esac; shift
done
SRC="$(cd "$(dirname "$0")" && pwd -P)"
run() { if [ $DRY = 1 ]; then echo "would run: $*"; else "$@"; fi; }

[ "$(uname)" = Darwin ] || { echo "macOS only (the worker sandbox uses sandbox-exec)" >&2; exit 1; }

if [ "$SRC" != "$(cd "$DEST" 2>/dev/null && pwd -P || echo "$DEST")" ]; then
  [ -e "$DEST" ] && { echo "$DEST already exists; remove it or pass --home DIR" >&2; exit 1; }
  run mkdir -p "$(dirname "$DEST")"
  run cp -R "$SRC" "$DEST"
fi
# release zips do not keep execute bits
run chmod +x "$DEST"/bin/*.sh "$DEST"/bin/*.py "$DEST/install.sh"
run mkdir -p "$DEST/runs"

link() {  # link <target> <linkpath>
  if [ -L "$2" ] && [ "$(readlink "$2")" = "$1" ]; then echo "ok: $2"; return; fi
  [ -e "$2" ] || [ -L "$2" ] && { echo "skip: $2 exists (not ours); link it yourself if wanted" >&2; return; }
  run mkdir -p "$(dirname "$2")"
  run ln -s "$1" "$2"
}
link "$DEST" "$HOME/.claude/skills/ai-company"
link "$DEST/bin/dispatch.sh" "$HOME/.local/bin/ai-dispatch"
link "$DEST/bin/route.py"    "$HOME/.local/bin/ai-route"
link "$DEST/bin/board.py"    "$HOME/.local/bin/ai-status"
link "$DEST/bin/snap.sh"     "$HOME/.local/bin/ai-snap"

echo
echo "Next:"
echo "  - make sure ~/.local/bin is on your PATH"
echo "  - install and sign in to the worker CLIs you want (agy, codebuddy, codex); see README"
echo "  - edit $DEST/workers.json: delete seats you do not have, adjust scores"
echo "  - check: ai-route status ; ai-route pick code normal --why"
