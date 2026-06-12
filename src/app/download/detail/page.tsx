'use client';

import { ArrowLeft, Pause, Play, RotateCcw, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import PageLayout from '@/components/PageLayout';
import { processImageUrl } from '@/lib/utils';
import {
  deleteDownloadTask,
  formatBytes,
  getDownloadTasks,
  pauseDownload,
  resumeDownload,
  retryDownload,
  subscribeToDownloadUpdates,
  type DownloadTask,
} from '@/lib/download';

function DownloadDetailClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const title = searchParams?.get('title') || '';

  const [allTasks, setAllTasks] = useState<DownloadTask[]>([]);

  useEffect(() => {
    setAllTasks(getDownloadTasks());
    const unsubscribe = subscribeToDownloadUpdates(setAllTasks);
    return unsubscribe;
  }, []);

  // 筛选出当前标题的所有任务
  const tasks = useMemo(() => {
    return allTasks
      .filter(t => t.title === title)
      .sort((a, b) => {
        // 按集数排序
        const aNum = parseInt(a.episodeLabel.replace(/[^0-9]/g, ''), 10) || 0;
        const bNum = parseInt(b.episodeLabel.replace(/[^0-9]/g, ''), 10) || 0;
        return aNum - bNum;
      });
  }, [allTasks, title]);

  const poster = tasks.find(t => t.poster)?.poster || '';
  const sourceName = tasks[0]?.sourceName || '';

  const handleDelete = useCallback(async (taskId: string) => {
    await deleteDownloadTask(taskId);
    // 如果删完了所有任务，返回列表
    const remaining = getDownloadTasks().filter(t => t.title === title);
    if (remaining.length === 0) {
      router.back();
    }
  }, [title, router]);

  const handlePlayEpisode = (task: DownloadTask) => {
    if (task.status !== 'completed') return;
    if (task.localFileUri) {
      router.push(`/play?source=local&id=${task.id}&title=${encodeURIComponent(task.title)}&episode=${encodeURIComponent(task.episodeLabel)}`);
    }
  };

  const completedCount = tasks.filter(t => t.status === 'completed').length;

  return (
    <PageLayout activePath='/download'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 mb-20'>
        {/* 头部 */}
        <div className='flex items-center gap-4 mb-6'>
          <button
            onClick={() => router.back()}
            className='w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
          >
            <ArrowLeft className='w-5 h-5 text-gray-600 dark:text-gray-300' />
          </button>
          <h1 className='text-2xl font-bold text-gradient truncate flex-1'>
            {title}
          </h1>
        </div>

        {/* 封面和信息 */}
        <div className='glass rounded-2xl p-5 mb-6'>
          <div className='flex gap-5'>
            {/* 封面 */}
            <div className='flex-shrink-0 w-24 h-36 bg-gray-300 dark:bg-gray-700 rounded-xl overflow-hidden'>
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
                  <Play className='w-8 h-8 opacity-30' />
                </div>
              )}
            </div>

            {/* 信息 */}
            <div className='flex-1 min-w-0'>
              <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>{title}</h2>
              <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>{sourceName}</p>
              <div className='flex items-center gap-4 mt-3'>
                <div className='text-sm'>
                  <span className='text-gray-500 dark:text-gray-400'>共 </span>
                  <span className='font-semibold text-gray-900 dark:text-gray-100'>{tasks.length}</span>
                  <span className='text-gray-500 dark:text-gray-400'> 集</span>
                </div>
                <div className='text-sm'>
                  <span className='text-gray-500 dark:text-gray-400'>已完成 </span>
                  <span className='font-semibold text-green-500'>{completedCount}</span>
                  <span className='text-gray-500 dark:text-gray-400'> 集</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 剧集列表 */}
        {tasks.length === 0 ? (
          <div className='text-center py-12 text-gray-500 dark:text-gray-400'>
            暂无下载记录
          </div>
        ) : (
          <div className='space-y-2'>
            {tasks.map((task) => (
              <div
                key={task.id}
                className={`glass rounded-xl p-4 flex items-center gap-4 transition-all ${
                  task.status === 'completed' ? 'cursor-pointer hover:bg-green-500/5' : ''
                }`}
                onClick={() => handlePlayEpisode(task)}
              >
                {/* 状态图标 */}
                <div className='flex-shrink-0'>
                  {task.status === 'completed' ? (
                    <div className='w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center'>
                      <Play className='w-4 h-4 text-green-500' />
                    </div>
                  ) : task.status === 'downloading' ? (
                    <div className='w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center'>
                      <div className='w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin' />
                    </div>
                  ) : task.status === 'failed' ? (
                    <div className='w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center'>
                      <X className='w-4 h-4 text-red-500' />
                    </div>
                  ) : task.status === 'paused' ? (
                    <div className='w-8 h-8 rounded-full bg-yellow-500/10 flex items-center justify-center'>
                      <Pause className='w-4 h-4 text-yellow-500' />
                    </div>
                  ) : (
                    <div className='w-8 h-8 rounded-full bg-gray-500/10 flex items-center justify-center'>
                      <div className='w-2 h-2 rounded-full bg-gray-400' />
                    </div>
                  )}
                </div>

                {/* 剧集信息 */}
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-2'>
                    <h3 className='font-medium text-gray-900 dark:text-gray-100'>
                      {task.episodeLabel}
                    </h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      task.status === 'completed' ? 'bg-green-500/10 text-green-500' :
                      task.status === 'downloading' ? 'bg-blue-500/10 text-blue-500' :
                      task.status === 'failed' ? 'bg-red-500/10 text-red-500' :
                      task.status === 'paused' ? 'bg-yellow-500/10 text-yellow-500' :
                      'bg-gray-500/10 text-gray-500'
                    }`}>
                      {task.status === 'completed' ? '已完成' :
                       task.status === 'downloading' ? '下载中' :
                       task.status === 'failed' ? '失败' :
                       task.status === 'paused' ? '已暂停' :
                       '等待中'}
                    </span>
                  </div>

                  {/* 进度条（下载中/暂停时显示） */}
                  {(task.status === 'downloading' || task.status === 'paused') && (
                    <div className='mt-2 space-y-1'>
                      <div className='w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden'>
                        <div
                          className='h-full bg-blue-500 rounded-full transition-all duration-300'
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                      <div className='flex justify-between text-xs text-gray-500'>
                        <span>{task.progress}%</span>
                        <span>{task.speed}</span>
                        <span>{formatBytes(task.downloadedBytes)}</span>
                      </div>
                    </div>
                  )}

                  {/* 失败信息 */}
                  {task.status === 'failed' && task.error && (
                    <p className='text-xs text-red-500 mt-1'>{task.error}</p>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className='flex items-center gap-1 flex-shrink-0' onClick={(e) => e.stopPropagation()}>
                  {(task.status === 'pending' || task.status === 'paused' || task.status === 'failed') && (
                    <button
                      onClick={() => {
                        if (task.status === 'failed') retryDownload(task.id);
                        else resumeDownload(task.id);
                      }}
                      className='p-2 rounded-full hover:bg-green-500/10 text-green-500 transition-colors'
                      title={task.status === 'failed' ? '重试' : '开始下载'}
                    >
                      {task.status === 'failed' ? <RotateCcw size={18} /> : <Play size={18} />}
                    </button>
                  )}
                  {task.status === 'downloading' && (
                    <button
                      onClick={() => pauseDownload(task.id)}
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
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}

export default function DownloadDetailPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-500">加载中...</div>}>
      <DownloadDetailClient />
    </Suspense>
  );
}