'use client';

import { Bug, ChevronDown, ChevronRight, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

type LogLevel = 'log' | 'warn' | 'error' | 'info';

interface LogEntry {
  id: number;
  level: LogLevel;
  args: unknown[];
  timestamp: string;
}

const LOG_LIMIT = 200;

export default function DebugConsole() {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const idRef = useRef(0);

  const addLog = useCallback((level: LogLevel, args: unknown[]) => {
    const id = ++idRef.current;
    const entry: LogEntry = {
      id,
      level,
      args,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    };
    setLogs(prev => {
      const next = [...prev, entry];
      if (next.length > LOG_LIMIT) return next.slice(-LOG_LIMIT);
      return next;
    });
  }, []);

  useEffect(() => {
    const originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console),
    };

    console.log = (...args: unknown[]) => {
      originalConsole.log(...args);
      addLog('log', args);
    };
    console.warn = (...args: unknown[]) => {
      originalConsole.warn(...args);
      addLog('warn', args);
    };
    console.error = (...args: unknown[]) => {
      originalConsole.error(...args);
      addLog('error', args);
    };
    console.info = (...args: unknown[]) => {
      originalConsole.info(...args);
      addLog('info', args);
    };

    const handleError = (e: ErrorEvent) => {
      addLog('error', [e.error || e.message]);
    };
    const handleRejection = (e: PromiseRejectionEvent) => {
      addLog('error', [e.reason]);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.info = originalConsole.info;
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [addLog]);

  const filteredLogs = filter === 'all' ? logs : logs.filter(l => l.level === filter);

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearLogs = () => setLogs([]);

  const formatArg = (arg: unknown): string => {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    if (typeof arg === 'string') return arg;
    if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      return String(arg);
    }
  };

  const isExpandable = (arg: unknown): boolean => {
    return typeof arg === 'object' && arg !== null;
  };

  const levelBadge = (level: LogLevel) => {
    const colors = {
      log: 'bg-gray-500',
      warn: 'bg-yellow-500',
      error: 'bg-red-500',
      info: 'bg-blue-500',
    };
    return (
      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${colors[level]}`}>
        {level.toUpperCase()}
      </span>
    );
  };

  const counts = {
    all: logs.length,
    log: logs.filter(l => l.level === 'log').length,
    warn: logs.filter(l => l.level === 'warn').length,
    error: logs.filter(l => l.level === 'error').length,
  };

  const errorCount = counts.error;

  return (
    <>
      {/* DEBUG 按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-20 right-4 z-[9999] w-10 h-10 rounded-full bg-gray-900/90 dark:bg-gray-900/90 text-white shadow-lg flex items-center justify-center hover:scale-110 transition-transform"
        title="调试控制台"
      >
        <Bug size={18} />
        {errorCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {errorCount > 99 ? '99+' : errorCount}
          </span>
        )}
      </button>

      {/* 控制台面板 */}
      {isOpen && (
        <div className="fixed inset-0 z-[9998] flex items-end sm:items-center justify-center pointer-events-none">
          <div className="pointer-events-auto w-full max-w-lg h-[80vh] sm:h-[500px] bg-gray-950 border border-gray-700 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* 头部 */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-900">
              <div className="flex items-center gap-2">
                <Bug size={16} className="text-green-400" />
                <span className="text-sm font-medium text-gray-200">调试控制台</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={clearLogs}
                  className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
                  title="清空"
                >
                  <Trash2 size={14} />
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* 筛选栏 */}
            <div className="flex gap-1 px-4 py-2 border-b border-gray-800 bg-gray-900">
              {(['all', 'log', 'warn', 'error'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    filter === f
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  {f === 'all' ? 'ALL' : f.toUpperCase()}
                  <span className="ml-1 opacity-60">({counts[f]})</span>
                </button>
              ))}
            </div>

            {/* 日志列表 */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-xs">
              {filteredLogs.length === 0 ? (
                <div className="text-center text-gray-500 py-8">暂无日志</div>
              ) : (
                filteredLogs.map(entry => (
                  <div key={entry.id} className="group">
                    <div
                      className="flex items-start gap-2 py-0.5 px-1 rounded hover:bg-gray-800/50 cursor-pointer"
                      onClick={() => {
                        if (entry.args.some(isExpandable)) toggleExpand(entry.id);
                      }}
                    >
                      <span className="text-gray-500 shrink-0">{entry.timestamp}</span>
                      {levelBadge(entry.level)}
                      <span className="text-gray-300 break-all flex-1 min-w-0">
                        {entry.args.map((arg, i) => (
                          <span key={i}>
                            {i > 0 && ' '}
                            {isExpandable(arg) ? (
                              <span className="text-gray-400">
                                {expandedIds.has(entry.id) ? (
                                  <ChevronDown size={12} className="inline mr-1" />
                                ) : (
                                  <ChevronRight size={12} className="inline mr-1" />
                                )}
                                {'{...}'}
                              </span>
                            ) : (
                              formatArg(arg)
                            )}
                          </span>
                        ))}
                      </span>
                    </div>
                    {expandedIds.has(entry.id) && entry.args.some(isExpandable) && (
                      <div className="ml-20 pl-2 border-l border-gray-700">
                        {entry.args.filter(isExpandable).map((arg, i) => (
                          <pre key={i} className="text-gray-400 text-[10px] whitespace-pre-wrap py-1">
                            {formatArg(arg)}
                          </pre>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}