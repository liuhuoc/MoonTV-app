#!/bin/bash

# 使用方式:
#   bash scripts/build-apk.sh                          # 无后端服务器，仅加载内置前端资源
#   bash scripts/build-apk.sh https://myserver.com     # 指定后端服务器地址
#   CAPACITOR_SERVER_URL=https://myserver.com bash scripts/build-apk.sh  # 通过环境变量指定

SERVER_URL="${1:-$CAPACITOR_SERVER_URL}"

echo "🚀 开始构建月光TV APK..."

# 检查是否安装了必要的工具
if ! command -v pnpm &> /dev/null; then
    echo "❌ 错误: 未找到 pnpm，请先安装 pnpm"
    exit 1
fi

if ! command -v npx &> /dev/null; then
    echo "❌ 错误: 未找到 npx，请先安装 Node.js"
    exit 1
fi

# 清理之前的构建
echo "🧹 清理之前的构建文件..."
rm -rf out/
rm -rf android/app/build/

# 安装依赖
echo "📦 安装项目依赖..."
pnpm install

# 构建Next.js项目
echo "🔨 构建Next.js项目..."
pnpm build

# 同步到Capacitor
if [ -n "$SERVER_URL" ]; then
    echo "📱 同步到Capacitor (后端: $SERVER_URL)..."
    CAPACITOR_SERVER_URL="$SERVER_URL" npx cap sync android
else
    echo "📱 同步到Capacitor (无后端服务器)..."
    npx cap sync android
fi

# 构建Android项目
echo "🏗️ 构建Android项目..."
cd android

# 检查是否有签名配置
if [ -f "app/moontv-release-key.keystore" ]; then
    echo "🔐 使用现有签名配置构建Release版本..."
    ./gradlew assembleRelease
    if [ $? -eq 0 ]; then
        echo "✅ Release APK构建成功!"
        echo "📱 APK位置: android/app/build/outputs/apk/release/app-release.apk"
    else
        echo "❌ Release APK构建失败"
        exit 1
    fi
else
    echo "🔐 构建Debug版本..."
    ./gradlew assembleDebug
    if [ $? -eq 0 ]; then
        echo "✅ Debug APK构建成功!"
        echo "📱 APK位置: android/app/build/outputs/apk/debug/app-debug.apk"
    else
        echo "❌ Debug APK构建失败"
        exit 1
    fi
fi

cd ..

echo "🎉 APK构建完成!"
echo ""
echo "📋 构建信息:"
echo "   - 应用名称: 月光TV"
echo "   - 包名: com.moontv.app"
if [ -n "$SERVER_URL" ]; then
    echo "   - 运行模式: 远程服务器模式（后端: $SERVER_URL）"
else
    echo "   - 运行模式: 纯本地模式（无后端服务，仅前端UI可用）"
fi
echo "   - 支持功能: 全屏播放、横屏模式"
echo ""
echo "📱 安装说明:"
echo "   1. 将APK传输到Android设备"
echo "   2. 在设备上启用'未知来源'应用安装"
echo "   3. 安装APK文件"
echo "   4. 启动应用，点击全屏按钮体验横屏播放"