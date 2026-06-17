#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ATOMICMAIL_SRC="$ROOT/py/src/atomicmail"
LANGCHAIN_ATOMICMAIL="$ROOT/py/langchain/src/atomicmail"
VENDOR_DIR="$LANGCHAIN_ATOMICMAIL/vendor/shared"

rm -rf "$LANGCHAIN_ATOMICMAIL"
cp -a "$ATOMICMAIL_SRC" "$LANGCHAIN_ATOMICMAIL"

rm -rf "$LANGCHAIN_ATOMICMAIL/vendor"
mkdir -p "$(dirname "$VENDOR_DIR")"
cp -a "$ROOT/shared/." "$VENDOR_DIR/"

echo "Prepared langchain-atomicmail release tree at $LANGCHAIN_ATOMICMAIL"
