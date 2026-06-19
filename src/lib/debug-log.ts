'use client';

/**
 * 全局调试日志系统
 * 使用模块级 store + 自定义事件通知 React 组件更新
 */

export interface DebugLogEntry {
  time: string;
  msg: string;
}

let logs: DebugLogEntry[] = [];
const listeners: Set<() => void> = new Set();
const MAX_LOGS = 500;

function notify() {
  listeners.forEach((fn) => fn());
}

function formatTime(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

export function addGlobalDebugLog(msg: string): void {
  logs.push({ time: formatTime(), msg });
  if (logs.length > MAX_LOGS) {
    logs = logs.slice(-MAX_LOGS);
  }
  notify();
}

export function getGlobalDebugLogs(): DebugLogEntry[] {
  return logs;
}

export function clearGlobalDebugLogs(): void {
  logs = [];
  notify();
}

export function subscribeDebugLogs(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}