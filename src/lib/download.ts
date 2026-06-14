'use client';

import { CapacitorHttp, type HttpResponse, Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { getDownloadSettings } from './settings';

const activeAbortControllers = new Map<string, AbortController>();

/** 下载任务状态 */
export type DownloadStatus = 'pending' | 'downloading' | 'paused' | 'completed' | 'failed';

/** 下载任务 */
export interface DownloadTask {
  id: string;
  title: string;
  episodeLabel: string;
  sourceName: string;
  url: string;
  poster?: string;
  status: DownloadStatus;
  progress: number; // 0-100
  downloadedBytes: number;
  totalBytes: number;
  speed: string;
  createdAt: number;
  localPath?: string;
  localFileUri?: string;
  error?: string;
  writeDirectory?: string;
  segmentCount?: number;
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
export async function deleteDownloadTask(id: string): Promise<void> {
  const tasks = getDownloadTasks();
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  const filtered = tasks.filter(t => t.id !== id);
  saveTasks(filtered);

  // 浏览器环境：清理 IndexedDB 中的片段
  if (!isCapacitor()) {
    try {
      await deleteSegmentsFromIndexedDB(id);
    } catch {
      // 忽略
    }
  }
}

/** 清理该任务在 IndexedDB 中的片段数据 */
async function deleteSegmentsFromIndexedDB(taskId: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.open('MoonTVDownloads', 1);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('segments')) {
        db.close();
        resolve();
        return;
      }
      const tx = db.transaction('segments', 'readwrite');
      const store = tx.objectStore('segments');
      // 删除所有匹配前缀的 key
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          if (typeof cursor.key === 'string' && cursor.key.startsWith(taskId)) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    };
    request.onerror = () => resolve();
  });
}

export function pauseDownload(taskId: string): void {
  const ctrl = activeAbortControllers.get(taskId);
  if (ctrl) {
    try { ctrl.abort(); } catch { /* ignore */ }
    activeAbortControllers.delete(taskId);
  }
  updateDownloadTask(taskId, { status: 'paused' });
}

export function resumeDownload(taskId: string): void {
  updateDownloadTask(taskId, { status: 'pending' });
  startDownload(taskId);
}

export function retryDownload(taskId: string): void {
  updateDownloadTask(taskId, {
    status: 'pending',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    error: undefined,
    speed: '',
  });
  startDownload(taskId);
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

/** 检查 m3u8 是否为 Master Playlist（包含 #EXT-X-STREAM-INF） */
function isMasterPlaylist(content: string): boolean {
  return content.includes('#EXT-X-STREAM-INF');
}

/** 从 Master Playlist 中选择第一个视频 variant 的 m3u8 URL */
function extractFirstVariantUrl(content: string, baseUrl: string): string | null {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('#EXT-X-STREAM-INF')) {
      for (let j = i + 1; j < lines.length; j++) {
        const trimmed = lines[j].trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        return resolveUrl(trimmed, baseUrl);
      }
    }
  }
  return null;
}

