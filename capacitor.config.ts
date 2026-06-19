import type { CapacitorConfig } from '@capacitor/cli';

// 通过环境变量 CAPACITOR_SERVER_URL 配置自己的后端地址
// 示例: CAPACITOR_SERVER_URL=https://my-server.com npx cap sync android
const serverUrl = process.env.CAPACITOR_SERVER_URL

const config: CapacitorConfig = {
  appId: 'com.moontv.app',
  appName: '月光TV',
  webDir: 'out',
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          cleartext: serverUrl.startsWith('http://'),
        },
      }
    : {}),
  plugins: {
    ScreenOrientation: {
      lock: false,
    },
    StatusBar: {
      overlaysWebView: false,
    },
  },
};

export default config;