#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TS_DIR="${ROOT_DIR}/ts"
VERSION="${1:-}"

run_build() {
  if [[ -n "${VERSION}" ]]; then
    deno run -A "$1" "${VERSION}"
  else
    deno run -A "$1"
  fi
}

assert_file() {
  local path="$1"
  if [[ ! -f "${path}" ]]; then
    echo "Missing expected file: ${path}" >&2
    exit 1
  fi
}

assert_contains() {
  local pattern="$1"
  local path="$2"
  if ! rg -q "${pattern}" "${path}"; then
    echo "Missing pattern '${pattern}' in ${path}" >&2
    exit 1
  fi
}

assert_not_contains() {
  local pattern="$1"
  local path="$2"
  if rg -q "${pattern}" "${path}"; then
    echo "Unexpected pattern '${pattern}' in ${path}" >&2
    exit 1
  fi
}

sha256_of() {
  shasum -a 256 "$1" | awk '{print $1}'
}

echo "==> Building unified skill artifacts"
cd "${TS_DIR}"
run_build "build_skill_npm.ts"
run_build "build_skill.ts"
run_build "build_clawhub_skill.ts"
run_build "build_hermes_skill.ts"

echo "==> Running targeted skill build tests"
deno test --allow-read --allow-env --allow-write --allow-run \
  skill_build.test.ts clawhub_skill_build.test.ts hermes_skill_build.test.ts \
  unified_skill_rollout.test.ts

BUNDLED_DIR="${ROOT_DIR}/dist/skill/atomicmail"
CLAWHUB_DIR="${ROOT_DIR}/integrations_dist/clawhub/atomicmail"
HERMES_DIR="${ROOT_DIR}/integrations_dist/hermes/atomicmail"
UNIFIED_TAP_DIR="${ROOT_DIR}/integrations/skill/atomicmail"

echo "==> Checking required artifacts"
assert_file "${BUNDLED_DIR}/SKILL.md"
assert_file "${CLAWHUB_DIR}/SKILL.md"
assert_file "${HERMES_DIR}/SKILL.md"
assert_file "${BUNDLED_DIR}/scripts/atomicmail"
assert_file "${CLAWHUB_DIR}/scripts/atomicmail"
assert_file "${HERMES_DIR}/scripts/atomicmail"

echo "==> Verifying single-build overlay parity"
for rel in lib/esm/skill/cli.js lib/shared/manifest.json lib/presets/list_inbox.json; do
  bundled_sha="$(sha256_of "${BUNDLED_DIR}/${rel}")"
  clawhub_sha="$(sha256_of "${CLAWHUB_DIR}/${rel}")"
  hermes_sha="$(sha256_of "${HERMES_DIR}/${rel}")"
  echo "  ${rel}"
  echo "    bundled : ${bundled_sha}"
  echo "    clawhub : ${clawhub_sha}"
  echo "    hermes  : ${hermes_sha}"
  [[ "${bundled_sha}" == "${clawhub_sha}" ]] || {
    echo "Checksum mismatch for ${rel} (bundled vs clawhub)" >&2
    exit 1
  }
  [[ "${bundled_sha}" == "${hermes_sha}" ]] || {
    echo "Checksum mismatch for ${rel} (bundled vs hermes)" >&2
    exit 1
  }
done

if [[ -d "${UNIFIED_TAP_DIR}" ]]; then
  echo "==> Verifying optional unified tap sync parity"
  for rel in lib/esm/skill/cli.js lib/shared/manifest.json lib/presets/list_inbox.json; do
    tap_sha="$(sha256_of "${UNIFIED_TAP_DIR}/${rel}")"
    bundled_sha="$(sha256_of "${BUNDLED_DIR}/${rel}")"
    echo "  ${rel}"
    echo "    bundled : ${bundled_sha}"
    echo "    tap     : ${tap_sha}"
    [[ "${tap_sha}" == "${bundled_sha}" ]] || {
      echo "Checksum mismatch for ${rel} (bundled vs unified tap)" >&2
      exit 1
    }
  done
fi

echo "==> Verifying SKILL frontmatter and launcher invocations"
assert_contains "metadata:" "${BUNDLED_DIR}/SKILL.md"
assert_contains "openclaw:" "${BUNDLED_DIR}/SKILL.md"
assert_contains "hermes:" "${BUNDLED_DIR}/SKILL.md"
assert_contains "\\{baseDir\\}/scripts/atomicmail" "${BUNDLED_DIR}/SKILL.md"
assert_not_contains "npx --package" "${BUNDLED_DIR}/SKILL.md"
assert_not_contains "\\(\\./jmap\\.md#" "${BUNDLED_DIR}/SKILL.md"

assert_contains "metadata: \\{\\\"openclaw\\\"" "${CLAWHUB_DIR}/SKILL.md"
assert_contains "\\{baseDir\\}/scripts/atomicmail" "${CLAWHUB_DIR}/SKILL.md"
assert_not_contains "npx --package" "${CLAWHUB_DIR}/SKILL.md"
assert_not_contains "\\(\\./jmap\\.md#" "${CLAWHUB_DIR}/SKILL.md"

assert_contains "metadata:" "${HERMES_DIR}/SKILL.md"
assert_contains "  hermes:" "${HERMES_DIR}/SKILL.md"
assert_contains "\\$\\{HERMES_SKILL_DIR\\}/scripts/atomicmail" \
  "${HERMES_DIR}/SKILL.md"
assert_contains "ATOMIC_MAIL_CREDENTIALS_DIR" "${HERMES_DIR}/scripts/atomicmail"
assert_not_contains "npx --package" "${HERMES_DIR}/SKILL.md"
assert_not_contains "\\(\\./jmap\\.md#" "${HERMES_DIR}/SKILL.md"

echo "==> Verifying launcher behavior"
bash "${BUNDLED_DIR}/scripts/atomicmail" help --topic overview >/tmp/atomicmail-bundled-help.txt
bash "${CLAWHUB_DIR}/scripts/atomicmail" help --topic overview >/tmp/atomicmail-clawhub-help.txt
bash "${HERMES_DIR}/scripts/atomicmail" help --topic overview >/tmp/atomicmail-hermes-help.txt

assert_contains "Atomic Mail" /tmp/atomicmail-bundled-help.txt
assert_contains "Atomic Mail" /tmp/atomicmail-clawhub-help.txt
assert_contains "Atomic Mail" /tmp/atomicmail-hermes-help.txt

echo "Unified skill release verification passed."
