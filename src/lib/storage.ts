'use client';

/**
 * 统一存储层 — 浏览器用 IndexedDB，Capacitor 用 Filesystem
 * 对外暴露一致的 API，调用方无需关心底层实现
 */

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

// ─── 平台检测 ──────────────────────────────────────────────────

export function isCapacitorPlatform(): boolean {
  try {
    // Capacitor.getPlatform() 在浏览器中返回 'web'，在原生 App 中返回 'ios'/'android'
    const platform = Capacitor.getPlatform();
    return platform === 'ios' || platform === 'android';
  } catch {
    return false;
  }
}

// ─── IndexedDB 工具 ────────────────────────────────────────────

const DB_NAME = 'MoonTVDownloads';
const DB_VERSION = 2;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('segments')) {
        db.createObjectStore('segments');
      }
      if (!db.objectStoreNames.contains('playlists')) {
        db.createObjectStore('playlists');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── 浏览器端 API ──────────────────────────────────────────────

/** 浏览器：保存单个片段到 IndexedDB */
export async function browserSaveSegment(taskId: string, index: number, blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('segments', 'readwrite');
    const store = tx.objectStore('segments');
    const key = `${taskId}_seg${String(index).padStart(5, '0')}`;
    store.put(blob, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** 浏览器：读取单个片段 */
export async function browserReadSegment(taskId: string, index: number): Promise<ArrayBuffer> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('segments', 'readonly');
    const store = tx.objectStore('segments');
    const key = `${taskId}_seg${String(index).padStart(5, '0')}`;
    const req = store.get(key);
    req.onsuccess = async () => {
      const blob = req.result as Blob;
      if (!blob) {
        db.close();
        reject(new Error(`片段 ${index} 不存在`));
        return;
      }
      const buf = await blob.arrayBuffer();
      db.close();
      resolve(buf);
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** 浏览器：保存 m3u8 播放列表 */
export async function browserSavePlaylist(taskId: string, content: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('playlists', 'readwrite');
    const store = tx.objectStore('playlists');
    store.put(content, taskId);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** 浏览器：读取 m3u8 播放列表 */
export async function browserReadPlaylist(taskId: string): Promise<string> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('playlists', 'readonly');
    const store = tx.objectStore('playlists');
    const req = store.get(taskId);
    req.onsuccess = () => {
      const content = req.result as string;
      db.close();
      if (content) resolve(content);
      else reject(new Error('播放列表不存在'));
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** 浏览器：删除某任务的所有存储数据 */
export async function browserDeleteTask(taskId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve) => {
    // 删除 playlists
    const tx1 = db.transaction('playlists', 'readwrite');
    tx1.objectStore('playlists').delete(taskId);
    tx1.oncomplete = () => {
      // 删除 segments（前缀匹配）
      const tx2 = db.transaction('segments', 'readwrite');
      const store = tx2.objectStore('segments');
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
      tx2.oncomplete = () => { db.close(); resolve(); };
      tx2.onerror = () => { db.close(); resolve(); };
    };
    tx1.onerror = () => { db.close(); resolve(); };
  });
}

// ─── Capacitor 端 API ──────────────────────────────────────────

/** Capacitor：读取片段 */
export async function capacitorReadSegment(
  dirPath: string,
  writeDir: Directory,
  index: number
): Promise<ArrayBuffer> {
  const segFileName = `seg_${String(index).padStart(5, '0')}.ts`;
  const segPath = `${dirPath}/${segFileName}`;
  const result = await Filesystem.readFile({ path: segPath, directory: writeDir });
  const base64 = result.data as string;
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return arr.buffer;
}

/** Capacitor：读取 m3u8 播放列表 */
export async function capacitorReadPlaylist(
  localPath: string,
  writeDir: Directory
): Promise<string> {
  const result = await Filesystem.readFile({ path: localPath, directory: writeDir });
  let content: string;
  try {
    content = atob(result.data as string);
  } catch {
    content = result.data as string;
  }
  return content;
}