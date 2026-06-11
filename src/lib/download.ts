'use client';

import { CapacitorHttp, type HttpResponse } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

/** 下载任务状态 */
export type DownloadStatus = 'pending' | 'downloading' | 'paused' | 'completed' | 'failed';

/** 下载任务 */
export interface DownloadTask {
  id: string;
  title: string;
  episodeLabel: string;
  sourceName: string;
  url: string;
  status: DownloadStatus;
  progress: number; // 0-100
  downloadedBytes: number;
  totalBytes: number;
  speed: string;
  createdAt: number;
  localPath?: string;
  error?: string;
}

const STORAGE_KEY = 'download_tasks';

/** 检查是否在 Capacitor 环境 */
function isCapacitor(): boolean {
  try {
    return typeof CapacitorHttp !== 'undefined' && typeof CapacitorHttp.request === 'function';
  } catch {
    return false;
  }
}

/** 获取所有下载任务 */
export function getDownloadTasks(): DownloadTask[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** 保存下载任务列表 */
function saveTasks(tasks: DownloadTask[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  // 通知订阅者
  window.dispatchEvent(new CustomEvent('downloadsUpdated', { detail: tasks }));
}

/** 监听下载更新 */
export function subscribeToDownloadUpdates(
  callback: (tasks: DownloadTask[]) => void
): () => void {
  const handler = (e: Event) => {
    callback((e as CustomEvent).detail);
  };
  window.addEventListener('downloadsUpdated', handler);
  return () => window.removeEventListener('downloadsUpdated', handler);
}

/** 生成唯一 ID */
function generateId(): string {
  return `dl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/** 格式化文件大小 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** 添加下载任务 */
export function addDownloadTask(task: Omit<DownloadTask, 'id' | 'status' | 'progress' | 'downloadedBytes' | 'totalBytes' | 'speed' | 'createdAt'>): DownloadTask {
  const newTask: DownloadTask = {
    ...task,
    id: generateId(),
    status: 'pending',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speed: '0 B/s',
    createdAt: Date.now(),
  };
  const tasks = getDownloadTasks();
  // 检查是否已存在相同 URL
  const exists = tasks.find(t => t.url === task.url && t.status !== 'failed');
  if (exists) return exists;
  tasks.unshift(newTask);
  saveTasks(tasks);
  return newTask;
}

/** 更新下载任务 */
export function updateDownloadTask(id: string, updates: Partial<DownloadTask>): void {
  const tasks = getDownloadTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return;
  tasks[idx] = { ...tasks[idx], ...updates };
  saveTasks(tasks);
}

/** 删除下载任务 */
export function deleteDownloadTask(id: string): void {
  const tasks = getDownloadTasks().filter(t => t.id !== id);
  saveTasks(tasks);
}

/** 暂停所有下载 */
export function pauseAllDownloads(): void {
  const tasks = getDownloadTasks();
  tasks.forEach(t => {
    if (t.status === 'downloading') {
      t.status = 'paused';
    }
  });
  saveTasks(tasks);
}

/** 开始下载 */
export async function startDownload(taskId: string): Promise<void> {
  const tasks = getDownloadTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task || task.status === 'completed') return;

  updateDownloadTask(taskId, { status: 'downloading', error: undefined });

  try {
    const url = task.url;
    const fileName = `${task.title.replace(/[\/\\:*?"<>|]/g, '_')}_${task.episodeLabel}.ts`;

    if (isCapacitor()) {
      // Capacitor 环境：使用 CapacitorHttp 下载
      const response: HttpResponse = await CapacitorHttp.request({
        url,
        method: 'GET',
        responseType: 'blob',
        connectTimeout: 30000,
        readTimeout: 30000,
      });

      if (response.status >= 200 && response.status < 300 && response.data) {
        // 保存到 Downloads 目录
        const result = await Filesystem.writeFile({
          path: `Download/${fileName}`,
          data: response.data as string,
          directory: Directory.ExternalStorage,
          recursive: true,
        });

        updateDownloadTask(taskId, {
          status: 'completed',
          progress: 100,
          downloadedBytes: response.data ? (response.data as string).length : 0,
          totalBytes: response.data ? (response.data as string).length : 0,
          speed: '完成',
          localPath: result.uri,
        });
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } else {
      // 浏览器环境：使用 XMLHttpRequest 获取进度
      await downloadWithProgress(taskId, url, fileName);
    }
  } catch (error) {
    updateDownloadTask(taskId, {
      status: 'failed',
      error: (error as Error).message || '下载失败',
    });
  }
}

/** 浏览器环境下载（带进度） */
function downloadWithProgress(taskId: string, url: string, fileName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let lastBytes = 0;
    let lastTime = Date.now();

    xhr.open('GET', url, true);
    xhr.responseType = 'blob';

    xhr.onprogress = (e) => {
      if (e.lengthComputable) {
        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000;
        const bytesDiff = e.loaded - lastBytes;
        const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;

        lastBytes = e.loaded;
        lastTime = now;

        updateDownloadTask(taskId, {
          progress: Math.round((e.loaded / e.total) * 100),
          downloadedBytes: e.loaded,
          totalBytes: e.total,
          speed: formatBytes(speed) + '/s',
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const blob = xhr.response as Blob;
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);

        updateDownloadTask(taskId, {
          status: 'completed',
          progress: 100,
          speed: '完成',
        });
        resolve();
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.ontimeout = () => reject(new Error('下载超时'));
    xhr.timeout = 60000;

    xhr.send();
  });
}