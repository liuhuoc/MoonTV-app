#!/bin/bash

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
echo "📱 同步到Capacitor..."
npx cap sync android

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
echo "   - 运行模式: 本地模式（资源内置于APK中）"
echo "   - 支持功能: 全屏播放、横屏模式"
echo ""
echo "📱 安装说明:"
echo "   1. 将APK传输到Android设备"
echo "   2. 在设备上启用'未知来源'应用安装"
echo "   3. 安装APK文件"
echo "   4. 启动应用，点击全屏按钮体验横屏播放"
