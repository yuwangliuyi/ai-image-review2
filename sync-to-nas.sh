#!/bin/bash
# ============================================
# 同步项目到群晖 NAS 并重新部署
# 用法: ./sync-to-nas.sh
# ============================================

set -e

# ===== 配置（改成你的群晖信息）=====
NAS_USER="你的群晖用户名"
NAS_IP="你的群晖IP"
NAS_PROJECT_DIR="/volume1/docker/ai-image-review"

echo "📦 同步项目文件到群晖..."

# 排除 node_modules、.next、.git、tmp
rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.git' \
  --exclude='tmp' \
  --exclude='public/uploads' \
  ./ ${NAS_USER}@${NAS_IP}:${NAS_PROJECT_DIR}/

echo "🔨 远程重新构建并重启容器..."
ssh ${NAS_USER}@${NAS_IP} "cd ${NAS_PROJECT_DIR} && docker compose up -d --build"

echo "✅ 部署完成！访问 http://${NAS_IP}:3000"