/** 解析 m3u8 播放列表，提取所有媒体片段 URL */
function parseM3u8Segments(m3u8Content: string, baseUrl: string): string[] {
  const lines = m3u8Content.split('\n');
  const segments: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // 匹配常见片段格式：.ts, .m4s, .mp4, .aac, .cmfv, .cmfa
    if (
      trimmed.endsWith('.ts') ||
      trimmed.endsWith('.m4s') ||
      trimmed.endsWith('.mp4') ||
      trimmed.endsWith('.aac') ||
      trimmed.endsWith('.cmfv') ||
      trimmed.endsWith('.cmfa') ||
      trimmed.includes('.ts?') ||
      trimmed.includes('.m4s?')
    ) {
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

/** 尝试启动下一个等待中的下载任务 */
export function tryStartNextPending(): void {
  const settings = getDownloadSettings();
  const tasks = getDownloadTasks();
  const running = tasks.filter(t => t.status === 'downloading').length;
  if (running >= settings.maxConcurrent) return;

  const next = tasks.find(t => t.status === 'pending');
  if (next) {
    // 异步启动，不阻塞当前调用
    startDownload(next.id);
  }
}

/** 开始下载 */
export async function startDownload(taskId: string): Promise<void> {
  const tasks = getDownloadTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task || task.status === 'completed') return;

  // 检查并发限制
  const settings = getDownloadSettings();
  const running = tasks.filter(t => t.status === 'downloading').length;
  if (task.status !== 'downloading' && running >= settings.maxConcurrent) {
    // 达到上限，标记为等待中
    updateDownloadTask(taskId, { status: 'pending', error: undefined });
    return;
  }

  updateDownloadTask(taskId, { status: 'downloading', error: undefined });

  const controller = new AbortController();
  activeAbortControllers.set(taskId, controller);

  try {
    const url = task.url;
    const safeTitle = task.title.replace(/[\/\\:*?"<>|]/g, '_');
    const safeLabel = task.episodeLabel.replace(/[\/\\:*?"<>|]/g, '_');
    const fileName = `${safeTitle}_${safeLabel}.ts`;

    if (isHlsUrl(url)) {
      await downloadHlsStream(taskId, url, fileName, controller.signal);
    } else if (isCapacitor()) {
      await downloadDirectCapacitor(taskId, url, fileName, controller.signal);
    } else {
      await downloadWithProgress(taskId, url, fileName, controller.signal);
    }
  } catch (error) {
    updateDownloadTask(taskId, {
      status: 'failed',
      error: (error as Error).message || '下载失败',
    });
    if (isCapacitor() && isHlsUrl(task.url)) {
      const safeTitle = task.title.replace(/[/\\:*?"<>|]/g, '_').slice(0, 40);
      const safeLabel = task.episodeLabel.replace(/[/\\:*?"<>|]/g, '_').slice(0, 20);
      const dirPath = `Download/${safeTitle}/${safeLabel}`;
      try { await Filesystem.rmdir({ path: dirPath, directory: Directory.Data, recursive: true }); } catch { /* ignore */ }
      try { await Filesystem.rmdir({ path: dirPath, directory: Directory.Library, recursive: true }); } catch { /* ignore */ }
    }
  } finally {
    // 下载完成或失败后，尝试启动下一个等待中的任务
    activeAbortControllers.delete(taskId);
    tryStartNextPending();
  }
}

/** HLS 流下载（下载所有 ts 片段合并为单个文件） */
async function downloadHlsStream(taskId: string, playlistUrl: string, fileName: string, signal?: AbortSignal): Promise<void> {
  const fetchM3u8Content = async (url: string): Promise<string> => {
    if (isCapacitor()) {
      const response: HttpResponse = await CapacitorHttp.request({
        url,
        method: 'GET',
        responseType: 'text',
        connectTimeout: 15000,
        readTimeout: 15000,
      });
      if (response.status < 200 || response.status >= 300 || !response.data) {
        throw new Error(`获取播放列表失败: HTTP ${response.status}`);
      }
      return response.data as string;
    } else {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`获取播放列表失败: HTTP ${response.status}`);
      }
      return response.text();
    }
  };

  let m3u8Content = await fetchM3u8Content(playlistUrl);
  let workUrl = playlistUrl;

  if (isMasterPlaylist(m3u8Content)) {
    const variantUrl = extractFirstVariantUrl(m3u8Content, getBaseUrl(playlistUrl));
    if (!variantUrl) {
      throw new Error('Master Playlist 中未找到变体流');
    }
    workUrl = variantUrl;
    m3u8Content = await fetchM3u8Content(variantUrl);
  }

  const baseUrl = getBaseUrl(workUrl);

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

  // 步骤 3: 下载所有片段到内存，合并保存为单个文件
  let totalDownloaded = 0;

  if (signal?.aborted) throw new Error('下载已取消');

  const tasks = getDownloadTasks();
  const task = tasks.find(t => t.id === taskId);
  const safeTitle = (task?.title || 'unknown').replace(/[/\\:*?"<>|]/g, '_').slice(0, 40);
  const safeLabel = (task?.episodeLabel || 'episode').replace(/[/\\:*?"<>|]/g, '_').slice(0, 20);
  const dirPath = `Download/${safeTitle}/${safeLabel}`;

  // 浏览器环境：下载所有片段到 IndexedDB
  if (!isCapacitor()) {
    for (let i = 0; i < segments.length; i++) {
      if (signal?.aborted) throw new Error('下载已取消');
      const segIndex = i + 1;
      updateDownloadTask(taskId, { speed: `下载片段 ${segIndex}/${segments.length}` });
      let blob: Blob | null = null;
      let lastErr: Error | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try { blob = await downloadSegment(segments[i], signal); break; }
        catch (err) { lastErr = err as Error; if (attempt < 3 && !signal?.aborted) await new Promise(r => setTimeout(r, 1000 * attempt)); }
      }
      if (!blob) throw new Error(`下载第 ${segIndex} 个片段失败(重试3次): ${lastErr?.message || '未知错误'}`);
      await saveSegmentToIndexedDB(taskId, segIndex, blob);
      totalDownloaded += blob.size;
      updateDownloadTask(taskId, { progress: Math.round(((i + 1) / segments.length) * 100), downloadedBytes: totalDownloaded, totalBytes: totalDownloaded, speed: `${segIndex}/${segments.length} 片段` });
    }
    updateDownloadTask(taskId, { speed: '正在合并片段...' });
    await mergeAndSaveBrowser(taskId, segments.length, fileName);
    return;
  }

  // Capacitor 环境：逐段下载并保存到文件系统，生成 M3U8 播放列表
  // 确定写入目录（Android 14+ 使用 Directory.Data 避免 scoped storage 问题）
  let writeDir = Directory.Data;
  try {
    await Filesystem.mkdir({ path: dirPath, directory: Directory.Data, recursive: true });
  } catch {
    try {
      await Filesystem.mkdir({ path: dirPath, directory: Directory.Library, recursive: true });
      writeDir = Directory.Library;
    } catch {
      throw new Error('无法创建下载目录，请检查存储权限');
    }
  }

  const segNames: string[] = new Array(segments.length).fill('');
  const threadCount = getDownloadSettings().downloadThreads;

  // 多线程并发下载：每批 threadCount 个片段并发
  for (let batch = 0; batch < segments.length; batch += threadCount) {
    if (signal?.aborted) throw new Error('下载已取消');

    const batchEnd = Math.min(batch + threadCount, segments.length);
    const batchIndices: number[] = [];
    for (let k = batch; k < batchEnd; k++) batchIndices.push(k);

    const batchResults = await Promise.all(
      batchIndices.map(async (i) => {
        const segIndex = i + 1;
        let blob: Blob | null = null;
        let lastErr: Error | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          if (signal?.aborted) break;
          try { blob = await downloadSegment(segments[i], signal); break; }
          catch (err) { lastErr = err as Error; if (attempt < 3 && !signal?.aborted) await new Promise(r => setTimeout(r, 1000 * attempt)); }
        }
        if (!blob) throw new Error(`下载片段 ${segIndex} 失败(重试3次): ${lastErr?.message || '未知错误'}`);

        const arrayBuffer = await blob.arrayBuffer();
        const base64 = arrayBufferToBase64(arrayBuffer);
        const segName = `seg${String(segIndex).padStart(5, '0')}.ts`;
        const segPath = `${dirPath}/${segName}`;
        await Filesystem.writeFile({ path: segPath, data: base64, directory: writeDir, recursive: true });

        return { i, segIndex, segName, size: blob.size };
      })
    );

    for (const r of batchResults) {
      if (signal?.aborted) throw new Error('下载已取消');
      totalDownloaded += r.size;
      segNames[r.i] = r.segName;
      updateDownloadTask(taskId, {
        progress: Math.round(((r.i + 1) / segments.length) * 100),
        downloadedBytes: totalDownloaded,
        totalBytes: totalDownloaded,
        speed: `${r.segIndex}/${segments.length} 片段 (${threadCount}线程)`,
      });
    }
  }

  // 生成简单 M3U8 播放列表（相对路径，播放时由自定义 loader 处理）
  updateDownloadTask(taskId, { speed: '生成播放列表...' });

  const playlistContent = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:10',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    ...segNames.map((seg) => [
      '#EXTINF:10.0,',
      seg,
    ].join('\n')),
    '#EXT-X-ENDLIST',
  ].join('\n');

  const playlistName = 'playlist.m3u8';
  const playlistPath = `${dirPath}/${playlistName}`;

  await Filesystem.writeFile({
    path: playlistPath,
    data: playlistContent,
    directory: writeDir,
    recursive: true,
  });

  // 保存目录信息到任务
  const writeDirName = writeDir === Directory.Data ? 'Data' : 'Library';

  updateDownloadTask(taskId, {
    status: 'completed',
    progress: 100,
    downloadedBytes: totalDownloaded,
    totalBytes: totalDownloaded,
    speed: '完成',
    localPath: `${dirPath}/${playlistName}`,
    localFileUri: `${dirPath}/${playlistName}`,
    writeDirectory: writeDirName,
    segmentCount: segments.length,
  });
}

/** 下载单个片段 */
async function downloadSegment(
  url: string,
  signal?: AbortSignal,
): Promise<Blob> {
  if (isCapacitor()) {
    if (signal?.aborted) throw new Error('下载已取消');
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
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.blob();
  }
}

/** Capacitor 环境直接下载（非 HLS） */
async function downloadDirectCapacitor(taskId: string, url: string, fileName: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('下载已取消');
  const blob = await downloadSegment(url, signal);
  await saveBlobToCapacitor(taskId, blob, fileName);
}

/** 将 Blob 保存到 Capacitor Filesystem */
async function saveBlobToCapacitor(taskId: string, blob: Blob, fileName: string): Promise<void> {
  const arrayBuffer = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);

  const tasks = getDownloadTasks();
  const task = tasks.find(t => t.id === taskId);
  const safeTitle = (task?.title || 'unknown').replace(/[/\\:*?"<>|]/g, '_').slice(0, 40);
  const safeLabel = (task?.episodeLabel || 'episode').replace(/[/\\:*?"<>|]/g, '_').slice(0, 20);
  const filePath = `Download/${safeTitle}/${safeLabel}/${fileName}`;

  const writeFile = async (directory: Directory) => {
    return Filesystem.writeFile({
      path: filePath,
      data: base64,
      directory,
      recursive: true,
    });
  };

  let result: { uri: string };
  try {
    result = await writeFile(Directory.Data);
  } catch {
    try {
      result = await writeFile(Directory.Library);
    } catch (e) {
      throw new Error(`保存文件失败: ${(e as Error).message}`);
    }
  }

  const uri = Capacitor.convertFileSrc(result.uri);

  updateDownloadTask(taskId, {
    status: 'completed',
    progress: 100,
    downloadedBytes: blob.size,
    totalBytes: blob.size,
    speed: '完成',
    localPath: result.uri,
    localFileUri: uri,
  });
}

/** 将单个 ts 片段保存到 IndexedDB */
async function saveSegmentToIndexedDB(taskId: string, index: number, blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('MoonTVDownloads', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('segments')) {
        db.createObjectStore('segments');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('segments', 'readwrite');
      const store = tx.objectStore('segments');
      store.put(blob, `${taskId}_seg${String(index).padStart(5, '0')}`);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  });
}

/** 浏览器环境：从 IndexedDB 取出所有片段合并并保存 */
async function mergeAndSaveBrowser(taskId: string, totalSegments: number, fileName: string): Promise<void> {
  const blobs: Blob[] = [];
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('MoonTVDownloads', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('segments')) {
        db.createObjectStore('segments');
      }
    };
    request.onsuccess = async () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('segments')) {
        db.close();
        reject(new Error('片段存储不存在'));
        return;
      }
      const tx = db.transaction('segments', 'readonly');
      const store = tx.objectStore('segments');
      for (let i = 1; i <= totalSegments; i++) {
        const key = `${taskId}_seg${String(i).padStart(5, '0')}`;
        try {
          const blob = await new Promise<Blob>((res, rej) => {
            const req = store.get(key);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
          });
          if (blob) blobs.push(blob);
        } catch (err) {
          db.close();
          reject(new Error(`读取片段 ${i} 失败: ${(err as Error).message}`));
          return;
        }
      }
      db.close();
      if (blobs.length === 0) {
        reject(new Error('没有可合并的片段'));
        return;
      }
      const combinedBlob = new Blob(blobs, { type: 'video/mp2t' });
      saveBlobToBrowser(taskId, combinedBlob, fileName);

      // 清理 IndexedDB
      try {
        const cleanReq = indexedDB.open('MoonTVDownloads', 1);
        cleanReq.onsuccess = () => {
          const cleanDb = cleanReq.result;
          const cleanTx = cleanDb.transaction('segments', 'readwrite');
          const cleanStore = cleanTx.objectStore('segments');
          for (let i = 1; i <= totalSegments; i++) {
            cleanStore.delete(`${taskId}_seg${String(i).padStart(5, '0')}`);
          }
          cleanTx.oncomplete = () => cleanDb.close();
        };
      } catch { /* ignore */ }
      resolve();
    };
    request.onerror = () => reject(request.error);
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
function downloadWithProgress(taskId: string, url: string, fileName: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('下载已取消'));

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

    signal?.addEventListener('abort', () => {
      xhr.abort();
      reject(new Error('下载已取消'));
    });

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