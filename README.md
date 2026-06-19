# MoonTV

> 基于 Next.js 14 + Capacitor 7 的移动端影视聚合播放器，支持 Android APK 打包与自动发布。

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-14-000?logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-38bdf8?logo=tailwindcss)
![Capacitor](https://img.shields.io/badge/Capacitor-7-119EFF?logo=capacitor)
![GitHub Actions](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=github-actions)

</div>

---

## 功能特性

- **多源聚合搜索**：内置多个免费资源站点，一次搜索返回全源结果
- **分类浏览**：豆瓣热门电影、剧集、综艺分类展示
- **在线播放**：集成 ArtPlayer + HLS.js，支持 HLS 流播放
- **选集切换**：多源切换、正序/倒序排列
- **下载管理**：支持剧集下载，下载进度追踪，断点续传
- **播放记录**：自动记录观看进度，支持"继续观看"
- **主题切换**：支持亮色/暗色模式，跟随系统设置，状态栏自动适配
- **PWA**：支持安装到桌面，离线缓存
- **自动发布**：每次推送自动构建签名 APK 并发布到 GitHub Release

## 技术栈

| 分类 | 依赖 |
|------|------|
| 框架 | Next.js 14 (App Router) |
| 语言 | TypeScript 5 |
| 样式 | Tailwind CSS 3 |
| 播放器 | ArtPlayer · HLS.js |
| 移动端 | Capacitor 7 |
| 通知 | SweetAlert2 |
| 图标 | Lucide React |

## 开发

### 前置条件

- Node.js 20+
- pnpm 10+

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 静态导出构建（用于移动端打包）
CAPACITOR=true pnpm build

# 同步到 Android
npx cap sync android
npx cap open android
```

## 构建 APK

### 自动构建（GitHub Actions）

推送到 `main` 分支会自动触发 Actions，完成：
1. 静态导出 Next.js 项目
2. 构建签名 APK
3. 自动创建 GitHub Release 并附带 APK

### 手动构建

```bash
# 1. 构建静态导出
CAPACITOR=true pnpm build

# 2. 同步到 Android
npx cap sync android

# 3. 构建 Release APK
cd android
./gradlew assembleRelease
```

APK 输出路径：`android/app/build/outputs/apk/release/app-release.apk

**版本号规则**：版本名 = `1.0.<commit 数>`，随每次推送到主分支自动递增。

## 项目结构

```
src/
├── app/                    # Next.js App Router 页面
│   ├── page.tsx          # 首页（热门推荐）
│   ├── search/           # 搜索页
│   ├── play/            # 播放页
│   ├── douban/          # 豆瓣分类页
│   ├── download/        # 下载管理
│   ├── history/         # 播放记录
│   └── settings/        # 设置页
├── components/             # 通用组件
│   ├── PageLayout.tsx     # 页面布局
│   ├── MobileBottomNav.tsx # 底部导航
│   ├── VideoCard.tsx      # 视频卡片
│   ├── EpisodeSelector.tsx # 选集/换源选择器
│   ├── ContinueWatching.tsx # 继续观看
│   ├── DoubanSelector.tsx # 豆瓣分类选择器
│   ├── ThemeStatusBar.tsx # 主题状态栏适配
│   ├── ThemeProvider.tsx # 主题提供者
│   └── ThemeToggle.tsx  # 主题切换
└── lib/                 # 工具库
│   ├── runtime.ts        # 运行时站点配置（由 convert-config.js 自动生成）
│   ├── downstream.ts     # 下游 API 调用
│   ├── douban.client.ts # 豆瓣数据接口
│   ├── download.ts      # 下载管理
│   ├── settings.ts      # 设置管理
│   └── utils.ts          # 工具函数
android/                   # Capacitor Android 原生工程，直接修改签名配置
```

## 配置

站点视频源配置在根目录的 `config.json` 中，支持标准的苹果 CMS V10 API 格式。

在设置页的「源管理」中可以启用/停用/新增视频源。

```json
{
  "api_site": {
    "360zy": {
      "api": "https://example.com/api.php/provide/vod",
      "name": "360资源"
    }
  }
}
```

## License

[MIT](LICENSE) © 2025 MoonTV

## 致谢

- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) — 网页视频播放器
- [HLS.js](https://github.com/video-dev/hls.js) — HLS 流媒体支持
- 感谢所有提供免费影视接口的站点
