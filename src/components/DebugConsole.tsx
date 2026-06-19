'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getGlobalDebugLogs,
  clearGlobalDebugLogs,
  subscribeDebugLogs,
} from '@/lib/debug-log';

export default function DebugConsole() {
  const [show, setShow] = useState(false);
  const [logs, setLogs] = useState<{ time: string; msg: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = subscribeDebugLogs(() => {
      setLogs([...getGlobalDebugLogs()]);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (show && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, show]);

  const handleClear = useCallback(() => {
    clearGlobalDebugLogs();
  }, []);

  const handleCopy = useCallback(() => {
    const text = logs.map(l => `${l.time} ${l.msg}`).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      // brief feedback
    }).catch(() => {
      // fallback
    });
  }, [logs]);

  return (
    <>
      <button
        onClick={() => setShow(!show)}
        className='fixed bottom-4 right-4 z-[9999] w-10 h-10 rounded-full bg-gray-800/80 text-green-400 text-xs font-mono flex items-center justify-center shadow-lg border border-gray-600 hover:bg-gray-700 transition-colors'
        title='调试控制台'
      >
        {show ? '✕' : 'DBG'}
      </button>

      {show && (
        <div className='fixed bottom-16 right-4 z-[9998] w-96 max-h-96 bg-gray-900/95 border border-gray-600 rounded-xl shadow-2xl flex flex-col overflow-hidden'>
          <div className='flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700'>
            <span className='text-xs font-mono text-green-400'>Debug Console</span>
            <div className='flex items-center gap-2'>
              <button
                onClick={handleCopy}
                className='text-xs text-gray-400 hover:text-white px-2 py-0.5 rounded'
              >
                复制
              </button>
              <button
                onClick={handleClear}
                className='text-xs text-gray-400 hover:text-white px-2 py-0.5 rounded'
              >
                清空
              </button>
            </div>
          </div>
          <div
            ref={scrollRef}
            className='flex-1 overflow-y-auto p-2 font-mono text-xs leading-relaxed'
          >
            {logs.length === 0 ? (
              <span className='text-gray-500'>等待日志...</span>
            ) : (
              logs.map((log, i) => (
                <div key={i} className='text-green-300 break-all py-0.5'>
                  <span className='text-gray-500'>{log.time}</span>{' '}
                  {log.msg}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}