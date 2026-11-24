#!/usr/bin/env python3
"""ai-route: pick the right worker seat for a task, by quality need and live quota.

  ai-route pick <category> <quality> [--why]   -> prints "seat<TAB>worker<TAB>model"
  ai-route status                              -> quota per pool + ratings per seat
  ai-route rate <task-id> pass|fail [note] [--seat S]  -> record acceptance result (feeds future picks)
  pick also takes --exclude seat1,seat2 (used by ai-dispatch when escalating after a failed check)

Categories / quality levels / seats live in ../workers.json.
"""
import csv, glob, json, os, re, subprocess, sys, time
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
CFG = json.load(open(os.path.join(ROOT, "workers.json"), encoding="utf-8"))
RUNS = os.path.join(ROOT, "runs")
os.makedirs(RUNS, exist_ok=True)
LEDGER = os.path.join(RUNS, "index.tsv")
RATINGS = os.path.join(RUNS, "ratings.tsv")
CACHE = os.path.join(RUNS, ".quota-cache.json")
CACHE_TTL = 600  # seconds
EXHAUSTED = os.path.join(RUNS, "pool-exhausted.tsv")  # "pool<TAB>unix-ts<TAB>reason", written by ai-dispatch
BLOCKLIST = os.path.join(RUNS, "seat-blocklist.tsv")  # "seat<TAB>reason<TAB>date", written by ai-dispatch


# ---------- quota ----------
def agy_usage():
    """{group: remaining_pct} from `agy -p /usage` (min of weekly and 5-hour windows)."""
    out = subprocess.run(["agy", "-p", "/usage", "--print-timeout", "60s"], capture_output=True,
                         text=True, timeout=90, cwd=ROOT).stdout
    rem = {}
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 3 and parts[2].endswith("%"):
            g, pct = parts[0].strip(), float(parts[2].rstrip("%"))
            rem[g] = min(rem.get(g, 100.0), pct)
    return rem


def codex_usage():
    """remaining_pct from the newest Codex session log (min over 5-hour and weekly windows)."""
    files = sorted(glob.glob(os.path.expanduser("~/.codex/sessions/*/*/*/*.jsonl")), key=os.path.getmtime)
    now = time.time()
    for f in reversed(files[-20:]):
        with open(f, encoding="utf-8", errors="ignore") as fh:
            lines = [l for l in fh if '"rate_limits"' in l]
        for line in reversed(lines):
            try:
                rl = json.loads(line)
            except Exception:
                continue
            rl = find_key(rl, "rate_limits")
            if not rl:
                continue
            rem = 100.0
            for w in ("primary", "secondary"):
                win = rl.get(w) or {}
                if win.get("resets_at", 0) > now:
                    rem = min(rem, 100.0 - float(win.get("used_percent", 0)))
            return rem
    return None


