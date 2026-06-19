'use client';

import { useEffect } from 'react';

const StatusBarStyle = {
  Dark: 'DARK',
  Light: 'LIGHT',
} as const;

type StatusBarStyleValue = (typeof StatusBarStyle)[keyof typeof StatusBarStyle];

function isDarkTheme(): boolean {
  if (typeof window === 'undefined') return false;
  return document.documentElement.classList.contains('dark')
    ? true
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
}

async function setStatusBarStyle(style: StatusBarStyleValue) {
  try {
    const { StatusBar } = (window as any).Capacitor?.Plugins ?? {};
    if (!StatusBar?.setStyle) return;
    await StatusBar.setStyle({ style });
  } catch {
    // ignore errors on web
  }
}

export function ThemeStatusBar() {
  useEffect(() => {
    const applyStyle = () => {
      setStatusBarStyle(
        isDarkTheme() ? StatusBarStyle.Dark : StatusBarStyle.Light
      );
    };

    applyStyle();

    const observer = new MutationObserver(applyStyle);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener?.('change', applyStyle);

    return () => {
      observer.disconnect();
      media.removeEventListener?.('change', applyStyle);
    };
  }, []);

  return null;
}
