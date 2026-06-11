'use client';

import Link from 'next/link';
import { Settings } from 'lucide-react';

import { BackButton } from './BackButton';
import { useSite } from './SiteProvider';

interface MobileHeaderProps {
  showBackButton?: boolean;
}

const MobileHeader = ({ showBackButton = false }: MobileHeaderProps) => {
  const { siteName } = useSite();
  return (
    <header className="md:hidden w-full glass mobile-header-safe">
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

        {/* 右侧：设置入口 */}
        <div className="flex items-center justify-end w-10">
          <Link
            href="/settings"
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            aria-label="设置"
          >
            <Settings size={18} />
          </Link>
        </div>
      </div>
    </header>
  );
};

export default MobileHeader;
