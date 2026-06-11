import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.moontv.app',
  appName: '月光TV',
  webDir: 'out',
  plugins: {
    ScreenOrientation: {
      lock: false
    },
    StatusBar: {
      style: 'dark',
      overlaysWebView: false
    }
  }
};

export default config;
