#!/bin/sh
# Save one secret to .env.local without it appearing on screen, in shell history, or in chat.
# Usage: ./scripts/save-secret.sh NAME
set -e
name="$1"
case "$name" in
  ''|*[!A-Z0-9_]*) echo "Usage: $0 NAME   (capital letters, digits and underscores)" >&2; exit 2 ;;
esac
cd "$(dirname "$0")/.."
printf 'Paste the value for %s, then press Enter (nothing will show): ' "$name"
stty -echo 2>/dev/null || true
IFS= read -r value
stty echo 2>/dev/null || true
printf '\n'
[ -n "$value" ] || { echo "Nothing entered, nothing saved." >&2; exit 1; }
touch .env.local
chmod 600 .env.local
grep -v "^$name=" .env.local > .env.local.tmp || true
printf '%s=%s\n' "$name" "$value" >> .env.local.tmp
mv .env.local.tmp .env.local
chmod 600 .env.local
echo "Saved $name to .env.local (git ignores this file)."
