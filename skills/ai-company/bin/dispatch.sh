#!/bin/bash
# Dispatch one task file to a worker AI CLI.
# Usage: ai-dispatch <path/to/task>.md     (also: bin/dispatch.sh tasks/<task>.md)
# Task files may live in ai-company/tasks/ or in any project's .ai-tasks/ folder.
# Writes <runs>/<task>.result.md (final summary) and <runs>/<task>.raw.log, where
# <runs> is ai-company/runs for company tasks and <taskdir>/runs otherwise.
# Every run is also logged in ai-company/runs/index.tsv (central ledger).
#
# Optional frontmatter:
#   check: <shell command>   run in the workdir (sandboxed) after the worker; exit 0 = pass.
#                            Result goes to the ledger; a failed check is auto-rated "fail".
#   escalate: 1              (worker: auto + check only) on a failed check, re-route once to a
#                            stronger seat (next quality level, failed seats excluded) and let it
#                            fix the work, with the check output in its brief. 0 = off (default).
#   sandbox: os              run codex inside our own Seatbelt profile (writes confined to the
#                            workdir) instead of codex's built-in sandbox, which blocks system
#                            services that toolchains such as xcodebuild need. agy/codebuddy
#                            always run this way.
# A file named context.md next to the task file (e.g. <project>/.ai-tasks/context.md) is
# appended to every brief: project conventions a worker could not guess. Keep it short.
set -uo pipefail

# resolve through symlinks (~/.local/bin/ai-dispatch -> this file)
SELF="$(perl -MCwd=abs_path -e 'print abs_path(shift)' "$0")"
ROOT="$(cd "$(dirname "$SELF")/.." && pwd)"
TASK="${1:-}"
[ -f "$TASK" ] || { echo "usage: ai-dispatch <task>.md" >&2; exit 2; }
TASKDIR="$(cd "$(dirname "$TASK")" && pwd)"
TASK="$TASKDIR/$(basename "$TASK")"
ID="$(basename "$TASK" .md)"
if [ "$TASKDIR" = "$ROOT/tasks" ]; then RUNS="$ROOT/runs"; else RUNS="$TASKDIR/runs"; fi

