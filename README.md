# MoonTV

> 基于 Next.js 14 + Capacitor 的移动端影视聚合播放器，支持 Android APK 打包。

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-14-000?logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-38bdf8?logo=tailwindcss)
![Capacitor](https://img.shields.io/badge/Capacitor-6-119EFF?logo=capacitor)

</div>

---

## 功能特性

- **多源聚合搜索**：内置多个免费资源站点，一次搜索返回全源结果
- **分类浏览**：豆瓣热门电影、剧集、综艺分类展示
- **在线播放**：集成 ArtPlayer + HLS.js，支持 HLS 流播放
- **选集切换**：多源切换、正序/倒序排列
- **下载管理**：支持剧集下载，下载进度追踪，断点续传
- **播放记录**：自动记录观看进度，支持"继续观看"
- **主题切换**：支持亮色/暗色模式，跟随系统设置
- **PWA**：支持安装到桌面，离线缓存

## 技术栈

| 分类 | 依赖 |
|------|------|
| 框架 | Next.js 14 (App Router) |
| 语言 | TypeScript 5 |
| 样式 | Tailwind CSS 3 |
| 播放器 | ArtPlayer · HLS.js |
| 移动端 | Capacitor 6 |
| 通知 | SweetAlert2 |
| 图标 | Lucide React |

## 开发

```bash
# 安装依赖
npm install --legacy-peer-deps

# 启动开发服务器
npm run dev

# 静态导出构建
CAPACITOR=true npm run build

# 同步到 Android
npx cap sync
npx cap open android
```

## 构建 APK

```bash
# 1. 构建静态导出
CAPACITOR=true npm run build

# 2. 同步到 Android
npx cap sync

# 3. 用 Android Studio 打开 android/ 目录，Build → Build Bundle(s) / APK(s)
```

## 项目结构

```
src/
├── app/                    # Next.js App Router 页面
│   ├── page.tsx            # 首页（热门推荐）
│   ├── search/             # 搜索页
│   ├── play/               # 播放页
│   ├── douban/             # 豆瓣分类页
│   ├── download/           # 下载管理
│   │   └── detail/         # 下载详情
│   ├── history/            # 播放记录
│   └── settings/           # 设置页
├── components/             # 通用组件
│   ├── PageLayout.tsx      # 页面布局
│   ├── MobileBottomNav.tsx # 底部导航
│   ├── VideoCard.tsx       # 视频卡片
│   ├── EpisodeSelector.tsx # 选集/换源选择器
│   ├── ContinueWatching.tsx# 继续观看
│   ├── DoubanSelector.tsx  # 豆瓣分类选择器
│   ├── ScrollableRow.tsx   # 可滚动行
│   ├── ThemeProvider.tsx   # 主题提供者
│   ├── ThemeToggle.tsx     # 主题切换
│   ├── DebugConsole.tsx    # 调试控制台
│   └── ...
└── lib/                    # 工具库
    ├── downstream.ts       # 下游 API 调用
    ├── douban.client.ts    # 豆瓣数据接口
    ├── download.ts         # 下载管理
    ├── db.client.ts        # 本地存储
    ├── config.ts           # 站点配置
    ├── settings.ts         # 设置管理
    └── utils.ts            # 工具函数
```

## 配置

站点配置在 `config.json` 中，支持标准的苹果 CMS V10 API 格式：

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

在设置页的「源管理」中可以启用/停用/新增视频源。

## License

[MIT](LICENSE) © 2025 MoonTV

## 致谢

- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) — 网页视频播放器
- [HLS.js](https://github.com/video-dev/hls.js) — HLS 流媒体支持
- [LibreTV](https://github.com/LibreSpark/LibreTV) — 项目灵感
- 感谢所有提供免费影视接口的站点