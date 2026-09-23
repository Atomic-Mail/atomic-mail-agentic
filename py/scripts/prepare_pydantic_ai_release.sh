#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ATOMICMAIL_SRC="$ROOT/py/src/atomicmail"
PYDANTIC_AI_ATOMICMAIL="$ROOT/py/pydantic_ai/src/atomicmail"
VENDOR_DIR="$PYDANTIC_AI_ATOMICMAIL/vendor/shared"

rm -rf "$PYDANTIC_AI_ATOMICMAIL"
cp -a "$ATOMICMAIL_SRC" "$PYDANTIC_AI_ATOMICMAIL"

rm -rf "$PYDANTIC_AI_ATOMICMAIL/vendor"
mkdir -p "$(dirname "$VENDOR_DIR")"
cp -a "$ROOT/shared/." "$VENDOR_DIR/"

echo "Prepared pydantic-ai-atomicmail release tree at $PYDANTIC_AI_ATOMICMAIL"