# --- parse frontmatter (key: value, '#' comments allowed) ---
fm() {
  awk -v k="$1" '
    NR==1 && $0!="---" {exit}
    NR>1 && $0=="---" {exit}
    NR>1 {
      line=$0; sub(/[ \t]+#.*$/, "", line)
      if (match(line, "^" k ":[ \t]*")) { v=substr(line, RLENGTH+1); sub(/[ \t]+$/, "", v); print v; exit }
    }' "$TASK"
}
body() { awk 'NR==1 && $0=="---" {infm=1; next} infm && $0=="---" {infm=0; next} !infm' "$TASK"; }

WORKER="$(fm worker)"; WORKDIR="$(fm workdir)"; FMMODEL="$(fm model)"; TIMEOUT="$(fm timeout)"
TIMEOUT="${TIMEOUT:-1800}"
CATEGORY="$(fm category)"; QUALITY="$(fm quality)"
CHECK="$(fm check)"; ESCALATE="$(fm escalate)"; ESCALATE="${ESCALATE:-0}"
OSSB="$(fm sandbox)"; [ -z "$OSSB" ] || [ "$OSSB" = os ] || { echo "sandbox must be empty or 'os'" >&2; exit 2; }
AUTO=0; [ "$WORKER" = "auto" ] && AUTO=1
[ $AUTO -eq 1 ] && { [ -n "$CATEGORY" ] && [ -n "$QUALITY" ] || { echo "worker: auto needs category: and quality:" >&2; exit 2; }; }
[[ "$ESCALATE" =~ ^[0-2]$ ]] || { echo "escalate must be 0, 1 or 2" >&2; exit 2; }

# default workdir for a project task in <project>/.ai-tasks/ is the project itself
if [ -z "$WORKDIR" ] && [ "$(basename "$TASKDIR")" = ".ai-tasks" ]; then WORKDIR="$(dirname "$TASKDIR")"; fi

# --- safety checks ---
[ -d "$WORKDIR" ] || { echo "workdir does not exist: $WORKDIR" >&2; exit 2; }
WORKDIR="$(cd "$WORKDIR" && pwd -P)"
unsafe() { echo "refusing unsafe workdir: $WORKDIR" >&2; exit 2; }
case "$WORKDIR" in
  /|/Volumes|"$HOME"|"$HOME/Desktop"|"$HOME/Documents"|"$HOME/Downloads") unsafe;;
  "$HOME/Library"*|"$HOME/."*|/System*|/usr*|/bin*|/sbin*|/private*|/Applications*|/Library*) unsafe;;
  /Volumes/*/*) ;;            # inside a volume: fine
  /Volumes/*) unsafe;;        # volume root
esac
[[ "$TIMEOUT" =~ ^[0-9]+$ ]] || { echo "bad timeout: $TIMEOUT" >&2; exit 2; }

# --- base prompt ---
CONTEXT=""
[ -f "$TASKDIR/context.md" ] && CONTEXT="
PROJECT CONVENTIONS (always follow):
$(cat "$TASKDIR/context.md")
"
BASE="You are a worker in a small AI company. Rules:
- Work only inside this directory: $WORKDIR. Do not read or write files outside it.
- Do not install software, download from the internet, or delete anything outside this directory.
- Never print or store passwords, tokens or keys.
- Stay inside the task's scope; do not add features nobody asked for.
- If the task is unclear or blocked, stop and explain why instead of guessing.
- Before finishing, check every acceptance criterion yourself and run any test command given.
- For anything visual (web page, game, animation, Blender scene), LOOK at your result before finishing:
  $ROOT/bin/snap.sh html <page.html> <out.png> [WxH] [wait_ms]   (screenshot)
  $ROOT/bin/snap.sh frames <page.html> <prefix> [n] [interval_ms] (several moments: does it move?)
  $ROOT/bin/snap.sh blender <script.py> <out.png> [WxH]           (run a Blender Python script, render)
  $ROOT/bin/snap.sh blank <img.png>                              (exit 1 = image is empty)
  Open the PNGs and compare them with the goal; fix what looks wrong. If a generated script is
  badly broken, rewrite it cleanly instead of patching it again and again.
- Finish with a short summary: files changed, how you verified, open issues.
$CONTEXT
TASK ($ID):
$(body)"

mkdir -p "$RUNS" "$ROOT/runs"
RESULT="$RUNS/$ID.result.md"
RAW="$RUNS/$ID.raw.log"
LEDGER="$ROOT/runs/index.tsv"
[ -f "$LEDGER" ] || printf 'date\ttask\tworker\tmodel\texit\tseconds\tworkdir\tcategory\tquality\tseat\tcheck\n' > "$LEDGER"

# macOS Seatbelt profile: may write only to the workdir plus the worker's own
# state/cache dirs (keychain is needed for login tokens). Reads and network stay open.
SBPROFILE="$(mktemp -t ai-dispatch-sandbox)"
cat > "$SBPROFILE" <<EOF
(version 1)
(allow default)
(deny file-write* (subpath "/"))
(allow file-write*
  (subpath "$WORKDIR")
  (subpath "/private/var/folders") (subpath "/private/tmp") (subpath "/dev")
  (subpath "$HOME/Library/Keychains") (subpath "$HOME/Library/Caches") (subpath "$HOME/.cache")
  (subpath "$HOME/.gemini") (subpath "$HOME/.codebuddy"))
EOF
# A workdir on an external volume: Foundation's atomic writes go through that volume's
# own temp folder (xcodebuild fails without it).
case "$WORKDIR" in
  /Volumes/*/*) VOL="$(echo "$WORKDIR" | cut -d/ -f1-3)"
                printf '(allow file-write* (subpath "%s/.TemporaryItems"))\n' "$VOL" >> "$SBPROFILE";;
esac
# codex under our profile needs its own state dir (sessions may be a symlink to another disk)
if [ "$OSSB" = os ]; then
  printf '(allow file-write* (subpath "%s/.codex"))\n' "$HOME" >> "$SBPROFILE"
  CXS="$(perl -MCwd=abs_path -e 'print abs_path(shift)' "$HOME/.codex/sessions" 2>/dev/null)"
  [ -n "$CXS" ] && printf '(allow file-write* (subpath "%s"))\n' "$CXS" >> "$SBPROFILE"
