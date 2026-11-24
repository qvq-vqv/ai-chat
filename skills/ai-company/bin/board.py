#!/usr/bin/env python3
"""ai-status: watch dispatched worker tasks while they run.

  ai-status                 text overview: running tasks (elapsed, phase, files changed) + recent ones
  ai-status <task-id>       details of one task (brief, files changed, log tail, result)
  ai-status html            (re)write runs/board.html — auto-refreshing page; ai-dispatch keeps it fresh
  ai-status open            write the page and open it in the default browser
  ai-status stop <task-id>  stop a running task (kills the dispatcher and its worker processes)

Internal (used by ai-dispatch): mark <id> key=value ...   finish <id> <status>
State lives in ai-company/runs/active/<task-id>.json (one file per task, kept 3 days).
"""
import glob, html, json, os, signal, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
ACTIVE = os.path.join(ROOT, "runs", "active")
BOARD = os.path.join(ROOT, "runs", "board.html")
KEEP_FINISHED = 3 * 86400
SKIP_DIRS = {".git", "node_modules", ".ai-tasks", "Library", "Temp", "Logs", "obj", "__pycache__", ".venv", "venv"}


def path(i):
    return os.path.join(ACTIVE, f"{i}.json")


def load(i):
    try:
        return json.load(open(path(i), encoding="utf-8"))
    except Exception:
        return {"id": i}


def save(d):
    os.makedirs(ACTIVE, exist_ok=True)
    tmp = path(d["id"]) + ".tmp"
    json.dump(d, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(tmp, path(d["id"]))


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except Exception:
        return False


def tasks():
    out = []
    for f in glob.glob(os.path.join(ACTIVE, "*.json")):
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        if d.get("phase") not in ("finished",) and d.get("pid") and not alive(d["pid"]):
            d["phase"], d["status"] = "finished", d.get("status") or "stopped (dispatcher gone)"
            d.setdefault("end", int(os.path.getmtime(f)))
        if d.get("phase") == "finished" and time.time() - d.get("end", 0) > KEEP_FINISHED:
            os.remove(f)
            continue
        out.append(d)
    run = sorted([d for d in out if d.get("phase") != "finished"], key=lambda d: d.get("start", 0))
    done = sorted([d for d in out if d.get("phase") == "finished"], key=lambda d: -d.get("end", 0))
    return run, done


def changed_files(d, limit=8):
    """Files in the workdir modified since the task started = visible progress."""
    wd, start = d.get("workdir"), d.get("start", 0)
    if not wd or not os.path.isdir(wd):
        return 0, []
    hits, scanned = [], 0
    for base, dirs, files in os.walk(wd):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not x.startswith(".")]
        for fn in files:
            scanned += 1
            if scanned > 5000:
                break
            p = os.path.join(base, fn)
            try:
                m = os.path.getmtime(p)
            except OSError:
                continue
            if m >= start:
                hits.append((m, os.path.relpath(p, wd)))
    hits.sort(reverse=True)
    return len(hits), [h[1] for h in hits[:limit]]


def tail(p, n=12):
    try:
        with open(p, encoding="utf-8", errors="ignore") as fh:
            return [l.rstrip() for l in fh.readlines()[-n:] if l.strip()]
    except Exception:
        return []


def fmt_dur(s):
    s = int(max(0, s))
    return f"{s // 60}m{s % 60:02d}s" if s >= 60 else f"{s}s"


def elapsed(d):
    return (d.get("end") or time.time()) - d.get("start", time.time())


# ---------- text ----------
def status_text():
    run, done = tasks()
    print(f"Running ({len(run)}):" if run else "Running: none")
    for d in run:
        n, files = changed_files(d, 3)
        to = int(d.get("timeout", 0) or 0)
        print(f"  {d['id']:<34} {d.get('seat') or d.get('worker','?'):<15} {d.get('phase','?'):<10} "
              f"{fmt_dur(elapsed(d))}/{fmt_dur(to)}  files changed: {n}  {', '.join(files)}")
        print(f"      project: {d.get('workdir','?')}")
    if done:
        print("Recent:")
        for d in done[:10]:
            print(f"  {d['id']:<34} {d.get('seat') or d.get('worker','?'):<15} {d.get('status','?'):<22} "
                  f"{fmt_dur(elapsed(d))}  ended {time.strftime('%m-%d %H:%M', time.localtime(d.get('end', 0)))}")
    print(f"\nLive page: {BOARD}   (ai-status open)")