def find_key(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            r = find_key(v, key)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = find_key(v, key)
            if r is not None:
                return r
    return None


def ledger_rows():
    if not os.path.exists(LEDGER):
        return []
    with open(LEDGER, encoding="utf-8") as fh:
        return list(csv.reader(fh, delimiter="\t"))[1:]


def quotas(refresh=False):
    if not refresh and os.path.exists(CACHE) and time.time() - os.path.getmtime(CACHE) < CACHE_TTL:
        q = json.load(open(CACHE))
    else:
        q = {}
        try:
            q["agy"] = agy_usage()
        except Exception as e:
            q["agy"] = {"_error": str(e)}
        try:
            q["codex"] = codex_usage()
        except Exception as e:
            q["codex"] = None
        json.dump(q, open(CACHE, "w"))
    today = date.today().isoformat()
    res = {}
    for name, p in CFG["pools"].items():
        if p["source"] == "agy":
            res[name] = q.get("agy", {}).get(p["group"])
        elif p["source"] == "codex":
            res[name] = q.get("codex")
        else:  # ledger-based soft cap, weighted by seat cost (manual runs count 1)
            cost = {s["id"]: s["cost"] for s in CFG["seats"]}
            used = sum(cost.get(r[9], 1) if len(r) > 9 else 1
                       for r in ledger_rows() if r and r[0].startswith(today) and r[2] == "codebuddy")
            res[name] = max(0.0, 100.0 * (1 - used / p["daily_soft_cap"]))
        # a worker recently reported this pool as exhausted (written by ai-dispatch) -> 0% for 12 h
        if os.path.exists(EXHAUSTED):
            for line in open(EXHAUSTED, encoding="utf-8"):
                f = line.rstrip("\n").split("\t")
                if len(f) >= 2 and f[0] == name and f[1].isdigit() and time.time() - int(f[1]) < 12 * 3600:
                    res[name] = 0.0
        # keep a reserve for the user's own use: rescale so the reserve counts as 0%
        rv = p.get("reserve_pct", 0)
        if res[name] is not None and rv:
            res[name] = max(0.0, (res[name] - rv) / (100 - rv) * 100)
    return res  # None = unknown


# ---------- ratings ----------
def rating_stats():
    stats = {}  # (seat, category) -> [pass, total]
    if os.path.exists(RATINGS):
        with open(RATINGS, encoding="utf-8") as fh:
            for r in list(csv.reader(fh, delimiter="\t"))[1:]:
                if len(r) >= 4:
                    s = stats.setdefault((r[2], r[3]), [0, 0])
                    s[1] += 1
                    s[0] += r[4] == "pass" if len(r) > 4 else 0
    return stats


def effective_quality(seat, cat, stats):
    """Public-benchmark prior from workers.json, nudged by our own ratings only once
    there are enough samples (small samples are too noisy to trust)."""
    q = seat["quality"].get(cat, 0)  # 0 = seat cannot do this category
    if q == 0:
        return 0
    rr = CFG.get("rating_rules", {})
    p, n = stats.get((seat["id"], cat), [0, 0])
    if n >= rr.get("downgrade_min_samples", 5) and p / n < rr.get("downgrade_below", 0.6):
        q -= 1
    elif n >= rr.get("upgrade_min_samples", 8) and p / n >= rr.get("upgrade_at_least", 0.95):
        q += 1
    return max(1, min(5, q))


# ---------- pick ----------
SPEED = {"fast": 0.3, "medium": 0.0, "slow": -0.2}


def pick(cat, level, why=False, exclude=()):
    if cat not in CFG["categories"]:
        sys.exit(f"unknown category '{cat}'. choose: {', '.join(CFG['categories'])}")
    if level not in CFG["quality_levels"]:
        sys.exit(f"unknown quality '{level}'. choose: {', '.join(CFG['quality_levels'])}")
    need = CFG["quality_levels"][level]
    for rule in CFG.get("in_house", {}).get("rules", []):
        if rule["category"] in (cat, "*") and level in rule["levels"]:
            if why:
                print(f"task: {cat} / {level} -> keep in-house ({rule['seat']}): {rule['why']}", file=sys.stderr)
            print(f"{rule['seat']}\tclaude\t{rule['seat'].split('-', 1)[1]}")
            return
    rem, stats = quotas(), rating_stats()
    blocked = set()
    if os.path.exists(BLOCKLIST):  # seats the dispatcher found unusable (e.g. model not allowed)
        blocked = {l.split("\t")[0].strip() for l in open(BLOCKLIST, encoding="utf-8") if l.strip()}
    rows = []
    for s in CFG["seats"]:
        if s.get("disabled") or s["id"] in blocked:
            continue
        q = effective_quality(s, cat, stats)
        r = rem.get(s["pool"])
        ok_q = q >= need["min_quality"]
        ok_r = r is not None and r >= need["min_remaining_pct"] and s["id"] not in exclude
        score = (r or 0) / 100 * 2 - s["cost"] * 0.5 - (q - need["min_quality"]) * 0.3 + SPEED[s["speed"]]
        score += 0.3 if cat in s.get("tested", []) else 0  # prefer abilities verified in practice
        rows.append((ok_q and ok_r, score, s, q, r))
    rows.sort(key=lambda x: (not x[0], -x[1]))
    if why:
        print(f"task: {cat} / {level}  (need quality>={need['min_quality']}, pool>={need['min_remaining_pct']}%)", file=sys.stderr)
        for ok, sc, s, q, r in rows:
            rr = "?" if r is None else f"{r:.0f}%"
            print(f"  {'OK ' if ok else '-- '} {s['id']:<15} q={q} pool={s['pool']}:{rr:<5} cost={s['cost']} score={sc:.2f}", file=sys.stderr)
    best = rows[0]
    if not best[0]:
        sys.exit(f"no worker fits {cat}/{level} right now (quality or quota too low). "
                 "Lower the quality level, wait for quota reset, or let Claude do it.")
    s = best[2]
    print(f"{s['id']}\t{s['worker']}\t{s['model']}")


def status():
    rem, stats = quotas(refresh=True), rating_stats()
    print("Quota remaining (min of short and long window):")
    for name, r in rem.items():
        print(f"  {name:<15} {'unknown' if r is None else f'{r:.0f}%'}")
    if stats:
        print("Ratings (pass/total):")
        for (seat, cat), (p, n) in sorted(stats.items()):
            print(f"  {seat:<15} {cat:<11} {p}/{n}")


def rate(task_id, verdict, note="", seat=None):
    if verdict not in ("pass", "fail"):
        sys.exit("verdict must be pass or fail")
    row = next((r for r in reversed(ledger_rows()) if len(r) > 1 and r[1] == task_id
                and (seat is None or (len(r) > 9 and r[9] == seat))), None)
    if not row or len(row) < 10 or not row[9]:
        sys.exit(f"task '{task_id}' not found in ledger with a seat (only auto-routed tasks can be rated)")
    new = not os.path.exists(RATINGS)
    with open(RATINGS, "a", encoding="utf-8") as fh:
        if new:
            fh.write("date\ttask\tseat\tcategory\tverdict\tnote\n")
        fh.write(f"{time.strftime('%F %T')}\t{task_id}\t{row[9]}\t{row[7]}\t{verdict}\t{note}\n")
    print(f"rated {task_id}: {row[9]} / {row[7]} -> {verdict}")


if __name__ == "__main__":
    a = sys.argv[1:]

    def opt(name):  # --name value
        if name in a:
            i = a.index(name)
            v = a[i + 1] if i + 1 < len(a) else ""
            del a[i:i + 2]
            return v
        return None

    excl, seat = opt("--exclude"), opt("--seat")
    if a[:1] == ["pick"] and len(a) >= 3:
        pick(a[1], a[2], why="--why" in a, exclude=tuple(filter(None, (excl or "").split(","))))
    elif a[:1] == ["status"]:
        status()
    elif a[:1] == ["rate"] and len(a) >= 3:
        rate(a[1], a[2], " ".join(a[3:]), seat=seat)
    else:
        print(__doc__)
        sys.exit(2)