fi
# Optional: folders no worker may read or list (e.g. other people's or private data).
# One absolute path per line in deny-read.txt; added as a hard Seatbelt deny.
DENYFILE="$ROOT/deny-read.txt"
if [ -f "$DENYFILE" ]; then
  while IFS= read -r p; do
    case "$p" in ""|\#*) continue;; esac
    printf '(deny file-read* (subpath "%s"))\n' "$p" >> "$SBPROFILE"
  done < "$DENYFILE"
fi
# --- live board (ai-status): state file, page refresher, finish notification ---
BOARDPY="$ROOT/bin/board.py"
GOAL="$(awk '/^## Goal/{f=1;next} f&&NF{print;exit}' "$TASK" | cut -c1-160)"
python3 "$BOARDPY" mark "$ID" pid=$$ start="$(date +%s)" timeout="$TIMEOUT" workdir="$WORKDIR" task="$TASK" \
  raw="$RAW" result="$RESULT" checklog="$RUNS/$ID.check.log" category="$CATEGORY" quality="$QUALITY" \
  worker="$WORKER" goal="$GOAL" phase=routing round=0 status= seat=
( while kill -0 $$ 2>/dev/null; do python3 "$BOARDPY" html 2>/dev/null; sleep 10; done ) &
BOARDLOOP=$!
disown "$BOARDLOOP" 2>/dev/null   # no "Terminated" message when it is stopped at exit
FINAL="error"
on_exit() {
  rm -f "$SBPROFILE"
  kill "$BOARDLOOP" 2>/dev/null
  python3 "$BOARDPY" finish "$ID" "$FINAL" 2>/dev/null
  if [ "${AI_NOTIFY:-1}" = 1 ]; then
    osascript -e "display notification \"$ID: $FINAL\" with title \"AI 公司：任务结束\"" >/dev/null 2>&1
  fi
}
trap on_exit EXIT
# perl alarm = portable timeout (macOS has no `timeout`)
run_with_timeout() { local t="$1"; shift; perl -e 'alarm shift; exec @ARGV or die "exec failed: $!"' "$t" "$@"; }
sandboxed() { local t="$1"; shift; sandbox-exec -f "$SBPROFILE" perl -e 'alarm shift; exec @ARGV or die "exec failed: $!"' "$t" "$@"; }

next_level() { case "$1" in draft) echo normal;; normal) echo high;; high) echo critical;; *) echo critical;; esac; }

# run_worker <prompt>: uses WORKER/MODEL, writes RESULT/RAW, sets rc
NETERR='502|ECONNRESET|ETIMEDOUT|TLS connection|socket disconnected|network'
run_worker() {
  local prompt="$1"
  : > "$RESULT"
  # Retry up to 2 more times when a run produced nothing and failed on the network
  # (the direct route to codebuddy.ai fails a TLS handshake ~1 in 10).
  for attempt in 1 2 3; do
    case "$WORKER" in
      codex)
        args=(exec --skip-git-repo-check -s workspace-write -C "$WORKDIR"
              -c sandbox_workspace_write.exclude_slash_tmp=true
              -c sandbox_workspace_write.exclude_tmpdir_env_var=true
              -o "$RESULT")
        [ -n "$MODEL" ] && args+=(-m "$MODEL")
        if [ "$OSSB" = os ]; then
          args=(exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C "$WORKDIR" -o "$RESULT")
          [ -n "$MODEL" ] && args+=(-m "$MODEL")
          printf '%s' "$prompt" | sandboxed "$TIMEOUT" codex "${args[@]}" - > "$RAW" 2>&1
        else
          printf '%s' "$prompt" | run_with_timeout "$TIMEOUT" codex "${args[@]}" - > "$RAW" 2>&1
        fi
        rc=$? ;;
      agy)
        # OS sandbox confines writes, so the agent may auto-approve its own tools
        args=(-p "$prompt" --dangerously-skip-permissions --print-timeout "${TIMEOUT}s")
        [ -n "$MODEL" ] && args+=(--model "$MODEL")
        sandboxed "$TIMEOUT" agy "${args[@]}" > "$RESULT" 2> "$RAW"
        rc=$? ;;
      codebuddy)
        args=(-p "$prompt" -y --max-turns 120)
        [ -n "$MODEL" ] && args+=(--model "$MODEL")
        sandboxed "$TIMEOUT" codebuddy "${args[@]}" > "$RESULT" 2> "$RAW"
        rc=$? ;;
    esac
    if [ ! -s "$RESULT" ] && [ $rc -ne 142 ] && grep -qiE "$NETERR" "$RAW" "$RESULT" 2>/dev/null && [ $attempt -lt 3 ]; then
      echo "network error, retrying ($attempt/2)..."; cp "$RAW" "$RAW.attempt$attempt"; sleep 5; continue
    fi
    break
  done
  [ $rc -eq 142 ] && echo "TIMEOUT after ${TIMEOUT}s" >> "$RAW"   # 128+SIGALRM(14)
}

