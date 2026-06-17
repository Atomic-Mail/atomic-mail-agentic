#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENDOR_DIR="$ROOT/py/src/atomicmail/vendor/shared"

rm -rf "$ROOT/py/src/atomicmail/vendor"
mkdir -p "$(dirname "$VENDOR_DIR")"
cp -a "$ROOT/shared/." "$VENDOR_DIR/"

echo "Bundled shared assets into $VENDOR_DIR"
