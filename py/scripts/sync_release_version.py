#!/usr/bin/env python3
"""Sync release version into langchain-atomicmail pyproject.toml."""

from __future__ import annotations

import re
import sys
from pathlib import Path

SEMVER_RE = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][\w.-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][\w.-]*))*))?"
    r"(?:\+([\w.-]+))?$"
)

LANGCHAIN_PYPROJECT = (
    Path(__file__).resolve().parents[1] / "langchain" / "pyproject.toml"
)


def parse_release_version(raw: str) -> str:
    trimmed = raw.strip()
    if not trimmed:
        raise SystemExit(
            "Version is required (expected semver, e.g. 0.1.2 or v1.0.0)."
        )
    version = trimmed.removeprefix("v")
    if not SEMVER_RE.fullmatch(version):
        raise SystemExit(
            f'Invalid semver: "{raw}" (expected e.g. 0.1.2, 1.0.0-beta.1, or v2.0.0).'
        )
    return version


def set_project_version(path: Path, version: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(
        r'(?m)^version = "[^"]+"',
        f'version = "{version}"',
        text,
        count=1,
    )
    if count != 1:
        raise SystemExit(f"Could not update version in {path}")
    path.write_text(updated, encoding="utf-8")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(
            "Usage: python scripts/sync_release_version.py <version>",
            file=sys.stderr,
        )
        print("Example: python scripts/sync_release_version.py v0.1.2", file=sys.stderr)
        return 1

    version = parse_release_version(argv[1])
    set_project_version(LANGCHAIN_PYPROJECT, version)
    print(version)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