cd "$WORKDIR" || exit 2
LEVEL="$QUALITY"; TRIED=""; PROMPT="$BASE"; ROUND=0
while :; do
  SEAT=""; MODEL="$FMMODEL"
  if [ $AUTO -eq 1 ]; then
    PICK="$(python3 "$ROOT/bin/route.py" pick "$CATEGORY" "$LEVEL" --why --exclude "$TRIED")" || { FINAL="nothing fits"; exit 3; }
    IFS=$'\t' read -r SEAT WORKER PMODEL <<< "$PICK"
    [ -z "$FMMODEL" ] && MODEL="$PMODEL"
    if [ "$WORKER" = "claude" ]; then
      echo "router: $CATEGORY/$LEVEL is in-house work ($SEAT) - not dispatched. Do it with Claude $PMODEL (Agent subagent with model: $PMODEL if this session runs another model)." >&2
      FINAL="in-house (Opus)"; exit 4
    fi
    echo "router: $CATEGORY/$LEVEL -> $SEAT ($WORKER ${MODEL:-default})"
  fi
  case "$WORKER" in codex|agy|codebuddy) ;; *) echo "unknown worker: '$WORKER'" >&2; exit 2;; esac

  START=$(date +%s)
  python3 "$BOARDPY" mark "$ID" phase=running worker="$WORKER" seat="${SEAT:-$WORKER}" model="${MODEL:-default}" start="$START" round="$ROUND"
  echo "dispatch: $ID -> $WORKER (timeout ${TIMEOUT}s) in $WORKDIR"
  MARK="$(mktemp -t ai-dispatch-mark)"
  run_worker "$PROMPT"
  DUR=$(( $(date +%s) - START ))
  # did the worker touch any file in the workdir? (ignores .git, node_modules, our own run logs)
  CHANGED="$(find "$WORKDIR" -type f -newer "$MARK" -not -path '*/.git/*' -not -path '*/node_modules/*' \
    -not -path '*/.ai-tasks/runs/*' -not -path "$ROOT/runs/*" 2>/dev/null | head -1)"
  rm -f "$MARK"
  NOWORK=0; [ ! -s "$RESULT" ] && [ -z "$CHANGED" ] && NOWORK=1

  # quota pool really exhausted (CodeBuddy has no quota API, so our estimate can be wrong):
  # mark the whole pool empty for 12 h and re-route; does not count as an escalation round
  if [ -n "$SEAT" ] && [ ! -s "$RESULT" ] && grep -qiE 'credits exhausted|quota exceeded|RESOURCE_EXHAUSTED|insufficient (credit|quota)|usage limit' "$RAW" 2>/dev/null; then
    POOL="$(python3 -c "import json,sys;print(next(s['pool'] for s in json.load(open(sys.argv[1]))['seats'] if s['id']==sys.argv[2]))" "$ROOT/workers.json" "$SEAT" 2>/dev/null)"
    printf '%s\t%s\t%s\n' "${POOL:-$SEAT}" "$(date +%s)" "$(grep -oiE 'credits exhausted|quota exceeded|RESOURCE_EXHAUSTED|insufficient (credit|quota)|usage limit' "$RAW" | head -1)" >> "$ROOT/runs/pool-exhausted.tsv"
    rm -f "$ROOT/runs/.quota-cache.json"
    echo "quota pool ${POOL:-?} is exhausted -> marked empty for 12 h, re-routing"
    SKIPS=$(( ${SKIPS:-0} + 1 ))
    [ "$SKIPS" -le 4 ] && [ $AUTO -eq 1 ] && { TRIED="${TRIED:+$TRIED,}$SEAT"; continue; }
  fi

  # seat unusable on this account (e.g. "model ... is not allowed for user type ...") -> block it
  # for future picks and re-route right away; this does not count as an escalation round
  if [ -n "$SEAT" ] && [ ! -s "$RESULT" ] && grep -qiE 'not allowed for user type|model .* (not found|not available|not supported)' "$RAW" 2>/dev/null; then
    printf '%s\t%s\t%s\n' "$SEAT" "$(grep -oiE '[^"]*not allowed for user type[^ ]*|model [^ ]* (not found|not available|not supported)' "$RAW" | head -1)" "$(date +%F)" >> "$ROOT/runs/seat-blocklist.tsv"
    echo "seat $SEAT is not usable on this account -> blocked, re-routing"
    SKIPS=$(( ${SKIPS:-0} + 1 ))
    [ "$SKIPS" -le 4 ] && [ $AUTO -eq 1 ] && { TRIED="${TRIED:+$TRIED,}$SEAT"; continue; }
  fi

  # empty result AND no file changed = the worker did nothing (e.g. TLS failure after retries).
  # A check would pass vacuously on untouched code, so never run it; re-route or fail.
  if [ $NOWORK -eq 1 ]; then
    echo "no work: empty result and no file changed in the workdir (see $RAW)"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$ID" "$WORKER" "${MODEL:-default}" "$rc" "$DUR" "$WORKDIR" "$CATEGORY" "$LEVEL" "$SEAT" "nowork" >> "$LEDGER"
    SKIPS=$(( ${SKIPS:-0} + 1 ))
    if [ $AUTO -eq 1 ] && [ "$SKIPS" -le 4 ]; then TRIED="${TRIED:+$TRIED,}$SEAT"; echo "re-routing without $TRIED"; continue; fi
    FINAL="no work (worker produced nothing)"; exit 6
  fi

  CHK="-"
  # run the check even after a timeout/error: workers often finish the files and then keep
  # polishing until the deadline (seen with agy on 2026-11-18); a passing check rescues the work
  if [ -n "$CHECK" ]; then
    python3 "$BOARDPY" mark "$ID" phase=checking
    echo "check: $CHECK"
    if sandboxed 600 /bin/bash -c "$CHECK" > "$RUNS/$ID.check.log" 2>&1; then CHK=pass; else CHK=fail; fi
    echo "check: $CHK (log: $RUNS/$ID.check.log)"
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$ID" "$WORKER" "${MODEL:-default}" "$rc" "$DUR" "$WORKDIR" "$CATEGORY" "$LEVEL" "$SEAT" "$CHK" >> "$LEDGER"
  echo "done: exit=$rc in ${DUR}s"
  [ "$CHK" = fail ] && [ -n "$SEAT" ] && python3 "$ROOT/bin/route.py" rate "$ID" fail "auto: check failed" --seat "$SEAT" >/dev/null

  # escalate once (or twice) to a stronger seat when the objective check failed
  if [ "$CHK" = fail ] && [ $AUTO -eq 1 ] && [ $ROUND -lt "$ESCALATE" ]; then
    ROUND=$((ROUND + 1)); TRIED="${TRIED:+$TRIED,}$SEAT"; LEVEL="$(next_level "$LEVEL")"
    cp "$RESULT" "$RUNS/$ID.result.round$ROUND.md"
    echo "escalating ($ROUND/$ESCALATE): check failed -> retry at $LEVEL without $TRIED"
    python3 "$BOARDPY" mark "$ID" phase=escalating
    PROMPT="$BASE

NOTE: a previous worker attempted this task in this directory and its work FAILED this check:
  $CHECK
Last lines of the check output:
$(tail -n 40 "$RUNS/$ID.check.log")
Inspect the existing files, fix or redo the work, and make the check pass."
    continue
  fi
  break
done

echo "result: $RESULT"
[ -s "$RESULT" ] || echo "(empty result — check $RAW)"
case "$rc" in 0) FINAL="ok";; 142) FINAL="timeout";; *) FINAL="error (exit $rc)";; esac
[ "$CHK" = pass ] && FINAL="$FINAL, check pass"
[ "$CHK" = fail ] && { FINAL="$FINAL, check FAIL"; exit 5; }
if [ "$CHK" = pass ] && [ $rc -ne 0 ]; then
  echo "note: worker exited with $rc (timeout/error) but the check PASSED - files are usable, review them yourself"
  exit 0
fi
exit $rc
