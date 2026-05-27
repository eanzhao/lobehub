#!/usr/bin/env bash
#
# brand-guard.sh — fail CI if user-visible LobeHub / LobeChat brand strings
# slip back into VALUES in src/locales/default/*.ts.
#
# Rules:
# - Only the VALUE part of each `key: value` line is checked. Keys (the part
#   before the first colon) are out of scope because they are code-level
#   identifiers that must stay stable across upstream rebases.
# - Comments, imports, and code-only lines (no string literal) are skipped
#   because they are not user-visible UI strings.
# - Lines tagged with the trailing marker `// brand-guard:allow` are also
#   allowed (used for legitimate upstream attribution lines such as the
#   About-page credit).
# - Lowercase `lobehub` / camelCase `lobeHub` are allowed because they appear
#   in URLs (support@lobehub.com), npm package names (@lobehub/cli), and
#   nested key segments (tools.lobehubSkill.*).
#
# Usage: bash tools/ci/brand-guard.sh
# Exits 1 if any user-visible LobeHub/LobeChat brand string remains in
# locale VALUES.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCALE_DIR="$REPO_ROOT/src/locales/default"

if [[ ! -d "$LOCALE_DIR" ]]; then
  echo "brand-guard: locale dir not found at $LOCALE_DIR" >&2
  exit 1
fi

violations=$(
  while IFS= read -r -d '' file; do
    awk -v file="$file" '
      # Skip comment-only / continuation-of-block-comment / decorator lines
      /^[[:space:]]*\/\// { next }
      /^[[:space:]]*\*/ { next }
      # Skip import / export statements
      /^[[:space:]]*(import|export)[[:space:]]/ { next }
      # Skip lines tagged for explicit allow
      /\/\/[[:space:]]*brand-guard:allow/ { next }
      # Skip lines that contain no string literal at all (pure code lines
      # such as `const providers = [LobeHubProvider, ...]`).
      !/['\''"`]/ { next }

      {
        line = $0

        # Split at the first colon that follows a quoted key:
        #   "key": value   |  \x27key\x27: value   |  `key`: value
        idx = match(line, /['\''"`][^'\''"`]*['\''"`][[:space:]]*:/)
        if (idx > 0) {
          # value side = everything after the matched key+colon
          value = substr(line, idx + RLENGTH)
        } else {
          # No `quoted-key:` pair on this line — treat the whole line as a
          # multi-line value continuation.
          value = line
        }

        # Brand check: PascalCase brand name with non-identifier boundary.
        if (value ~ /[^A-Za-z_]LobeHub/ ||
            value ~ /[^A-Za-z_]LobeChat/ ||
            value ~ /^LobeHub/ ||
            value ~ /^LobeChat/) {
          printf "%s:%d:%s\n", file, NR, $0
        }
      }
    ' "$file"
  done < <(find "$LOCALE_DIR" -name '*.ts' -print0)
)

if [[ -n "$violations" ]]; then
  echo "brand-guard: found user-visible LobeHub/LobeChat brand strings in locale VALUES under src/locales/default:" >&2
  echo "$violations" >&2
  echo >&2
  echo "Replace these with 'Aevatar' (only the VALUE — keys must stay)." >&2
  echo "If this is an intentional upstream-attribution line, append the" >&2
  echo "trailing comment '// brand-guard:allow' on the same line." >&2
  exit 1
fi

echo "brand-guard: OK — no user-visible LobeHub/LobeChat brand strings in src/locales/default"
