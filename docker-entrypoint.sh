#!/bin/sh
set -e

cd /app
node scripts/check-database.mjs
echo "启动 Next.js..."
exec node scripts/start-server.mjs
