#!/bin/sh
set -e

echo "初始化数据库表结构..."
cd /app && node node_modules/prisma/build/index.js db push --skip-generate

echo "初始化账号（upsert 幂等，已有用户跳过）..."
cd /app && node prisma/seed.js

echo "启动 Next.js (端口 8001)..."
node server.js
