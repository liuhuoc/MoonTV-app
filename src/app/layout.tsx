import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';
import 'sweetalert2/dist/sweetalert2.min.css';

import { SiteProvider } from '../components/SiteProvider';
import { ThemeProvider } from '../components/ThemeProvider';
import DebugConsole from '../components/DebugConsole';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'MoonTV',
  description: '影视聚合',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#000000',
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang='zh-CN' suppressHydrationWarning>
      <head>
        <meta
          name='viewport'
          content='width=device-width, initial-scale=1.0, viewport-fit=cover'
        />
      </head>
      <body
        className={`${inter.className} min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-200`}
      >
        <ThemeProvider
          attribute='class'
          defaultTheme='system'
          enableSystem
          disableTransitionOnChange
        >
          <SiteProvider
            siteName='MoonTV'
            announcement='本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。'
          >
            {children}
            <DebugConsole />
          </SiteProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}