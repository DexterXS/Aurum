#!/bin/sh
set -eu

echo "[aurum] Railway web startup"

if [ -z "${AURUM_BACKEND_HOST:-}" ]; then
  echo "[aurum] ERROR: AURUM_BACKEND_HOST is not set" >&2
  exit 1
fi

BACKEND_PORT="${AURUM_BACKEND_PORT:-8000}"

sed -i "s|http://backend:8000|http://${AURUM_BACKEND_HOST}:${BACKEND_PORT}|g" /etc/nginx/conf.d/default.conf

/docker-entrypoint.d/20-basic-auth.sh
/docker-entrypoint.d/25-allowed-hosts.sh

nginx -t
exec nginx -g 'daemon off;'
