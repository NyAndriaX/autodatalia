#!/usr/bin/env bash
#
# gen-secrets.sh — fill in unset secrets in infra/.env.production.
#
# Usage:
#   bash infra/gen-secrets.sh                 # edits infra/.env.production next to this script
#   bash infra/gen-secrets.sh path/to/.env    # edit a specific env file
#
# What it does:
#   - For BACKEND_AUTH_TOKEN, JWT_SECRET, TELEGRAM_WEBHOOK_SECRET:
#       fills with `openssl rand -hex 32` (64 hex chars).
#   - For MARIADB_PASSWORD, MARIADB_ROOT_PASSWORD:
#       fills with `openssl rand -hex 16` (32 hex chars).
#
# It only fills values that are UNSET — either empty (VAR=) or the literal
# placeholder VAR=__GENERATE__. A value the operator has already set is NEVER
# overwritten, so the script is safe to re-run (idempotent): a second run
# generates nothing because every secret now has a real value.
#
# The edit is done in place via a temp file + atomic mv (the original is left
# untouched if anything fails). It prints which variables it generated.
#
# NOTE: MARIADB_PASSWORD / MARIADB_ROOT_PASSWORD only take effect on the FIRST
# initialisation of the mariadb-data volume. If the DB volume already exists,
# generating a new password here will NOT change the password inside MariaDB —
# you must ALTER USER (or wipe the volume). See DEPLOY.md.

set -euo pipefail

# Resolve the target env file: first CLI arg, else .env.production next to this script.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="${1:-${script_dir}/.env.production}"

if [[ ! -f "${env_file}" ]]; then
  echo "error: env file not found: ${env_file}" >&2
  echo "       copy .env.production.example to .env.production first." >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "error: openssl is required but not installed." >&2
  exit 1
fi

# Secrets to generate, with the byte length passed to `openssl rand -hex`.
# hex 32 -> 64-char token; hex 16 -> 32-char password.
declare -A secret_bytes=(
  [BACKEND_AUTH_TOKEN]=32
  [JWT_SECRET]=32
  [TELEGRAM_WEBHOOK_SECRET]=32
  [MARIADB_PASSWORD]=16
  [MARIADB_ROOT_PASSWORD]=16
)

tmp_file="$(mktemp "${env_file}.XXXXXX.tmp")"
# Clean up the temp file on any exit path.
trap 'rm -f "${tmp_file}"' EXIT

generated=()

# A line is "unset" for VAR if it is exactly `VAR=` or `VAR=__GENERATE__`.
while IFS= read -r line || [[ -n "${line}" ]]; do
  matched=0
  for var in "${!secret_bytes[@]}"; do
    if [[ "${line}" == "${var}=" || "${line}" == "${var}=__GENERATE__" ]]; then
      value="$(openssl rand -hex "${secret_bytes[$var]}")"
      printf '%s=%s\n' "${var}" "${value}" >> "${tmp_file}"
      generated+=("${var}")
      matched=1
      break
    fi
  done
  if [[ "${matched}" -eq 0 ]]; then
    printf '%s\n' "${line}" >> "${tmp_file}"
  fi
done < "${env_file}"

# Preserve the original file mode, then atomically replace it.
if command -v stat >/dev/null 2>&1; then
  mode="$(stat -c '%a' "${env_file}" 2>/dev/null || echo '600')"
else
  mode='600'
fi
chmod "${mode}" "${tmp_file}" 2>/dev/null || true
mv "${tmp_file}" "${env_file}"
trap - EXIT

if [[ "${#generated[@]}" -eq 0 ]]; then
  echo "No unset secrets found in ${env_file} — nothing generated."
else
  echo "Generated ${#generated[@]} secret(s) in ${env_file}:"
  for var in "${generated[@]}"; do
    echo "  - ${var}"
  done
fi
