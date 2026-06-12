'use client';

import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import PageLayout from '@/components/PageLayout';

export default function SettingsPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  // 设置相关状态
  const [defaultAggregateSearch, setDefaultAggregateSearch] = useState(true);
  const [doubanProxyUrl, setDoubanProxyUrl] = useState('');
  const [imageProxyUrl, setImageProxyUrl] = useState('');
  const [enableOptimization, setEnableOptimization] = useState(true);
  const [enableImageProxy, setEnableImageProxy] = useState(false);
  const [enableDoubanProxy, setEnableDoubanProxy] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 从 localStorage 读取设置
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedAggregateSearch = localStorage.getItem('defaultAggregateSearch');
    if (savedAggregateSearch !== null) {
      setDefaultAggregateSearch(JSON.parse(savedAggregateSearch));
    }
    const savedEnableDoubanProxy = localStorage.getItem('enableDoubanProxy');
    if (savedEnableDoubanProxy !== null) {
      setEnableDoubanProxy(JSON.parse(savedEnableDoubanProxy));
    }
    const savedDoubanProxyUrl = localStorage.getItem('doubanProxyUrl');
    if (savedDoubanProxyUrl !== null) {
      setDoubanProxyUrl(savedDoubanProxyUrl);
    }
    const savedEnableImageProxy = localStorage.getItem('enableImageProxy');
    if (savedEnableImageProxy !== null) {
      setEnableImageProxy(JSON.parse(savedEnableImageProxy));
    }
    const savedImageProxyUrl = localStorage.getItem('imageProxyUrl');
    if (savedImageProxyUrl !== null) {
      setImageProxyUrl(savedImageProxyUrl);
    }
    const savedEnableOptimization = localStorage.getItem('enableOptimization');
    if (savedEnableOptimization !== null) {
      setEnableOptimization(JSON.parse(savedEnableOptimization));
    }
  }, []);

  const saveToStorage = (key: string, value: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(key, value);
    }
  };

  const handleResetSettings = () => {
    setDefaultAggregateSearch(true);
    setEnableOptimization(true);
    setDoubanProxyUrl('');
    setEnableDoubanProxy(false);
    setEnableImageProxy(false);
    setImageProxyUrl('');

    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(true));
      localStorage.setItem('enableOptimization', JSON.stringify(true));
      localStorage.setItem('doubanProxyUrl', '');
      localStorage.setItem('enableDoubanProxy', JSON.stringify(false));
      localStorage.setItem('enableImageProxy', JSON.stringify(false));
      localStorage.setItem('imageProxyUrl', '');
    }
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
          <div className='space-y-6 bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-800'>
            {/* 搜索设置 */}
            <div className='pb-4 border-b border-gray-100 dark:border-gray-800'>
              <h3 className='text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4'>搜索</h3>
              <ToggleSwitch
                checked={defaultAggregateSearch}
                onChange={(v) => {
                  setDefaultAggregateSearch(v);
                  saveToStorage('defaultAggregateSearch', JSON.stringify(v));
                }}
                label='默认聚合搜索结果'
                description='搜索时默认按标题和年份聚合显示结果'
              />
            </div>

            {/* 播放设置 */}
            <div className='pb-4 border-b border-gray-100 dark:border-gray-800'>
              <h3 className='text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4'>播放</h3>
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

            {/* 豆瓣代理 */}
            <div className='pb-4 border-b border-gray-100 dark:border-gray-800'>
              <h3 className='text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4'>豆瓣代理</h3>
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
                  onChange={(v) => {
                    setDoubanProxyUrl(v);
                    saveToStorage('doubanProxyUrl', v);
                  }}
                  placeholder='例如: https://proxy.example.com/fetch?url='
                  disabled={!enableDoubanProxy}
                  label='豆瓣代理地址'
                  description='仅在启用豆瓣代理时生效'
                />
              </div>
            </div>

            {/* 图片代理 */}
            <div>
              <h3 className='text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4'>图片代理</h3>
              <div className='space-y-4'>
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
                  onChange={(v) => {
                    setImageProxyUrl(v);
                    saveToStorage('imageProxyUrl', v);
                  }}
                  placeholder='例如: https://imageproxy.example.com/?url='
                  disabled={!enableImageProxy}
                  label='图片代理地址'
                  description='仅在启用图片代理时生效'
                />
              </div>
            </div>
          </div>

          <p className='text-xs text-gray-400 dark:text-gray-500 text-center mt-6'>
            MoonTV v1.0.0
          </p>
        </div>
      </div>
    </PageLayout>
  );
}