'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

import { BackButton } from './BackButton';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { useSite } from './SiteProvider';

interface MobileHeaderProps {
  showBackButton?: boolean;
}

const MobileHeader = ({ showBackButton = false }: MobileHeaderProps) => {
  const { siteName } = useSite();
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const refreshSafeArea = () => {
      if (!headerRef.current) return;
      const el = headerRef.current;
      // 强制触发重排，确保safe-area-inset正确计算
      el.style.display = 'none';
      void el.offsetHeight;
      el.style.display = '';
    };

    // 页面可见性变化时刷新（侧滑返回等场景）
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setTimeout(refreshSafeArea, 50);
      }
    };

    // 页面显示时刷新（包括从缓存恢复）
    const handlePageShow = () => {
      setTimeout(refreshSafeArea, 50);
    };

    // 窗口大小变化时刷新
    const handleResize = () => {
      refreshSafeArea();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('resize', handleResize);

    // 初始加载时也刷新一次
    setTimeout(refreshSafeArea, 100);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <header ref={headerRef} className="md:hidden w-full glass mobile-header-safe">
      <div className="h-12 flex items-center px-4">
        {/* 左侧：返回按钮 */}
        <div className="flex items-center w-10">
          {showBackButton && <BackButton />}
        </div>

        {/* 中间：Logo */}
        <div className="flex-1 flex justify-center">
          <Link
            href="/"
            className="text-lg font-extrabold text-gradient tracking-tight hover:opacity-80 transition-opacity"
          >
            {siteName}
          </Link>
        </div>

        {/* 右侧：主题切换 + 设置 */}
        <div className="flex items-center gap-0.5">
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
};

export default MobileHeader;
