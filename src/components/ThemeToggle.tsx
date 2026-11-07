/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */

'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/** 首页的分块入场动画：切换主题时一次性摘掉，避免快照捕获到动画中间态或动画重播 */
const ENTRANCE_CLASSES = [
  'fade-in',
  'fade-in-up',
  'fade-in-down',
  'fade-in-up-delay-1',
  'fade-in-up-delay-2',
  'fade-in-up-delay-3',
  'fade-in-up-delay-4',
  'fade-in-up-delay-5',
  'fade-in-up-delay-6',
];

function freezeEntranceAnimations(): void {
  if (typeof document === 'undefined') return;
  document
    .querySelectorAll(`.${ENTRANCE_CLASSES.join(', .')}`)
    .forEach((el) => el.classList.remove(...ENTRANCE_CLASSES));
}

/** 只更新状态栏颜色，不再写 html/body 的 inline 背景（会与 CSS 主题色打架） */
function setThemeColorMeta(theme?: string): void {
  if (typeof document === 'undefined') return;
  const color = theme === 'dark' ? '#0c111c' : '#f9fbfe';
  let meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]'
  );
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
}

/**
 * Capacitor WebView 上 View Transition 需要截取整页位图快照，
 * 首页 DOM/图片量大时合成会按块栅格化，出现「一块一块变化」。
 * App 内直接同步切主题，浏览器里才保留轻量淡入。
 */
function isCapacitorWebView(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  if (!cap) return false;
  return typeof cap.isNativePlatform === 'function'
    ? Boolean(cap.isNativePlatform())
    : true;
}

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
    setThemeColorMeta(resolvedTheme);
  }, []);

  if (!mounted) {
    // 渲染一个占位符以避免布局偏移
    return <div className='w-10 h-10' />;
  }

  const toggleTheme = () => {
    const targetTheme = resolvedTheme === 'dark' ? 'light' : 'dark';

    freezeEntranceAnimations();

    // flushSync 保证 DOM 在 View Transition 捕获新快照之前已经更新完毕
    const applyTheme = () => {
      setThemeColorMeta(targetTheme);
      flushSync(() => setTheme(targetTheme));
    };

    if (isCapacitorWebView() || !(document as any).startViewTransition) {
      applyTheme();
      return;
    }

    (document as any).startViewTransition(applyTheme);
  };

  return (
    <button
      onClick={toggleTheme}
      className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors'
      aria-label='Toggle theme'
    >
      {resolvedTheme === 'dark' ? (
        <Sun className='w-full h-full' />
      ) : (
        <Moon className='w-full h-full' />
      )}
    </button>
  );
}