def detail(i):
    d = load(i)
    if "workdir" not in d:
        sys.exit(f"no task '{i}' on the board")
    print(json.dumps({k: v for k, v in d.items() if k not in ("pid",)}, ensure_ascii=False, indent=1))
    n, files = changed_files(d, 30)
    print(f"\nFiles changed since start ({n}):")
    for f in files:
        print("  " + f)
    for label, key in (("Raw log (tail)", "raw"), ("Result (tail)", "result"), ("Check log (tail)", "checklog")):
        t = tail(d.get(key, ""), 15)
        if t:
            print(f"\n{label}:")
            for l in t:
                print("  " + l[:200])


# ---------- html ----------
CSS = """
:root{--bg:#f7f6f3;--card:#fff;--ink:#1d1d1f;--mute:#6e6e73;--line:#e3e1dc;--run:#2f6fde;--ok:#1f8f4e;--bad:#c23b2a;--warn:#b7791f}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--card:#202023;--ink:#ececee;--mute:#9a9aa0;--line:#333338;--run:#6c9cff;--ok:#4cc27e;--bad:#ff6b5a;--warn:#e0a84a}}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;padding:20px 16px}
.wrap{max-width:980px;margin:0 auto}h1{font-size:20px;margin:0 0 2px}.sub{color:var(--mute);font-size:12px;margin-bottom:18px}
h2{font-size:15px;margin:22px 0 8px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:10px}
.top{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:baseline}.id{font-weight:600}.pill{font-size:12px;padding:1px 8px;border-radius:99px;border:1px solid var(--line);color:var(--mute)}
.phase{color:var(--run);border-color:var(--run)}.ok{color:var(--ok);border-color:var(--ok)}.bad{color:var(--bad);border-color:var(--bad)}.warn{color:var(--warn);border-color:var(--warn)}
.bar{height:6px;background:var(--line);border-radius:3px;margin:8px 0 6px;overflow:hidden}.bar i{display:block;height:100%;background:var(--run)}
.meta{color:var(--mute);font-size:12px;word-break:break-all}ul{margin:6px 0 0;padding-left:18px}li{font-size:13px}
pre{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px;font-size:12px;overflow-x:auto;white-space:pre-wrap;margin:6px 0 0;max-height:180px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line)}th{color:var(--mute);font-weight:500}
.tw{overflow-x:auto}.empty{color:var(--mute)}
"""


def cls(status):
    s = (status or "").lower()
    if s.startswith("ok") or "pass" in s:
        return "ok"
    if "fail" in s or "error" in s or "timeout" in s:
        return "bad"
    if "stop" in s or "in-house" in s or "nothing" in s:
        return "warn"
    return ""


