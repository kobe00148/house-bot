#!/bin/bash
# house-bot 一鍵部署腳本
# 用法 (從任何一台有 SSH 權限的電腦):  ssh stockbot '~/house-bot/deploy/deploy.sh'
set -e

cd "$(dirname "$0")/.."

echo "📥 拉取最新程式碼..."
git pull --ff-only

echo "📦 安裝依賴 (package.json 沒變動時會直接跳過)..."
npm install --omit=dev

echo "🔄 重啟 house-bot..."
pm2 restart house-bot

sleep 3
echo "---------- 最新 log ----------"
pm2 logs house-bot --lines 8 --nostream --raw
echo "✅ 部署完成"
