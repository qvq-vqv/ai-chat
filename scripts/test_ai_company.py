"""Offline tests for skills/ai-company: no worker CLI, account or network is used."""
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import unittest

SKILL = Path(__file__).resolve().parents[1] / "skills" / "ai-company"


class AiCompanyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name) / "home"
        self.home.mkdir()
        # a private copy so runs/ caches never touch the repository
        self.copy = Path(self.temp.name) / "company"
        shutil.copytree(SKILL, self.copy)

    def run_cmd(self, *args, **kw):
        env = dict(os.environ, HOME=str(self.home))
        return subprocess.run(args, capture_output=True, text=True, env=env, timeout=60, **kw)

    def route(self, *args):
        return self.run_cmd(sys.executable, str(self.copy / "bin" / "route.py"), *args)

    def test_workers_json_is_consistent(self):
        cfg = json.loads((SKILL / "workers.json").read_text(encoding="utf-8"))
        cats = set(cfg["categories"])
        ids = [s["id"] for s in cfg["seats"]]
        self.assertEqual(len(ids), len(set(ids)), "duplicate seat id")
        for seat in cfg["seats"]:
            with self.subTest(seat=seat["id"]):
                self.assertIn(seat["pool"], cfg["pools"])
                self.assertIn(seat["speed"], ("fast", "medium", "slow"))
                self.assertTrue(set(seat["quality"]) <= cats, set(seat["quality"]) - cats)
                self.assertTrue(all(1 <= q <= 5 for q in seat["quality"].values()))
                self.assertTrue(set(seat.get("tested", [])) <= set(seat["quality"]))
        for rule in cfg["in_house"]["rules"]:
            self.assertIn(rule["category"], cats | {"*"})
            self.assertTrue(set(rule["levels"]) <= set(cfg["quality_levels"]))

    def test_in_house_work_stays_with_claude(self):
        out = self.route("pick", "design", "high")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout.strip().split("\t"), ["claude-opus", "claude", "opus"])

    def test_unknown_category_and_level_rejected(self):
        self.assertIn("unknown category", self.route("pick", "nonsense", "normal").stderr)
        self.assertIn("unknown quality", self.route("pick", "code", "perfect").stderr)

    def test_rate_requires_known_task(self):
        out = self.route("rate", "no-such-task", "pass")
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("not found", out.stderr)

    def test_shell_scripts_parse(self):
        for name in ["bin/dispatch.sh", "bin/snap.sh", "install.sh"]:
            with self.subTest(name=name):
                out = self.run_cmd("bash", "-n", str(SKILL / name))
                self.assertEqual(out.returncode, 0, out.stderr)

    def test_dispatch_refuses_home_as_workdir(self):
        task = self.copy / "tasks" / "20260101-unsafe.md"
        task.write_text(f"---\nworker: codex\nworkdir: {self.home}\n---\nDo nothing.\n")
        out = self.run_cmd("bash", str(self.copy / "bin" / "dispatch.sh"), str(task))
        self.assertEqual(out.returncode, 2)
        self.assertIn("refusing unsafe workdir", out.stderr)

    def test_dispatch_rejects_bad_frontmatter(self):
        project = Path(self.temp.name) / "project"
        project.mkdir()
        for fm, msg in [("worker: auto", "needs category"), ("worker: codex\nsandbox: none", "sandbox must be")]:
            with self.subTest(fm=fm):
                task = self.copy / "tasks" / "20260101-bad.md"
                task.write_text(f"---\n{fm}\nworkdir: {project}\n---\nx\n")
                out = self.run_cmd("bash", str(self.copy / "bin" / "dispatch.sh"), str(task))
                self.assertEqual(out.returncode, 2)
                self.assertIn(msg, out.stderr)

    @unittest.skipUnless(platform.system() == "Darwin", "installer is macOS only")
    def test_install_links_without_overwriting(self):
        dest = self.home / "ai-company"
        out = self.run_cmd("bash", str(self.copy / "install.sh"), "--home", str(dest))
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(os.readlink(self.home / ".claude/skills/ai-company"), str(dest))
        self.assertTrue(os.access(dest / "bin" / "dispatch.sh", os.X_OK))
        route = self.run_cmd(str(self.home / ".local/bin/ai-route"), "pick", "design", "critical")
        self.assertEqual(route.stdout.split("\t")[0], "claude-opus", route.stderr)
        again = self.run_cmd("bash", str(self.copy / "install.sh"), "--home", str(dest))
        self.assertNotEqual(again.returncode, 0)
        self.assertIn("already exists", again.stderr)


if __name__ == "__main__":
    unittest.main()
