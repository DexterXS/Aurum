#!/bin/sh
# Runs automatically before nginx starts.
#
# Aurum's backend has no login system by design, so this nginx layer protects
# every /api route when AURUM_BASIC_AUTH_USER and AURUM_BASIC_AUTH_PASSWORD are
# configured. The SPA shell itself stays public; LoginGate renders Aurum's own
# login form before any protected API request is sent.
set -eu

AUTH_FRAGMENT=/etc/nginx/basic-auth.conf

if [ -n "${AURUM_BASIC_AUTH_USER:-}" ] && [ -n "${AURUM_BASIC_AUTH_PASSWORD:-}" ]; then
  HASH="$(openssl passwd -apr1 "$AURUM_BASIC_AUTH_PASSWORD")"
  echo "${AURUM_BASIC_AUTH_USER}:${HASH}" > /etc/nginx/.htpasswd
  cat > "$AUTH_FRAGMENT" <<EOF
auth_basic "Aurum";
auth_basic_user_file /etc/nginx/.htpasswd;
EOF
  echo "[aurum] Basic auth enabled for user '${AURUM_BASIC_AUTH_USER}'."
else
  : > "$AUTH_FRAGMENT"
  echo "[aurum] WARNING: AURUM_BASIC_AUTH_USER / AURUM_BASIC_AUTH_PASSWORD are not set." >&2
  echo "[aurum] This instance has NO authentication." >&2
fi
