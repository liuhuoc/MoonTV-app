'use client';

import { ArrowLeft, ChevronDown, ChevronRight, Plus, RefreshCw, RotateCcw, Trash2, Wifi, WifiOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import PageLayout from '@/components/PageLayout';
import { getAllApiSites } from '@/lib/config';
import { searchFromApi, type ApiSite } from '@/lib/downstream';
import { getVideoResolutionFromM3u8 } from '@/lib/utils';
import { getDownloadSettings, saveDownloadSettings } from '@/lib/settings';

export default function SettingsPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  // 设置相关状态
  const [enableOptimization, setEnableOptimization] = useState(true);
  const [doubanProxyUrl, setDoubanProxyUrl] = useState('');
  const [imageProxyUrl, setImageProxyUrl] = useState('');
  const [enableImageProxy, setEnableImageProxy] = useState(false);
  const [enableDoubanProxy, setEnableDoubanProxy] = useState(false);

  // 下载设置
  const [maxConcurrent, setMaxConcurrent] = useState(2);
  const [autoCleanup, setAutoCleanup] = useState(true);
  const [downloadThreads, setDownloadThreads] = useState(3);

  // 折叠面板状态
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['search', 'play', 'download', 'source', 'proxy']));

  // 源管理
  const ENABLED_SOURCES_KEY = 'enabledSources';
  const SOURCE_STATUSES_KEY = 'sourceStatuses';
  const CUSTOM_SOURCES_KEY = 'customSources';

  interface SourceStatus {
    name: string;
    host: string;
    status: 'ok' | 'error' | 'unknown';
    lastCheck: number;
    latency?: number;
    errorMessage?: string;
    quality?: string;
    loadSpeed?: string;
  }

  const allApiSites = getAllApiSites();

  function getEnabledSources(): Set<string> {
    if (typeof window === 'undefined') return new Set(allApiSites.map(s => s.key));
    try {
      const raw = localStorage.getItem(ENABLED_SOURCES_KEY);
      if (raw) return new Set(JSON.parse(raw));
    } catch { /* ignore */ }
    return new Set(allApiSites.map(s => s.key));
  }

  function saveEnabledSources(sources: Set<string>): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(ENABLED_SOURCES_KEY, JSON.stringify(Array.from(sources)));
  }

  function getSourceStatuses(): Record<string, SourceStatus> {
    if (typeof window === 'undefined') return {};
    try {
      const raw = localStorage.getItem(SOURCE_STATUSES_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return {};
  }

  function saveSourceStatuses(statuses: Record<string, SourceStatus>): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(SOURCE_STATUSES_KEY, JSON.stringify(statuses));
  }

  function getCustomSources(): ApiSite[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(CUSTOM_SOURCES_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return [];
  }

  function saveCustomSources(sources: ApiSite[]): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(sources));
  }

  const [enabledSources, setEnabledSources] = useState<Set<string>>(new Set());
  const [sourceStatuses, setSourceStatuses] = useState<Record<string, SourceStatus>>({});
  const sourceStatusesRef = useRef<Record<string, SourceStatus>>({});
  const [customSources, setCustomSources] = useState<ApiSite[]>([]);
  const [allSources, setAllSources] = useState<ApiSite[]>([]);

  // 新增源弹窗
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceKey, setNewSourceKey] = useState('');
  const [newSourceApi, setNewSourceApi] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  // 从 localStorage 读取设置
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const savedEnableDoubanProxy = localStorage.getItem('enableDoubanProxy');
    if (savedEnableDoubanProxy !== null) setEnableDoubanProxy(JSON.parse(savedEnableDoubanProxy));

    const savedDoubanProxyUrl = localStorage.getItem('doubanProxyUrl');
    if (savedDoubanProxyUrl !== null) setDoubanProxyUrl(savedDoubanProxyUrl);

    const savedEnableImageProxy = localStorage.getItem('enableImageProxy');
    if (savedEnableImageProxy !== null) setEnableImageProxy(JSON.parse(savedEnableImageProxy));

    const savedImageProxyUrl = localStorage.getItem('imageProxyUrl');
    if (savedImageProxyUrl !== null) setImageProxyUrl(savedImageProxyUrl);

    const savedEnableOptimization = localStorage.getItem('enableOptimization');
    if (savedEnableOptimization !== null) setEnableOptimization(JSON.parse(savedEnableOptimization));

    const dlSettings = getDownloadSettings();
    setMaxConcurrent(dlSettings.maxConcurrent);
    setAutoCleanup(dlSettings.autoCleanup);
    setDownloadThreads(dlSettings.downloadThreads);

    const enabled = getEnabledSources();
    setEnabledSources(enabled);
    const savedStatuses = getSourceStatuses();
    setSourceStatuses(savedStatuses);
    sourceStatusesRef.current = savedStatuses;
    const custom = getCustomSources();
    setCustomSources(custom);
    const merged = [...allApiSites, ...custom];
    const sortedMerged = [...merged].sort((a, b) => {
      const aEnabled = enabled.has(a.key) ? 1 : 0;
      const bEnabled = enabled.has(b.key) ? 1 : 0;
      return bEnabled - aEnabled;
    });
    setAllSources(sortedMerged);
  }, []);

  const saveToStorage = (key: string, value: string) => {
    if (typeof window !== 'undefined') localStorage.setItem(key, value);
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const handleResetSettings = () => {
    setEnableOptimization(true);
    setDoubanProxyUrl('');
    setEnableDoubanProxy(false);
    setEnableImageProxy(false);
    setImageProxyUrl('');
    setMaxConcurrent(2);
    setAutoCleanup(true);
    setDownloadThreads(3);

    if (typeof window !== 'undefined') {
      localStorage.setItem('enableOptimization', JSON.stringify(true));
      localStorage.setItem('doubanProxyUrl', '');
      localStorage.setItem('enableDoubanProxy', JSON.stringify(false));
      localStorage.setItem('enableImageProxy', JSON.stringify(false));
      localStorage.setItem('imageProxyUrl', '');
      saveDownloadSettings({ maxConcurrent: 2, autoCleanup: true, downloadThreads: 3 });
      saveEnabledSources(new Set(allApiSites.map(s => s.key)));
      saveSourceStatuses({});
      saveCustomSources([]);
    }
    setEnabledSources(new Set(allApiSites.map(s => s.key)));
    setSourceStatuses({});
    setCustomSources([]);
    setAllSources([...allApiSites]);
  };

  const handleToggleSource = (key: string) => {
    setEnabledSources(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveEnabledSources(next);
      return next;
    });
  };

  const handleToggleAllSources = (enable: boolean) => {
    if (enable) {
      const allKeys = new Set(allSources.map(s => s.key));
      setEnabledSources(allKeys);
      saveEnabledSources(allKeys);
    } else {
      setEnabledSources(new Set());
      saveEnabledSources(new Set());
    }
  };

  const handleTestSource = async (source: ApiSite) => {
    const host = source.api ? (() => { try { return new URL(source.api).hostname; } catch { return source.api; } })() : '';
    const statusesRef = sourceStatusesRef.current;
    statusesRef[source.key] = {
      name: source.name,
      host,
      status: 'unknown',
      lastCheck: Date.now(),
    };
    setSourceStatuses({ ...statusesRef });
    saveSourceStatuses(statusesRef);

    try {
      // 与播放页换源逻辑一致：搜索关键字 → 取第一个结果的 M3U8 链接 → 测速
      const searchResults = await searchFromApi(source, '三体');
      if (!searchResults || searchResults.length === 0) {
        throw new Error('无搜索结果');
      }

      const firstEpUrl = searchResults[0].episodes?.[0];
      if (!firstEpUrl) {
        throw new Error('无播放链接');
      }

      const testResult = await getVideoResolutionFromM3u8(firstEpUrl);

      statusesRef[source.key] = {
        name: source.name,
        host,
        status: 'ok',
        lastCheck: Date.now(),
        latency: testResult.pingTime,
        quality: testResult.quality,
        loadSpeed: testResult.loadSpeed,
      };
    } catch (err) {
      // 回退到简单的 HTTP 连通性测试
      const startTime = Date.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(source.api, { method: 'GET', signal: controller.signal, mode: 'cors' });
        clearTimeout(timeoutId);
        if (resp.ok || resp.status > 0) {
          statusesRef[source.key] = {
            name: source.name, host,
            status: 'ok', lastCheck: Date.now(),
            latency: Date.now() - startTime,
          };
        } else {
          throw new Error(`HTTP ${resp.status}`);
        }
      } catch {
        const latency = Date.now() - startTime;
        statusesRef[source.key] = {
          name: source.name, host,
          status: 'error', lastCheck: Date.now(),
          latency, errorMessage: '连接失败',
        };
      }
    }
    setSourceStatuses({ ...statusesRef });
    saveSourceStatuses(statusesRef);
  };

  const handleAddSource = () => {
    if (!newSourceName.trim() || !newSourceKey.trim() || !newSourceApi.trim()) return;
    const newSource: ApiSite = {
      key: newSourceKey.trim().replace(/\s+/g, '_'),
      api: newSourceApi.trim(),
      name: newSourceName.trim(),
    };
    const updated = [...customSources, newSource];
    setCustomSources(updated);
    saveCustomSources(updated);
    setAllSources([...allApiSites, ...updated]);
    setEnabledSources(prev => new Set(Array.from(prev).concat([newSource.key])));
    setNewSourceName('');
    setNewSourceKey('');
    setNewSourceApi('');
    setShowAddSource(false);
  };

  const handleDeleteCustomSource = (key: string) => {
    const updated = customSources.filter(s => s.key !== key);
    setCustomSources(updated);
    saveCustomSources(updated);
    setAllSources([...allApiSites, ...updated]);
    setEnabledSources(prev => {
      const next = new Set(prev);
      next.delete(key);
      saveEnabledSources(next);
      return next;
    });
  };

  const ToggleSwitch = ({
    checked,
    onChange,
    label,
    description,
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
    description: string;
  }) => (
    <div className='flex items-center justify-between'>
      <div>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>{label}</h4>
        <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>{description}</p>
      </div>
      <label className='flex items-center cursor-pointer'>
        <div className='relative'>
          <input
            type='checkbox'
            className='sr-only peer'
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
          <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600' />
          <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5' />
        </div>
      </label>
    </div>
  );

  const TextInput = ({
    value,
    onChange,
    placeholder,
    disabled,
    label,
    description,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    disabled: boolean;
    label: string;
    description: string;
  }) => (
    <div className='space-y-3'>
      <div>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>{label}</h4>
        <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>{description}</p>
      </div>
      <input
        type='text'
        className={`w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${
          disabled
            ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-400 dark:text-gray-500 cursor-not-allowed'
            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
        }`}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );

  const SectionHeader = ({ id, title, icon }: { id: string; title: string; icon: React.ReactNode }) => (
    <button
      onClick={() => toggleSection(id)}
      className='w-full flex items-center justify-between py-3 px-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
    >
      <div className='flex items-center gap-3'>
        {icon}
        <h3 className='text-sm font-semibold text-gray-700 dark:text-gray-300'>{title}</h3>
      </div>
      {expandedSections.has(id) ? (
        <ChevronDown className='w-4 h-4 text-gray-400' />
      ) : (
        <ChevronRight className='w-4 h-4 text-gray-400' />
      )}
    </button>
  );

  if (!mounted) return null;

  return (
    <PageLayout activePath='/settings'>
      <div className='px-4 sm:px-10 py-4 sm:py-8'>
        <div className='max-w-lg mx-auto'>
          {/* 头部 */}
          <div className='flex items-center gap-4 mb-8'>
            <button
              onClick={() => router.back()}
              className='w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
            >
              <ArrowLeft className='w-5 h-5 text-gray-600 dark:text-gray-300' />
            </button>
            <div>
              <h1 className='text-2xl font-bold text-gray-800 dark:text-gray-200'>设置</h1>
              <p className='text-sm text-gray-500 dark:text-gray-400'>本地设置保存在浏览器中</p>
            </div>
            <div className='ml-auto'>
              <button
                onClick={handleResetSettings}
                className='flex items-center gap-1 px-3 py-1.5 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border border-red-200 hover:border-red-300 dark:border-red-800 dark:hover:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors'
              >
                <RotateCcw className='w-3 h-3' />
                重置
              </button>
            </div>
          </div>

          {/* 设置卡片 */}
          <div className='space-y-3 bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-800'>

            {/* 搜索设置 */}
            <SectionHeader id='search' title='搜索设置' icon={<svg className='w-4 h-4 text-blue-500' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'><circle cx='11' cy='11' r='8'/><line x1='21' y1='21' x2='16.65' y2='16.65'/></svg>} />
            {expandedSections.has('search') && (
              <div className='px-4 pb-4 space-y-4 border-b border-gray-100 dark:border-gray-800'>
              </div>
            )}

            {/* 播放设置 */}
            <SectionHeader id='play' title='播放设置' icon={<svg className='w-4 h-4 text-green-500' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'><polygon points='5 3 19 12 5 21 5 3'/></svg>} />
            {expandedSections.has('play') && (
              <div className='px-4 pb-4 space-y-4 border-b border-gray-100 dark:border-gray-800'>
                <ToggleSwitch
                  checked={enableOptimization}
                  onChange={(v) => {
                    setEnableOptimization(v);
                    saveToStorage('enableOptimization', JSON.stringify(v));
                  }}
                  label='启用优选和测速'
                  description='如出现播放器劫持问题可关闭'
                />
              </div>
            )}

            {/* 下载设置 */}
            <SectionHeader id='download' title='下载设置' icon={<svg className='w-4 h-4 text-orange-500' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='7 10 12 15 17 10'/><line x1='12' y1='15' x2='12' y2='3'/></svg>} />
            {expandedSections.has('download') && (
              <div className='px-4 pb-4 space-y-4 border-b border-gray-100 dark:border-gray-800'>
                <div className='flex items-center justify-between'>
                  <div>
                    <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>最大同时下载数</h4>
                    <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>同时进行的下载任务数量（1-5）</p>
                  </div>
                  <div className='flex items-center gap-2'>
                    <button
                      onClick={() => {
                        const v = Math.max(1, maxConcurrent - 1);
                        setMaxConcurrent(v);
                        saveDownloadSettings({ maxConcurrent: v, autoCleanup, downloadThreads });
                      }}
                      className='w-8 h-8 rounded-full border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
                    >-</button>
                    <span className='w-8 text-center text-sm font-medium text-gray-700 dark:text-gray-300'>{maxConcurrent}</span>
                    <button
                      onClick={() => {
                        const v = Math.min(5, maxConcurrent + 1);
                        setMaxConcurrent(v);
                        saveDownloadSettings({ maxConcurrent: v, autoCleanup, downloadThreads });
                      }}
                      className='w-8 h-8 rounded-full border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
                    >+</button>
                  </div>
                </div>
                <ToggleSwitch
                  checked={autoCleanup}
                  onChange={(v) => {
                    setAutoCleanup(v);
                    saveDownloadSettings({ maxConcurrent, autoCleanup: v, downloadThreads });
                  }}
                  label='下载完成后自动清理缓存'
                  description='下载完成后自动清理临时 ts 片段文件'
                />
                <div className='flex items-center justify-between'>
                  <div>
                    <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>下载线程数</h4>
                    <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>同时下载的视频片段数（1-10）</p>
                  </div>
                  <div className='flex items-center gap-2'>
                    <button
                      onClick={() => {
                        const v = Math.max(1, downloadThreads - 1);
                        setDownloadThreads(v);
                        saveDownloadSettings({ maxConcurrent, autoCleanup, downloadThreads: v });
                      }}
                      className='w-8 h-8 rounded-full border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
                    >-</button>
                    <span className='w-8 text-center text-sm font-medium text-gray-700 dark:text-gray-300'>{downloadThreads}</span>
                    <button
                      onClick={() => {
                        const v = Math.min(10, downloadThreads + 1);
                        setDownloadThreads(v);
                        saveDownloadSettings({ maxConcurrent, autoCleanup, downloadThreads: v });
                      }}
                      className='w-8 h-8 rounded-full border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
                    >+</button>
                  </div>
                </div>
              </div>
            )}

            {/* 代理设置 */}
            <SectionHeader id='proxy' title='代理设置' icon={<svg className='w-4 h-4 text-purple-500' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'><path d='M16 16l-4-4-4 4M12 12v9'/><path d='M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3'/><polyline points='16 16 12 12 8 16'/></svg>} />
            {expandedSections.has('proxy') && (
              <div className='px-4 pb-4 space-y-4 border-b border-gray-100 dark:border-gray-800'>
                <div className='space-y-4'>
                  <ToggleSwitch
                    checked={enableDoubanProxy}
                    onChange={(v) => {
                      setEnableDoubanProxy(v);
                      saveToStorage('enableDoubanProxy', JSON.stringify(v));
                    }}
                    label='启用豆瓣代理'
                    description='启用后，豆瓣数据将通过代理服务器获取'
                  />
                  <TextInput
                    value={doubanProxyUrl}
                    onChange={(v) => { setDoubanProxyUrl(v); saveToStorage('doubanProxyUrl', v); }}
                    placeholder='例如: https://proxy.example.com/fetch?url='
                    disabled={!enableDoubanProxy}
                    label='豆瓣代理地址'
                    description='仅在启用豆瓣代理时生效'
                  />
                </div>
                <div className='space-y-4 pt-2'>
                  <ToggleSwitch
                    checked={enableImageProxy}
                    onChange={(v) => {
                      setEnableImageProxy(v);
                      saveToStorage('enableImageProxy', JSON.stringify(v));
                    }}
                    label='启用图片代理'
                    description='启用后，所有图片加载将通过代理服务器'
                  />
                  <TextInput
                    value={imageProxyUrl}
                    onChange={(v) => { setImageProxyUrl(v); saveToStorage('imageProxyUrl', v); }}
                    placeholder='例如: https://imageproxy.example.com/?url='
                    disabled={!enableImageProxy}
                    label='图片代理地址'
                    description='仅在启用图片代理时生效'
                  />
                </div>
              </div>
            )}

            {/* 源管理 */}
            <SectionHeader id='source' title='源管理' icon={<svg className='w-4 h-4 text-yellow-500' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'><circle cx='12' cy='12' r='10'/><line x1='2' y1='12' x2='22' y2='12'/><path d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'/></svg>} />
            {expandedSections.has('source') && (
              <div className='px-4 pb-4 space-y-3'>
                {/* 全选/取消全选 */}
                <div className='flex items-center justify-between text-xs'>
                  <span className='text-gray-500 dark:text-gray-400'>
                    已启用 <span className='text-green-500 font-semibold'>{allSources.filter(s => enabledSources.has(s.key)).length}</span> / {allSources.length} 个源
                  </span>
                  <div className='flex gap-2'>
                    <button
                      onClick={() => handleToggleAllSources(true)}
                      className='text-blue-500 hover:text-blue-600 transition-colors'
                    >全选</button>
                    <span className='text-gray-300 dark:text-gray-600'>|</span>
                    <button
                      onClick={() => handleToggleAllSources(false)}
                      className='text-red-500 hover:text-red-600 transition-colors'
                    >取消全选</button>
                  </div>
                </div>

                {/* 一键检测 / 禁用失败源 */}
                <div className='flex gap-2'>
                  <button
                    onClick={async () => {
                      for (const source of allSources) {
                        await handleTestSource(source);
                      }
                    }}
                    className='flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-xs font-medium'
                  >
                    <RefreshCw className='w-3 h-3' />
                    一键检测全部
                  </button>
                  <button
                    onClick={() => {
                      const failed = new Set<string>();
                      Object.entries(sourceStatuses).forEach(([key, status]) => {
                        if (status.status === 'error') failed.add(key);
                      });
                      if (failed.size === 0) return;
                      setEnabledSources(prev => {
                        const next = new Set(prev);
                        failed.forEach(k => next.delete(k));
                        saveEnabledSources(next);
                        return next;
                      });
                    }}
                    disabled={!Object.values(sourceStatuses).some(s => s.status === 'error')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border transition-colors text-xs font-medium ${
                      Object.values(sourceStatuses).some(s => s.status === 'error')
                        ? 'border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                        : 'border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                    }`}
                  >
                    <WifiOff className='w-3 h-3' />
                    禁用全部失败源
                  </button>
                </div>

                {/* 源列表 */}
                <div className='space-y-1 max-h-[400px] overflow-y-auto pr-1'>
                  {allSources.map((source) => {
                    const status = sourceStatuses[source.key];
                    const isEnabled = enabledSources.has(source.key);
                    const isCustom = customSources.some(s => s.key === source.key);
                    const host = source.api ? (() => { try { return new URL(source.api).hostname; } catch { return source.api; } })() : '';

                    return (
                      <div
                        key={source.key}
                        className={`flex items-center justify-between py-2 px-3 rounded-lg transition-colors ${
                          isEnabled ? 'bg-white dark:bg-gray-800/50' : 'bg-gray-50 dark:bg-gray-800/30 opacity-60'
                        }`}
                      >
                        <div className='flex items-center gap-3 min-w-0 flex-1'>
                          {/* 启用/停用开关 */}
                          <label className='flex items-center cursor-pointer flex-shrink-0'>
                            <div className='relative'>
                              <input
                                type='checkbox'
                                className='sr-only peer'
                                checked={isEnabled}
                                onChange={() => handleToggleSource(source.key)}
                              />
                              <div className='w-9 h-5 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600' />
                              <div className='absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4' />
                            </div>
                          </label>

                          {/* 状态图标 */}
                          {status?.status === 'ok' ? (
                            <Wifi className='w-3.5 h-3.5 text-green-500 flex-shrink-0' />
                          ) : status?.status === 'error' ? (
                            <WifiOff className='w-3.5 h-3.5 text-red-500 flex-shrink-0' />
                          ) : (
                            <Wifi className='w-3.5 h-3.5 text-gray-400 flex-shrink-0' />
                          )}

                          {/* 源信息 */}
                          <div className='min-w-0 flex-1'>
                            <div className='flex items-center gap-2'>
                              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 truncate'>
                                {source.name}
                              </h4>
                              {isCustom && (
                                <span className='text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 flex-shrink-0'>自定义</span>
                              )}
                            </div>
                            <p className='text-xs text-gray-400 dark:text-gray-500 truncate'>
                              {host}
                              {status?.status === 'error' && status?.errorMessage && (
                                <span className='text-red-500 ml-1'>- {status.errorMessage}</span>
                              )}
                              {status?.status === 'ok' && (
                                <span className='text-green-500 ml-1'>
                                  {status.quality ? `${status.quality} ` : ''}
                                  {status.loadSpeed ? `${status.loadSpeed} ` : ''}
                                  {status.latency ? `${status.latency}ms` : '连接正常'}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>

                        <div className='flex items-center gap-1 flex-shrink-0'>
                          <button
                            onClick={() => handleTestSource(source)}
                            className='p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                            title='测试连接'
                          >
                            <RefreshCw className='w-3.5 h-3.5' />
                          </button>
                          {isCustom && (
                            <button
                              onClick={() => handleDeleteCustomSource(source.key)}
                              className='p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors'
                              title='删除源'
                            >
                              <Trash2 className='w-3.5 h-3.5' />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 新增源按钮 */}
                <button
                  onClick={() => setShowAddSource(true)}
                  className='w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-green-500 hover:text-green-500 dark:hover:border-green-500 dark:hover:text-green-400 transition-colors text-sm'
                >
                  <Plus className='w-4 h-4' />
                  新增源
                </button>

                <p className='text-xs text-gray-400 dark:text-gray-500 text-center'>
                  禁用不需要的源可以加快搜索速度
                </p>
              </div>
            )}
          </div>

          <p className='text-xs text-gray-400 dark:text-gray-500 text-center mt-6'>
            MoonTV v1.0.0
          </p>
        </div>
      </div>

      {/* 新增源弹窗 */}
      {showAddSource && (
        <div className='fixed inset-0 z-[1000] flex items-center justify-center'>
          <div className='absolute inset-0 bg-black/60 backdrop-blur-sm' onClick={() => setShowAddSource(false)} />
          <div className='relative z-10 w-full max-w-sm mx-4 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6'>
            <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4'>新增源</h2>
            <div className='space-y-4'>
              <div>
                <label className='text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block'>源名称</label>
                <input
                  type='text'
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                  placeholder='例如: 我的资源'
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
                />
              </div>
              <div>
                <label className='text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block'>源标识 (Key)</label>
                <input
                  type='text'
                  value={newSourceKey}
                  onChange={(e) => setNewSourceKey(e.target.value)}
                  placeholder='例如: my_source'
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
                />
              </div>
              <div>
                <label className='text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block'>API 地址</label>
                <input
                  type='text'
                  value={newSourceApi}
                  onChange={(e) => setNewSourceApi(e.target.value)}
                  placeholder='https://example.com/api.php/provide/vod'
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
                />
              </div>
            </div>
            <div className='flex gap-3 mt-6'>
              <button
                onClick={() => setShowAddSource(false)}
                className='flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors'
              >取消</button>
              <button
                onClick={handleAddSource}
                disabled={!newSourceName.trim() || !newSourceKey.trim() || !newSourceApi.trim()}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  newSourceName.trim() && newSourceKey.trim() && newSourceApi.trim()
                    ? 'bg-green-500 text-white hover:bg-green-600'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                }`}
              >添加</button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}