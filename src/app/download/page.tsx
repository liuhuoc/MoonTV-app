'use client';

import { ArrowDown, Play, RotateCcw, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import PageLayout from '@/components/PageLayout';
import { processImageUrl } from '@/lib/utils';
import {
  cleanupOrphanedDownloads,
  deleteDownloadTask,
  getDownloadTasks,
  retryDownload,
  subscribeToDownloadUpdates,
  type DownloadTask,
} from '@/lib/download';

function DownloadPageClient() {
  const router = useRouter();
  const [tasks, setTasks] = useState<DownloadTask[]>([]);

  useEffect(() => {
    setTasks(getDownloadTasks());
    const unsubscribe = subscribeToDownloadUpdates(setTasks);
    return unsubscribe;
  }, []);

  // 按片名分组
  const groupedTasks = useMemo(() => {
    const map = new Map<string, DownloadTask[]>();
    tasks.forEach((task) => {
      const key = task.title;
      const arr = map.get(key) || [];
      arr.push(task);
      map.set(key, arr);
    });
    // 按创建时间排序（最新的在前面）
    return Array.from(map.entries()).sort((a, b) => {
      const aTime = Math.max(...a[1].map(t => t.createdAt));
      const bTime = Math.max(...b[1].map(t => t.createdAt));
      return bTime - aTime;
    });
  }, [tasks]);

  const handleDelete = useCallback(async (taskId: string) => {
    await deleteDownloadTask(taskId);
  }, []);

  const getGroupStatus = (group: DownloadTask[]) => {
    const allCompleted = group.every(t => t.status === 'completed');
    const hasDownloading = group.some(t => t.status === 'downloading');
    const hasFailed = group.some(t => t.status === 'failed');
    const completedCount = group.filter(t => t.status === 'completed').length;
    if (hasDownloading) return { label: '下载中', color: 'text-blue-500', bg: 'bg-blue-500' };
    if (allCompleted) return { label: '已完成', color: 'text-green-500', bg: 'bg-green-500' };
    if (hasFailed) return { label: `${completedCount}/${group.length} 完成`, color: 'text-yellow-500', bg: 'bg-yellow-500' };
    return { label: '等待中', color: 'text-gray-400', bg: 'bg-gray-400' };
  };

  return (
    <PageLayout activePath='/download'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 mb-20'>
        <h1 className='text-2xl font-bold text-gradient mb-8'>下载管理</h1>

        {groupedTasks.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-20 text-gray-500 dark:text-gray-400'>
            <ArrowDown className='w-16 h-16 mb-4 opacity-20' />
            <p className='text-lg font-medium'>暂无下载任务</p>
            <p className='text-sm mt-1 opacity-60'>在播放页面点击下载按钮添加任务</p>
          </div>
        ) : (
          <div className='space-y-4'>
            {groupedTasks.map(([title, group]) => {
              const status = getGroupStatus(group);
              const poster = group.find(t => t.poster)?.poster || '';
              const isMovie = group.length === 1 && group[0].episodeLabel === '完整版';

              return (
                <div
                  key={title}
                  className='glass rounded-2xl overflow-hidden'
                >
                  {/* 可点击的主区域 */}
                  <div
                    onClick={() => router.push(`/download/detail?title=${encodeURIComponent(title)}`)}
                    className='flex items-center gap-4 p-4 cursor-pointer hover:bg-white/5 dark:hover:bg-white/5 transition-colors'
                  >
                    {/* 封面 */}
                    <div className='flex-shrink-0 w-16 h-24 bg-gray-300 dark:bg-gray-700 rounded-lg overflow-hidden'>
                      {poster ? (
                        <img
                          src={processImageUrl(poster)}
                          alt={title}
                          className='w-full h-full object-cover'
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className='w-full h-full flex items-center justify-center text-gray-400'>
                          <ArrowDown className='w-6 h-6 opacity-30' />
                        </div>
                      )}
                    </div>

                    {/* 信息 */}
                    <div className='flex-1 min-w-0'>
                      <h3 className='font-semibold text-gray-900 dark:text-gray-100 truncate'>
                        {title}
                      </h3>
                      <div className='flex items-center gap-2 mt-1'>
                        <span className={`w-2 h-2 rounded-full ${status.bg} inline-block flex-shrink-0`} />
                        <span className={`text-xs ${status.color}`}>{status.label}</span>
                        {isMovie && (
                          <span className='text-xs text-gray-400 dark:text-gray-500'>电影</span>
                        )}
                        {!isMovie && (
                          <span className='text-xs text-gray-400 dark:text-gray-500'>
                            {group.length} 集
                          </span>
                        )}
                      </div>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1 truncate'>
                        {group[0]?.sourceName || ''}
                      </p>
                    </div>

                    {/* 快速操作 */}
                    <div className='flex items-center gap-1 flex-shrink-0' onClick={(e) => e.stopPropagation()}>
                      {/* 如果全部完成且是电影，点击播放 */}
                      {isMovie && group[0].status === 'completed' && (
                        <button
                          onClick={() => {
                            // 尝试用本地路径播放
                            const task = group[0];
                            if (task.localFileUri) {
                              router.push(`/play?source=local&id=${task.id}&title=${encodeURIComponent(task.title)}`);
                            }
                          }}
                          className='p-2 rounded-full hover:bg-green-500/10 text-green-500 transition-colors'
                          title='播放'
                        >
                          <Play size={18} />
                        </button>
                      )}
                      {group.some(t => t.status === 'failed') && (
                        <button
                          onClick={() => {
                            group.filter(t => t.status === 'failed').forEach(t => retryDownload(t.id));
                          }}
                          className='p-2 rounded-full hover:bg-yellow-500/10 text-yellow-500 transition-colors'
                          title='重试失败的'
                        >
                          <RotateCcw size={18} />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          group.forEach(t => handleDelete(t.id));
                        }}
                        className='p-2 rounded-full hover:bg-red-500/10 text-red-400 hover:text-red-500 transition-colors'
                        title='删除全部'
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
}

export default function DownloadPage() {
  return <DownloadPageClient />;
}