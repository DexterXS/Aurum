#!/bin/sh
# Optional single-user gate for Aurum's /api routes.
#
# Do NOT use nginx auth_basic here. auth_basic answers failed credentials with
# `401 WWW-Authenticate: Basic`, and mobile Chrome may turn that response into
# its own native username/password dialog even when the React app deliberately
# sent a probe Authorization header. Aurum already has a branded login screen,
# so that browser dialog is both confusing and, on some clients, blocks the app.
#
# Instead we compare the incoming Basic Authorization header ourselves and
# return 403 on a mismatch. 403 intentionally carries no WWW-Authenticate
# challenge, so the browser leaves the response to the React login flow.
# The credentials still travel only inside HTTPS when the public Railway URL is
# used. This remains a temporary single-user gate, not a multi-user auth system.
set -eu

AUTH_FRAGMENT=/etc/nginx/basic-auth.conf

if [ -n "${AURUM_BASIC_AUTH_USER:-}" ] && [ -n "${AURUM_BASIC_AUTH_PASSWORD:-}" ]; then
  EXPECTED_BASIC="$(printf '%s:%s' "$AURUM_BASIC_AUTH_USER" "$AURUM_BASIC_AUTH_PASSWORD" | base64 | tr -d '\r\n')"
  cat > "$AUTH_FRAGMENT" <<EOF
if (\$http_authorization != "Basic ${EXPECTED_BASIC}") {
  return 403;
}
EOF
  echo "[aurum] API auth enabled for user '${AURUM_BASIC_AUTH_USER}' (challenge-free 403 mode)."
else
  : > "$AUTH_FRAGMENT"
  echo "[aurum] WARNING: AURUM_BASIC_AUTH_USER / AURUM_BASIC_AUTH_PASSWORD are not set." >&2
  echo "[aurum] This instance has NO authentication — anyone who can reach it can read," >&2
  echo "[aurum] edit, and delete all financial data. Fine for 'localhost only'. Before" >&2
  echo "[aurum] exposing this beyond your own machine, set both variables in .env." >&2
fi
