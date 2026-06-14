/** 公共设置工具（localStorage 读写） */

const DOWNLOAD_SETTINGS_KEY = 'downloadSettings';

export interface DownloadSettings {
  maxConcurrent: number;
  autoCleanup: boolean;
  downloadThreads: number;
}

const DEFAULT_DOWNLOAD_SETTINGS: DownloadSettings = {
  maxConcurrent: 2,
  autoCleanup: true,
  downloadThreads: 3,
};

export function getDownloadSettings(): DownloadSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_DOWNLOAD_SETTINGS };
  try {
    const raw = localStorage.getItem(DOWNLOAD_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        maxConcurrent: Math.max(1, Math.min(5, parsed.maxConcurrent || 2)),
        autoCleanup: !!parsed.autoCleanup,
        downloadThreads: Math.max(1, Math.min(10, parsed.downloadThreads || 3)),
      };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_DOWNLOAD_SETTINGS };
}

export function saveDownloadSettings(settings: DownloadSettings): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DOWNLOAD_SETTINGS_KEY, JSON.stringify(settings));
}