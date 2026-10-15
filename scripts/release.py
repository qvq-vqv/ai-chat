"""Build a deterministic public ZIP from an explicit file allowlist."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

VERSION = "v3.1.0-beta.2"
PRIVATE_PARTS = {".ai-company", ".codex", ".gemini", ".git", "node_modules", "__pycache__"}
# These are detection rules, not a claim that pattern scanning finds every secret.
RULES = {
    "personal_home": re.compile(r"/(?:Users|home)/[A-Za-z0-9_.-]+/"),
    "temporary_private_path": re.compile(r"/var/" r"folders/"),
    "wechat_identity": re.compile(r"wxid_[A-Za-z0-9_]+"),
    "github_token": re.compile(r"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})"),
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "provider_secret": re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}"),
}


UUID = re.compile(r"\b[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\b")
EMAIL = re.compile(r"\b[A-Za-z0-9_.+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
# Explicit fictional fixtures only. Tests are scanned like every other file.
FIXTURE_UUIDS = {
    "12345678-1234-1234-1234-123456789abc",
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
}
RULES.update({
    "aws_key": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "google_key": re.compile(r"\bAIza[A-Za-z0-9_-]{30,}"),
    "slack_token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}"),
    "jwt": re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
})


def privacy_findings(content):
    hits = [label for label, pattern in RULES.items() if pattern.search(content)]
    if any(m.group().lower() not in FIXTURE_UUIDS for m in UUID.finditer(content)):
        hits.append("non_fixture_uuid")
    safe_domains = {"example.com", "example.org", "example.net", "example.test", "users.noreply.github.com"}
    if any(m.group().rsplit("@", 1)[1].lower() not in safe_domains for m in EMAIL.finditer(content)):
        hits.append("personal_email")
    return hits


def read_public(root):
    root = Path(root).resolve(strict=True)
    policy = json.loads((root / "release-files.json").read_text())
    names = policy["files"]
    if (policy.get("version") != VERSION or not isinstance(names, list) or not names
            or any(not isinstance(name, str) for name in names)
            or len(names) != len({name.casefold() for name in names})):
        raise ValueError("Invalid or duplicate release allowlist")
    files = {}
    for name in sorted(names):
        path = PurePosixPath(name)
        if (name == "PUBLIC-MANIFEST.json" or str(path) != name or path.is_absolute() or ".." in path.parts
                or "\\" in name or ":" in name or not re.fullmatch(r"[A-Za-z0-9_./-]+", name)
                or PRIVATE_PARTS.intersection(path.parts)
                or any(part.startswith(".") for part in path.parts)
                and name not in {".gitignore", ".github/workflows/test.yml"}):
            raise ValueError(f"Non-public path in allowlist: {name}")
        file = root.joinpath(*path.parts)
        if any(parent.is_symlink() for parent in [file, *file.parents] if parent != root.parent):
            raise ValueError(f"Symlink not allowed: {name}")
        if not stat.S_ISREG(file.lstat().st_mode):
            raise ValueError(f"Not a regular file: {name}")
        data = file.read_bytes()
        content = data.decode("utf-8", errors="strict")
        hits = privacy_findings(content)
        if hits:
            raise ValueError(f"Public-content scan failed in {name}: {', '.join(hits)}")
        files[name] = data
    return files


def build(root, destination):
    files = read_public(root)
    manifest = {"version": VERSION, "hash_algorithm": "SHA-256",
                "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
    files["PUBLIC-MANIFEST.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / f"ai-company-{VERSION}.zip"
    with archive.open("xb") as stream, zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 10, 15, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (destination / "SHA256SUMS").write_text(f"{digest}  {archive.name}\n")
    (destination / "PUBLIC-MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return archive, digest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    archive, digest = build(args.root, args.out)
    print(json.dumps({"archive": str(archive), "sha256": digest}))
