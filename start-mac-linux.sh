#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Нужен Node.js 22 или новее: https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm ci
echo "Открываем CRM на http://127.0.0.1:4173 . Остановить: Ctrl+C"
npm run local
