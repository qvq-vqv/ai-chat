import contextlib
import hashlib
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import download
import release


def archive(entries):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data, mode in entries:
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            info.external_attr = mode << 16
            z.writestr(info, data)
    return stream.getvalue()


REG = stat.S_IFREG | 0o644


class DistributionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def extract(self, data, expected=None):
        return download.unpack(data, expected or hashlib.sha256(data).hexdigest(), self.root / "new")

    def test_valid_archive_preserves_bytes_without_execution(self):
        data = archive([("AI_COMPANY_START.md", b"entry", REG), ("scripts/a.py", b"raise RuntimeError('not run')", REG)])
        out = self.extract(data)
        self.assertEqual((out / "AI_COMPANY_START.md").read_bytes(), b"entry")
        self.assertEqual((out / "scripts/a.py").stat().st_mode & 0o111, 0)

    def test_hash_mismatch_writes_nothing(self):
        with self.assertRaises(ValueError):
            self.extract(archive([("a", b"x", REG)]), "0" * 64)
        self.assertFalse((self.root / "new").exists())

    def test_existing_destination_and_symlink_preserved(self):
        target = self.root / "new"
        target.mkdir()
        (target / "owner.txt").write_text("owner")
        data = archive([("a", b"x", REG)])
        with self.assertRaises(ValueError):
            self.extract(data)
        self.assertEqual((target / "owner.txt").read_text(), "owner")
        target.rename(self.root / "owner")
        target.symlink_to(self.root / "owner", target_is_directory=True)
        with self.assertRaises(ValueError):
            self.extract(data)

    def test_path_escape_windows_and_ambiguous_names(self):
        for name in ["../outside", "/absolute", "a/../outside", "a//b", "a\\b", "C:/outside", "./a"]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.extract(archive([(name, b"x", REG)]))
            self.assertFalse((self.root / "new").exists())

    def test_links_and_special_entries_rejected(self):
        for mode in [stat.S_IFLNK | 0o777, stat.S_IFIFO | 0o600, stat.S_IFDIR | 0o755]:
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                self.extract(archive([("link", b"../outside", mode)]))

    def test_duplicate_case_and_parent_file_conflicts(self):
        for entries in [[("a", b"x", REG), ("A", b"y", REG)],
                        [("A", b"x", REG), ("a/b", b"y", REG)]]:
            with self.assertRaises(ValueError):
                self.extract(archive(entries))
            self.assertFalse((self.root / "new").exists())

    def test_size_and_entry_limits_before_writing(self):
        data = archive([("a", b"long contents", REG)])
        for name, value in [("MAX_ARCHIVE", 1), ("MAX_FILE", 1), ("MAX_TOTAL", 1), ("MAX_FILES", 0)]:
            with patch.object(download, name, value), self.assertRaises(ValueError):
                self.extract(data)
        self.assertFalse((self.root / "new").exists())

    def test_corrupt_empty_and_binary_archive_do_not_write(self):
        for data in [b"not a zip", archive([]), archive([("a", b"\xff", REG)])]:
            with self.assertRaises((ValueError, zipfile.BadZipFile, UnicodeError)):
                self.extract(data)
        self.assertFalse((self.root / "new").exists())

    def test_download_failure_does_not_create_destination(self):
        out = self.root / "new"
        with patch("sys.argv", ["download.py", "--sha256", "0" * 64, "--out", str(out)]), \
                patch.object(download.urllib.request, "urlopen", side_effect=OSError("offline")), \
                self.assertRaises(OSError):
            download.main()
        self.assertFalse(out.exists())

    def fixture(self):
        root = self.root / "source"
        root.mkdir()
        (root / "AI_COMPANY_START.md").write_text("public entry")
        (root / "release-files.json").write_text(json.dumps({
            "version": release.VERSION, "files": ["AI_COMPANY_START.md", "release-files.json"]}))
        return root

    def test_explicit_allowlist_excludes_unlisted_private_data(self):
        root = self.fixture()
        (root / ".env").write_text("private")
        (root / "personal-notes.md").write_text("private")
        files = release.read_public(root)
        self.assertEqual(set(files), {"AI_COMPANY_START.md", "release-files.json"})

    def test_build_is_deterministic_and_manifest_matches_zip(self):
        root = self.fixture()
        a, ah = release.build(root, self.root / "first")
        b, bh = release.build(root, self.root / "second")
        self.assertEqual(ah, bh)
        self.assertEqual(a.read_bytes(), b.read_bytes())
        with zipfile.ZipFile(a) as z:
            manifest = json.loads(z.read("PUBLIC-MANIFEST.json"))
            self.assertEqual(set(z.namelist()), set(manifest["files"]) | {"PUBLIC-MANIFEST.json"})
            for name, expected in manifest["files"].items():
                self.assertEqual(hashlib.sha256(z.read(name)).hexdigest(), expected)

    def test_allowlisted_symlink_rejected(self):
        root = self.fixture()
        (root / "AI_COMPANY_START.md").unlink()
        (self.root / "outside").write_text("owner")
        (root / "AI_COMPANY_START.md").symlink_to(self.root / "outside")
        with self.assertRaises(ValueError):
            release.read_public(root)

    def test_privacy_patterns_block_content_not_print_secret(self):
        root = self.fixture()
        for body in ["/" + "Users" + "/fictional/project", "ghp_" + "Z" * 30,
                     "-----BEGIN " + "PRIVATE KEY-----", "wxid_" + "fictional"]:
            (root / "AI_COMPANY_START.md").write_text(body)
            with self.assertRaises(ValueError) as error:
                release.read_public(root)
            self.assertNotIn(body, str(error.exception))

    def test_allowlist_rejects_traversal_duplicates_and_output_collision(self):
        root = self.fixture()
        for names in [["../outside"], ["AI_COMPANY_START.md", "ai_company_start.md"],
                      ["PUBLIC-MANIFEST.json"], [".env"], ["a/../b"]]:
            (root / "release-files.json").write_text(json.dumps({"version": release.VERSION, "files": names}))
            with self.assertRaises(ValueError):
                release.read_public(root)


if __name__ == "__main__":
    unittest.main()
