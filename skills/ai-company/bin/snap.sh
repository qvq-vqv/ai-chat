#!/bin/bash
# ai-snap: render visual work to an image so workers (and checks) can SEE the result.
# Research: renderer-in-the-loop and screenshot/video feedback raise success a lot for
# code-generated visuals (see references/research.zh-CN.md, games round).
#
#   ai-snap html    <page.html> <out.png> [WxH=1280x720] [wait_ms=1500]
#        headless Chrome screenshot after the page ran wait_ms (games need a moment to start)
#   ai-snap frames  <page.html> <out_prefix> [n=4] [interval_ms=500] [WxH]
#        n screenshots over time -> <prefix>_1.png..  (shows whether anything moves)
#   ai-snap blender <script.py> <out.png> [WxH=1280x720]
#        run a Blender Python script on an empty scene in background mode, then render
#        (the script builds the scene; if it sets no camera/light, defaults are added)
#   ai-snap blank   <img.png>
#        exit 1 if the image is (almost) a single colour = nothing rendered
# Everything is written inside the current directory tree; works inside the worker sandbox.
set -uo pipefail
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
cmd="${1:-}"; shift || true
TMPD="$(mktemp -d "${TMPDIR:-/tmp}/ai-snap.XXXXXX")"
trap 'rm -rf "$TMPD"' EXIT

abs() { python3 -c 'import os,sys;print(os.path.abspath(sys.argv[1]))' "$1"; }

shot() {  # page out size wait
  local page out size wait w h
  page="$(abs "$1")"; out="$(abs "$2")"; size="${3:-1280x720}"; wait="${4:-1500}"
  w="${size%x*}"; h="${size#*x}"
  "$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
    --user-data-dir="$TMPD/chrome" --hide-scrollbars --allow-file-access-from-files \
    --window-size="$w,$h" --virtual-time-budget="$wait" --screenshot="$out" "file://$page" >/dev/null 2>&1
  [ -s "$out" ] || { echo "ai-snap: screenshot failed for $page" >&2; return 1; }
  echo "$out"
}

blank() {
  python3 - "$1" <<'EOF'
import sys, subprocess
# shrink to 32x32 grey with ffmpeg (no extra python packages) and look at the brightness spread
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", sys.argv[1], "-vf", "scale=32:32", "-pix_fmt", "gray",
                      "-f", "rawvideo", "-"], capture_output=True).stdout
if not raw:
    print("cannot read image"); sys.exit(1)
spread = max(raw) - min(raw)
print(f"luma spread {spread}")
sys.exit(1 if spread < 8 else 0)
EOF
}

case "$cmd" in
  html)   [ $# -ge 2 ] || { sed -n 2,20p "$0"; exit 2; }; shot "$1" "$2" "${3:-1280x720}" "${4:-1500}" ;;
  frames)
    [ $# -ge 2 ] || { sed -n 2,20p "$0"; exit 2; }
    n="${3:-4}"; iv="${4:-500}"; size="${5:-1280x720}"
    for i in $(seq 1 "$n"); do shot "$1" "${2}_$i.png" "$size" $((iv * i)) || exit 1; done ;;
  blender)
    [ $# -ge 2 ] || { sed -n 2,20p "$0"; exit 2; }
    script="$(abs "$1")"; out="$(abs "$2")"; size="${3:-1280x720}"
    cat > "$TMPD/render.py" <<EOF
import bpy, runpy, math
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
runpy.run_path(r"$script", run_name="__main__")
sc = bpy.context.scene
if sc.camera is None:
    bpy.ops.object.camera_add(location=(7, -7, 5), rotation=(math.radians(63), 0, math.radians(45)))
    sc.camera = bpy.context.object
if not any(o.type == "LIGHT" for o in sc.objects):
    bpy.ops.object.light_add(type="SUN", location=(5, -5, 10)); bpy.context.object.data.energy = 3
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in {e.identifier for e in sc.render.bl_rna.properties["engine"].enum_items} else "BLENDER_EEVEE"
w, h = "$size".split("x"); sc.render.resolution_x, sc.render.resolution_y = int(w), int(h)
sc.render.filepath = r"$out"
bpy.ops.render.render(write_still=True)
EOF
    BLENDER_USER_CONFIG="$TMPD/bcfg" BLENDER_USER_SCRIPTS="$TMPD/bscripts" \
      "$BLENDER" -b --factory-startup --python-exit-code 1 -P "$TMPD/render.py" > "$TMPD/blender.log" 2>&1
    rc=$?
    if [ $rc -ne 0 ] || [ ! -s "$out" ]; then tail -n 30 "$TMPD/blender.log" >&2; echo "ai-snap: blender render failed" >&2; exit 1; fi
    echo "$out" ;;
  blank) [ $# -ge 1 ] || exit 2; blank "$1" ;;
  *) sed -n 2,20p "$0"; exit 2 ;;
esac
