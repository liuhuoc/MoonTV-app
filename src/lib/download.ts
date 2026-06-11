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
  localFileUri?: string;
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

/** 判断 URL 是否为 HLS 流 */
function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?.*)?$/i.test(url) || url.includes('.m3u8');
}

/** 解析 m3u8 播放列表，提取所有 .ts 片段 URL */
function parseM3u8Segments(m3u8Content: string, baseUrl: string): string[] {
  const lines = m3u8Content.split('\n');
  const segments: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // 跳过注释行、空行和标签行
    if (!trimmed || trimmed.startsWith('#')) continue;
    // 找到 .ts 片段
    if (trimmed.endsWith('.ts') || trimmed.includes('.ts')) {
      segments.push(resolveUrl(trimmed, baseUrl));
    }
  }
  return segments;
}

/** 解析相对 URL 为绝对 URL */
function resolveUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    // 如果 URL 解析失败，尝试手动拼接
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    const base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
    return base + url;
  }
}

/** 从 URL 提取基础 URL（目录部分） */
function getBaseUrl(url: string): string {
  const idx = url.lastIndexOf('/');
  if (idx > 0) {
    return url.substring(0, idx + 1);
  }
  return url;
}

/** 开始下载 */
export async function startDownload(taskId: string): Promise<void> {
  const tasks = getDownloadTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task || task.status === 'completed') return;

  updateDownloadTask(taskId, { status: 'downloading', error: undefined });

  try {
    const url = task.url;
    const safeTitle = task.title.replace(/[\/\\:*?"<>|]/g, '_');
    const safeLabel = task.episodeLabel.replace(/[\/\\:*?"<>|]/g, '_');
    const fileName = `${safeTitle}_${safeLabel}.ts`;

    if (isHlsUrl(url)) {
      // HLS 流：下载所有 ts 片段并合并
      await downloadHlsStream(taskId, url, fileName);
    } else if (isCapacitor()) {
      // Capacitor 环境：直接下载
      await downloadDirectCapacitor(taskId, url, fileName);
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

/** HLS 流下载（下载所有 ts 片段并合并为一个文件） */
async function downloadHlsStream(taskId: string, playlistUrl: string, fileName: string): Promise<void> {
  const baseUrl = getBaseUrl(playlistUrl);

  // 步骤 1: 获取 m3u8 播放列表
  let m3u8Content: string;
  if (isCapacitor()) {
    const response: HttpResponse = await CapacitorHttp.request({
      url: playlistUrl,
      method: 'GET',
      responseType: 'text',
      connectTimeout: 15000,
      readTimeout: 15000,
    });
    if (response.status < 200 || response.status >= 300 || !response.data) {
      throw new Error(`获取播放列表失败: HTTP ${response.status}`);
    }
    m3u8Content = response.data as string;
  } else {
    const response = await fetch(playlistUrl);
    if (!response.ok) {
      throw new Error(`获取播放列表失败: HTTP ${response.status}`);
    }
    m3u8Content = await response.text();
  }

  // 步骤 2: 解析 ts 片段列表
  const segments = parseM3u8Segments(m3u8Content, baseUrl);
  if (segments.length === 0) {
    throw new Error('播放列表中没有找到视频片段');
  }

  updateDownloadTask(taskId, {
    totalBytes: segments.length,
    downloadedBytes: 0,
    progress: 0,
    speed: '解析中...',
  });

  // 步骤 3: 下载所有片段
  const segmentBlobs: Blob[] = [];
  let totalDownloaded = 0;

  for (let i = 0; i < segments.length; i++) {
    const segUrl = segments[i];
    const segIndex = i + 1;

    updateDownloadTask(taskId, {
      speed: `下载片段 ${segIndex}/${segments.length}`,
    });

    try {
      const blob = await downloadSegment(taskId, segUrl, i, segments.length);
      segmentBlobs.push(blob);
      totalDownloaded += blob.size;

      const progress = Math.round(((i + 1) / segments.length) * 100);
      updateDownloadTask(taskId, {
        progress,
        downloadedBytes: totalDownloaded,
        totalBytes: totalDownloaded,
        speed: `${segIndex}/${segments.length} 片段`,
      });
    } catch (err) {
      throw new Error(`下载第 ${segIndex} 个片段失败: ${(err as Error).message}`);
    }
  }

  // 步骤 4: 合并所有片段
  updateDownloadTask(taskId, { speed: '正在合并片段...' });
  const combinedBlob = new Blob(segmentBlobs, { type: 'video/mp2t' });

  // 步骤 5: 保存文件
  if (isCapacitor()) {
    await saveBlobToCapacitor(taskId, combinedBlob, fileName);
  } else {
    saveBlobToBrowser(taskId, combinedBlob, fileName);
  }
}

/** 下载单个片段 */
async function downloadSegment(
  taskId: string,
  url: string,
  index: number,
  total: number
): Promise<Blob> {
  if (isCapacitor()) {
    const response: HttpResponse = await CapacitorHttp.request({
      url,
      method: 'GET',
      responseType: 'blob',
      connectTimeout: 30000,
      readTimeout: 60000,
    });
    if (response.status < 200 || response.status >= 300 || !response.data) {
      throw new Error(`HTTP ${response.status}`);
    }
    // CapacitorHttp returns base64 for blob responseType
    const base64 = response.data as string;
    const byteChars = atob(base64);
    const byteArrays: Uint8Array[] = [];
    const sliceLen = 1024;
    for (let offset = 0; offset < byteChars.length; offset += sliceLen) {
      const slice = byteChars.slice(offset, offset + sliceLen);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      byteArrays.push(new Uint8Array(byteNumbers));
    }
    return new Blob(byteArrays, { type: 'video/mp2t' });
  } else {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.blob();
  }
}

/** Capacitor 环境直接下载（非 HLS） */
async function downloadDirectCapacitor(taskId: string, url: string, fileName: string): Promise<void> {
  const blob = await downloadSegment(taskId, url, 0, 1);
  await saveBlobToCapacitor(taskId, blob, fileName);
}

/** 将 Blob 保存到 Capacitor Filesystem */
async function saveBlobToCapacitor(taskId: string, blob: Blob, fileName: string): Promise<void> {
  const arrayBuffer = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);

  const result = await Filesystem.writeFile({
    path: `Download/${fileName}`,
    data: base64,
    directory: Directory.ExternalStorage,
    recursive: true,
  });

  updateDownloadTask(taskId, {
    status: 'completed',
    progress: 100,
    downloadedBytes: blob.size,
    totalBytes: blob.size,
    speed: '完成',
    localPath: result.uri,
    localFileUri: result.uri,
  });
}

/** ArrayBuffer 转 Base64 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** 浏览器环境下载（带进度，非 HLS） */
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
        saveBlobToBrowser(taskId, blob, fileName);
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

/** 浏览器环境保存 Blob（触发下载） */
function saveBlobToBrowser(taskId: string, blob: Blob, fileName: string): void {
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
    localFileUri: blobUrl,
  });
}