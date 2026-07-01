'use client';

import Link from 'next/link';

import { BackButton } from './BackButton';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
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
