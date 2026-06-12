'use client';

import { ArrowDown, Pause, Play, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import PageLayout from '@/components/PageLayout';
import {
  cleanupOrphanedDownloads,
  deleteDownloadTask,
  formatBytes,
  getDownloadTasks,
  startDownload,
  subscribeToDownloadUpdates,
  type DownloadTask,
} from '@/lib/download';

function DownloadPageClient() {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);

  useEffect(() => {
    setTasks(getDownloadTasks());
    const unsubscribe = subscribeToDownloadUpdates(setTasks);
    // 清理孤儿下载文件（已删除任务残留的ts片段等垃圾文件）
    cleanupOrphanedDownloads().catch(() => { /* 忽略清理错误 */ });
    return unsubscribe;
  }, []);

  const handleStart = useCallback(async (taskId: string) => {
    await startDownload(taskId);
  }, []);

  const handleDelete = useCallback(async (taskId: string) => {
    await deleteDownloadTask(taskId);
  }, []);

  return (
    <PageLayout activePath='/download'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 mb-20'>
        <h1 className='text-2xl font-bold text-gradient mb-8'>下载管理</h1>

        {tasks.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-20 text-gray-500 dark:text-gray-400'>
            <ArrowDown className='w-16 h-16 mb-4 opacity-20' />
            <p className='text-lg font-medium'>暂无下载任务</p>
            <p className='text-sm mt-1 opacity-60'>在播放页面点击下载按钮添加任务</p>
          </div>
        ) : (
          <div className='space-y-3'>
            {tasks.map((task) => (
              <div
                key={task.id}
                className='glass rounded-2xl p-4 space-y-3'
              >
                {/* 标题行 */}
                <div className='flex items-start justify-between gap-3'>
                  <div className='flex-1 min-w-0'>
                    <h3 className='font-semibold text-gray-900 dark:text-gray-100 truncate'>
                      {task.title}
                    </h3>
                    <p className='text-xs text-gray-500 dark:text-gray-400 mt-0.5'>
                      {task.episodeLabel} · {task.sourceName}
                    </p>
                  </div>
                  <div className='flex items-center gap-1'>
                    {/* 操作按钮 */}
                    {(task.status === 'pending' || task.status === 'paused' || task.status === 'failed') && (
                      <button
                        onClick={() => handleStart(task.id)}
                        className='p-2 rounded-full hover:bg-green-500/10 text-green-500 transition-colors'
                        title='开始下载'
                      >
                        <Play size={18} />
                      </button>
                    )}
                    {task.status === 'downloading' && (
                      <button
                        className='p-2 rounded-full hover:bg-yellow-500/10 text-yellow-500 transition-colors'
                        title='暂停'
                      >
                        <Pause size={18} />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(task.id)}
                      className='p-2 rounded-full hover:bg-red-500/10 text-red-400 hover:text-red-500 transition-colors'
                      title='删除'
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* 进度条 */}
                {task.status === 'downloading' && (
                  <div className='space-y-1.5'>
                    <div className='w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden'>
                      <div
                        className='h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-300'
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                    <div className='flex justify-between text-xs text-gray-500'>
                      <span>{task.progress}%</span>
                      <span>{task.speed}</span>
                      <span>{formatBytes(task.downloadedBytes)} / {task.totalBytes > 0 ? formatBytes(task.totalBytes) : '未知'}</span>
                    </div>
                  </div>
                )}

                {task.status === 'completed' && (
                  <div className='text-xs text-green-500 flex items-center gap-1'>
                    <span className='w-2 h-2 rounded-full bg-green-500 inline-block' />
                    已完成
                  </div>
                )}

                {task.status === 'failed' && (
                  <div className='text-xs text-red-500'>
                    失败: {task.error || '未知错误'}
                  </div>
                )}

                {task.status === 'pending' && (
                  <div className='text-xs text-gray-400'>等待开始下载</div>
                )}

                {task.status === 'paused' && (
                  <div className='text-xs text-yellow-500'>已暂停</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}

export default function DownloadPage() {
  return <DownloadPageClient />;
}