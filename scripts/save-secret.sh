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

# Catch the usual slips before saving: pasting the command, or the wrong thing, instead of the value.
bad() { echo "Not saved: $1" >&2; exit 1; }
case "$value" in
  *' '*|./*|*save-secret*) bad "that looks like a command or a sentence, not a value. Copy the value from the website and paste only that." ;;
esac
case "$name" in
  SUPABASE_ACCESS_TOKEN) printf "%s" "$value" | grep -Eq "^sbp_[A-Za-z0-9]{30,}$" || bad "a Supabase token starts with sbp_ and is about 44 characters long" ;;
  DISCORD_APP_ID) case "$value" in *[!0-9]*) bad "the Application ID is only digits (about 18 to 20 of them)" ;; esac ;;
  DISCORD_PUBLIC_KEY) printf '%s' "$value" | grep -Eq '^[0-9a-fA-F]{64}$' || bad "the Public Key is exactly 64 letters and numbers (0-9, a-f)" ;;
  DISCORD_BOT_TOKEN) [ "${#value}" -ge 50 ] || bad "a bot token is long (50+ characters); use Bot, then Reset Token" ;;
esac
touch .env.local
chmod 600 .env.local
grep -v "^$name=" .env.local > .env.local.tmp || true
printf '%s=%s\n' "$name" "$value" >> .env.local.tmp
mv .env.local.tmp .env.local
chmod 600 .env.local
echo "Saved $name to .env.local (git ignores this file)."
