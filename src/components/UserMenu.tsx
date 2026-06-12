'use client';

import { Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';

export const UserMenu: React.FC = () => {
  const router = useRouter();

  return (
    <div className='relative'>
      <button
        onClick={() => router.push('/settings')}
        className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors'
        aria-label='Settings'
      >
        <Settings className='w-full h-full' />
      </button>
    </div>
  );
};