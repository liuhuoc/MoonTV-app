'use client';

import { CapacitorHttp, type HttpResponse, Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { getDownloadSettings } from './settings';
import { browserSaveSegment, browserSavePlaylist, browserDeleteTask, browserSegmentExists } from './storage';
import { deletePlayRecord } from './db.client';

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

/** 检查是否在 Capacitor 原生环境（iOS/Android App） */
function isCapacitor(): boolean {
  try {
    // Capacitor.getPlatform() 在浏览器中返回 'web'，在原生 App 中返回 'ios'/'android'
    const platform = Capacitor.getPlatform();
    return platform === 'ios' || platform === 'android';
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

  // 删除历史记录
  try {
    await deletePlayRecord('local', id);
  } catch { /* ignore */ }

  // Capacitor 环境：删除下载的文件
  if (isCapacitor()) {
    const safeTitle = task.title.replace(/[/\\:*?"<>|]/g, '_').slice(0, 40);
    const safeLabel = task.episodeLabel.replace(/[/\\:*?"<>|]/g, '_').slice(0, 20);
    const dirPath = `Download/${safeTitle}/${safeLabel}`;
    try { await Filesystem.rmdir({ path: dirPath, directory: Directory.Data, recursive: true }); } catch { /* ignore */ }
    try { await Filesystem.rmdir({ path: dirPath, directory: Directory.Library, recursive: true }); } catch { /* ignore */ }
  }

  // 浏览器环境：清理 IndexedDB 中的片段和播放列表
  if (!isCapacitor()) {
    try {
      await browserDeleteTask(id);
    } catch {
      // 忽略
    }
  }
}

export function pauseDownload(taskId: string): void {
  const ctrl = activeAbortControllers.get(taskId);
  if (ctrl) {
    try { ctrl.abort(); } catch { /* ignore */ }
    activeAbortControllers.delete(taskId);
  }
  // 同步设置 paused 状态，后续 catch 块会检查此状态避免覆盖
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
    // 如果任务已被用户暂停（pauseDownload 设置了 paused 状态），不要覆盖为 failed
    const currentTasks = getDownloadTasks();
    const currentTask = currentTasks.find(t => t.id === taskId);
    if (currentTask?.status === 'paused') {
      // 用户主动暂停，静默退出，不改变状态
      return;
    }
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
        connectTimeout: 30000,
        readTimeout: 60000,
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

  // 浏览器环境：下载所有片段到 IndexedDB，保留用于本地播放
  if (!isCapacitor()) {
    // 断点续传：检查哪些片段已经下载
    let alreadyDownloaded = 0;
    for (let i = 0; i < segments.length; i++) {
      if (signal?.aborted) throw new Error('下载已取消');
      if (await browserSegmentExists(taskId, i + 1)) {
        alreadyDownloaded++;
      } else {
        break; // 一旦遇到未下载的，后面的都未下载（顺序下载）
      }
    }
    if (alreadyDownloaded > 0) {
      updateDownloadTask(taskId, {
        progress: Math.round((alreadyDownloaded / segments.length) * 100),
        speed: `已跳过 ${alreadyDownloaded}/${segments.length} 片段`,
      });
    }

    for (let i = alreadyDownloaded; i < segments.length; i++) {
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
      await browserSaveSegment(taskId, segIndex, blob);
      totalDownloaded += blob.size;
      updateDownloadTask(taskId, { progress: Math.round(((i + 1) / segments.length) * 100), downloadedBytes: totalDownloaded, totalBytes: totalDownloaded, speed: `${segIndex}/${segments.length} 片段` });
    }

    // 生成 M3U8 播放列表并保存到 IndexedDB
    updateDownloadTask(taskId, { speed: '正在保存播放列表...' });
    const m3u8Lines: string[] = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:10',
      '#EXT-X-MEDIA-SEQUENCE:0',
    ];
    for (let i = 0; i < segments.length; i++) {
      m3u8Lines.push('#EXTINF:10.000,');
      m3u8Lines.push(`local://segment/${i}`);
    }
    m3u8Lines.push('#EXT-X-ENDLIST');
    const playlistContent = m3u8Lines.join('\n') + '\n';
    await browserSavePlaylist(taskId, playlistContent);

    updateDownloadTask(taskId, {
      status: 'completed',
      progress: 100,
      speed: '已完成',
      downloadedBytes: totalDownloaded,
      totalBytes: totalDownloaded,
      localPath: taskId, // 浏览器端：localPath = taskId，用于 IndexedDB 查找
      writeDirectory: 'IndexedDB',
      segmentCount: segments.length,
    });
    return;
  }

  // Capacitor 环境：确定写入目录
  // 断点续传时使用任务保存的 writeDirectory，避免因目录重新探测导致找不到已下载片段
  let writeDir = Directory.Data;
  if (task?.writeDirectory === 'Library') {
    writeDir = Directory.Library;
  } else if (task?.writeDirectory === 'Data') {
    writeDir = Directory.Data;
  } else {
    // 新下载：探测可用目录
    const ensureDir = async (path: string, dir: Directory) => {
      try { await Filesystem.mkdir({ path, directory: dir, recursive: true }); } catch { /* mkdir 失败也继续 */ }
    };
    try { await ensureDir(dirPath, Directory.Data); } catch { /* fall through */ }
    try { await ensureDir(dirPath, Directory.Library); writeDir = Directory.Library; } catch { /* fall through */ }
  }

  const threadCount = getDownloadSettings().downloadThreads;
  const segCount = segments.length;

  // 断点续传：检查哪些片段已经下载到磁盘
  let alreadyDownloaded = 0;
  for (let i = 0; i < segCount; i++) {
    if (signal?.aborted) throw new Error('下载已取消');
    const segFileName = `seg_${String(i).padStart(5, '0')}.ts`;
    const segFilePath = `${dirPath}/${segFileName}`;
    try {
      await Filesystem.stat({ path: segFilePath, directory: writeDir });
      alreadyDownloaded++;
    } catch {
      break; // 一旦遇到未下载的，后面的都未下载（顺序下载）
    }
  }
  if (alreadyDownloaded > 0) {
    updateDownloadTask(taskId, {
      progress: Math.round((alreadyDownloaded / segCount) * 100),
      downloadedBytes: 0,
      speed: `已跳过 ${alreadyDownloaded}/${segCount} 片段`,
    });
  }

  // 逐段下载+立即写入磁盘：每批 threadCount 个片段并发
  const startBatch = Math.floor(alreadyDownloaded / threadCount);
  for (let batch = startBatch * threadCount; batch < segCount; batch += threadCount) {
    if (signal?.aborted) throw new Error('下载已取消');

    const batchEnd = Math.min(batch + threadCount, segCount);
    const batchIndices: number[] = [];
    for (let k = batch; k < batchEnd; k++) {
      // 跳过已下载的片段
      if (k < alreadyDownloaded) continue;
      batchIndices.push(k);
    }

    if (batchIndices.length === 0) continue;

    const batchResults = await Promise.all(
      batchIndices.map(async (i) => {
        const segIndex = i + 1;
        let blob: Blob | null = null;
        let lastErr: Error | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          if (signal?.aborted) break;
          try { blob = await downloadSegment(segments[i], signal); break; }
          catch (err) { lastErr = err as Error; if (attempt < 3 && !signal?.aborted) await new Promise(r => setTimeout(r, 2000 * attempt)); }
        }
        if (!blob) throw new Error(`下载片段 ${segIndex} 失败(重试3次): ${lastErr?.message || '未知错误'}`);
        const segFileName = `seg_${String(i).padStart(5, '0')}.ts`;
        const segFilePath = `${dirPath}/${segFileName}`;
        const arrayBuf = await blob.arrayBuffer();
        const b64 = arrayBufferToBase64(arrayBuf);
        await Filesystem.writeFile({
          path: segFilePath,
          data: b64,
          directory: writeDir,
          recursive: true,
        });
        return { i, segIndex, size: blob.size };
      })
    );

    for (const r of batchResults) {
      if (signal?.aborted) throw new Error('下载已取消');
      totalDownloaded += r.size;
      updateDownloadTask(taskId, {
        progress: Math.round(((r.i + 1) / segCount) * 100),
        downloadedBytes: totalDownloaded,
        totalBytes: totalDownloaded,
        speed: `${r.segIndex}/${segCount} 片段 (${threadCount}线程)`,
      });
    }
  }

  // 生成 M3U8 播放列表文件
  updateDownloadTask(taskId, { speed: '正在生成播放列表...' });
  const m3u8Lines: string[] = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:10',
    '#EXT-X-MEDIA-SEQUENCE:0',
  ];
  for (let i = 0; i < segCount; i++) {
    m3u8Lines.push('#EXTINF:10.000,');
    m3u8Lines.push(`local://segment/${i}`);
  }
  m3u8Lines.push('#EXT-X-ENDLIST');
  const playlistContent = m3u8Lines.join('\n') + '\n';

  const playlistData = new TextEncoder().encode(playlistContent);
  const playlistBase64 = arrayBufferToBase64(playlistData.buffer as ArrayBuffer);

  const playlistPath = `${dirPath}/playlist.m3u8`;
  await Filesystem.writeFile({
    path: playlistPath,
    data: playlistBase64,
    directory: writeDir,
    recursive: true,
  });

  const writeDirName = writeDir === Directory.Data ? 'Data' : 'Library';

  updateDownloadTask(taskId, {
    status: 'completed',
    progress: 100,
    downloadedBytes: totalDownloaded,
    totalBytes: totalDownloaded,
    speed: '完成',
    localPath: playlistPath,
    localFileUri: playlistPath,
    writeDirectory: writeDirName,
    segmentCount: segCount,
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
      responseType: 'arraybuffer',
      connectTimeout: 60000,
      readTimeout: 120000,
    });
    if (response.status < 200 || response.status >= 300 || !response.data) {
      throw new Error(`HTTP ${response.status}`);
    }
    // responseType: 'arraybuffer' 返回 base64 编码的 ArrayBuffer
    const base64 = response.data as string;
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return new Blob([bytes], { type: 'video/mp2t' });
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