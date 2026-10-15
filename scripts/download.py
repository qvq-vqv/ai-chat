"""Download release data, verify its pinned hash, and unpack without executing it."""
import argparse
import hashlib
import io
from pathlib import Path, PurePosixPath
import re
import stat
import urllib.parse
import urllib.request
import zipfile

VERSION = "v3.1.0-beta.2"
URL = f"https://github.com/qvq-vqv/ai-chat/releases/download/{VERSION}/ai-company-{VERSION}.zip"
MAX_ARCHIVE = 16 * 1024 * 1024
MAX_FILE = 8 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
MAX_FILES = 500
DOWNLOAD_HOSTS = {"github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}


def validate_download_url(url):
    target = urllib.parse.urlparse(url)
    if (target.scheme != "https" or target.hostname not in DOWNLOAD_HOSTS
            or target.username or target.password or target.port not in (None, 443)):
        raise ValueError("Unexpected download destination")
    return url


class TrustedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_download_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)



def unpack(data, expected, destination):
    if not re.fullmatch(r"[a-fA-F0-9]{64}", expected):
        raise ValueError("SHA-256 must be 64 hexadecimal characters")
    if len(data) > MAX_ARCHIVE or hashlib.sha256(data).hexdigest() != expected.lower():
        raise ValueError("Archive size or SHA-256 mismatch; nothing extracted")
    out = Path(destination)
    if out.exists() or out.is_symlink():
        raise ValueError("Destination already exists; select a new directory")
    out.parent.resolve(strict=True)
    files, names, total = {}, set(), 0
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        entries = z.infolist()
        if not entries or len(entries) > MAX_FILES:
            raise ValueError("Archive entry count is outside allowed limits")
        for info in entries:
            name = info.filename
            mode = (info.external_attr >> 16) & 0o170000
            parts = PurePosixPath(name).parts
            if (not parts or name != info.orig_filename or name.startswith("/")
                    or "\\" in name or ":" in name or "\x00" in name
                    or any(p in (".", "..") for p in name.split("/"))
                    or str(PurePosixPath(name)) != name
                    or not re.fullmatch(r"[A-Za-z0-9_./-]+", name)
                    or mode not in (0, stat.S_IFREG) or info.is_dir()
                    or info.flag_bits & 1 or name.casefold() in names):
                raise ValueError("Unsafe, duplicate, encrypted or non-file archive entry")
            if info.file_size > MAX_FILE:
                raise ValueError("Archive file exceeds size limit")
            total += info.file_size
            if total > MAX_TOTAL:
                raise ValueError("Archive expanded size exceeds limit")
            names.add(name.casefold())
            with z.open(info) as stream:
                body = stream.read(MAX_FILE + 1)
            if len(body) != info.file_size or len(body) > MAX_FILE:
                raise ValueError("Archive entry size mismatch")
            body.decode("utf-8", errors="strict")
            files[name] = body
    # Reject a file that would also have to be a parent directory.
    folded = {name.casefold() for name in files}
    if any(str(parent).casefold() in folded for name in files
           for parent in PurePosixPath(name).parents if str(parent) != "."):
        raise ValueError("Archive contains conflicting file and directory names")
    out.mkdir(mode=0o700)  # Exclusive creation, only after all validation.
    for name, body in files.items():
        target = out.joinpath(*PurePosixPath(name).parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as stream:
            stream.write(body)
    return out.resolve()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sha256", required=True, help="Expected hash from trusted release instructions")
    parser.add_argument("--archive", type=Path, help="Verify an already downloaded ZIP instead of using the network")
    parser.add_argument("--out", type=Path, default=Path(f"ai-company-{VERSION}"))
    args = parser.parse_args()
    if args.archive:
        with args.archive.open("rb") as stream:
            data = stream.read(MAX_ARCHIVE + 1)
    else:
        with urllib.request.build_opener(TrustedRedirect()).open(validate_download_url(URL), timeout=60) as response:
            validate_download_url(response.url)
            data = response.read(MAX_ARCHIVE + 1)
    result = unpack(data, args.sha256, args.out)
    print(f"Verified and unpacked: {result}")
    print(f"Give this file to your project AI: {result / 'AI_COMPANY_START.md'}")
    print("Downloaded only. No global skills, accounts, workers or services were changed.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit(f"Download stopped: {error}")