def write_html():
    run, done = tasks()
    e = html.escape
    parts = [f"<title>AI 公司任务看板</title><meta http-equiv='refresh' content='10'><style>{CSS}</style><div class='wrap'>",
             "<h1>AI 公司任务看板</h1>",
             f"<div class='sub'>每 10 秒自动刷新 · 更新于 {time.strftime('%H:%M:%S')} · 命令行：<code>ai-status</code></div>",
             f"<h2>进行中（{len(run)}）</h2>"]
    if not run:
        parts.append("<div class='empty'>现在没有员工在干活。</div>")
    for d in run:
        to = int(d.get("timeout", 0) or 0) or 1
        el = elapsed(d)
        pct = min(100, int(el * 100 / to))
        n, files = changed_files(d)
        log = tail(d.get("raw", ""), 6)
        ph = {"routing": "选人中", "running": "干活中", "checking": "自动检查中", "escalating": "换更强的员工重做"}.get(d.get("phase"), d.get("phase", "?"))
        rnd = int(d.get("round", 0) or 0)
        round_html = f"<span class='pill warn'>第 {rnd + 1} 轮</span>" if rnd else ""
        parts.append(
            f"<div class='card'><div class='top'><span class='id'>{e(d['id'])}</span>"
            f"<span class='pill phase'>{e(ph)}</span><span class='pill'>{e(d.get('seat') or d.get('worker', '?'))}</span>"
            f"<span class='pill'>{e(d.get('category', ''))} / {e(d.get('quality', ''))}</span>"
            f"{round_html}</div>"
            f"<div class='bar'><i style='width:{pct}%'></i></div>"
            f"<div class='meta'>已用 {fmt_dur(el)} / 上限 {fmt_dur(to)} · 项目 {e(d.get('workdir', ''))}</div>"
            f"<div class='meta'>目标：{e(d.get('goal', ''))}</div>"
            f"<div style='margin-top:6px'>已改动 {n} 个文件</div>"
            + (("<ul>" + "".join(f"<li>{e(f)}</li>" for f in files) + "</ul>") if files else "")
            + (f"<pre>{e(chr(10).join(log))}</pre>" if log else "")
            + f"<div class='meta' style='margin-top:6px'>停止：<code>ai-status stop {e(d['id'])}</code></div></div>")
    parts.append("<h2>最近完成</h2>")
    if not done:
        parts.append("<div class='empty'>还没有记录。</div>")
    else:
        parts.append("<div class='tw'><table><tr><th>任务</th><th>员工</th><th>结果</th><th>用时</th><th>结束</th><th>结果文件</th></tr>")
        for d in done[:20]:
            st = d.get("status", "?")
            parts.append(
                f"<tr><td>{e(d['id'])}</td><td>{e(d.get('seat') or d.get('worker', '?'))}</td>"
                f"<td><span class='pill {cls(st)}'>{e(st)}</span></td><td>{fmt_dur(elapsed(d))}</td>"
                f"<td>{time.strftime('%m-%d %H:%M', time.localtime(d.get('end', 0)))}</td>"
                f"<td class='meta'><a href='file://{e(d.get('result', ''))}'>打开</a></td></tr>")
        parts.append("</table></div>")
    parts.append("</div>")
    os.makedirs(os.path.dirname(BOARD), exist_ok=True)
    tmp = BOARD + ".tmp"
    open(tmp, "w", encoding="utf-8").write("<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" + "".join(parts))
    os.replace(tmp, BOARD)


def stop(i):
    d = load(i)
    pid = d.get("pid")
    if not pid or not alive(pid):
        sys.exit(f"task '{i}' is not running")
    def kids(p):
        r = subprocess.run(["pgrep", "-P", str(p)], capture_output=True, text=True).stdout.split()
        return [int(x) for x in r]
    order, todo = [], [int(pid)]
    while todo:
        p = todo.pop()
        order.append(p)
        todo += kids(p)
    for p in reversed(order):  # children first
        try:
            os.kill(p, signal.SIGTERM)
        except Exception:
            pass
    d.update(phase="finished", status="stopped by user", end=int(time.time()))
    save(d)
    write_html()
    print(f"stopped {i} ({len(order)} processes)")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        status_text()
    elif a[0] == "mark" and len(a) >= 2:
        d = load(a[1]); d["id"] = a[1]
        for kv in a[2:]:
            k, _, v = kv.partition("=")
            d[k] = int(v) if v.isdigit() else v
        save(d)
    elif a[0] == "finish" and len(a) >= 3:
        d = load(a[1]); d.update(id=a[1], phase="finished", status=" ".join(a[2:]), end=int(time.time()))
        save(d); write_html()
    elif a[0] == "html":
        write_html()
    elif a[0] == "open":
        write_html(); subprocess.run(["open", BOARD]); print(BOARD)
    elif a[0] == "stop" and len(a) >= 2:
        stop(a[1])
    elif a[0] in ("-h", "--help", "help"):
        print(__doc__)
    else:
        detail(a[0])
