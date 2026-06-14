/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any */
'use client';

import { ChevronUp, History, Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { searchFromApi, type ApiSite } from '@/lib/downstream';
import type { SearchResult } from '@/lib/types';
import { getAvailableApiSites } from '@/lib/config';
import { processImageUrl } from '@/lib/utils';

import PageLayout from '@/components/PageLayout';

function ResultRow({ item, query, onClick }: { item: SearchResult; query: string; onClick: () => void }) {
  const title = item.title;
  const poster = item.poster;
  const year = item.year && item.year !== 'unknown' ? item.year : '';
  const typeName = item.type_name || '';
  const epCount = item.episodes?.length || 0;
  const sourceName = item.source_name || '';
  const desc = item.desc || '';
  const truncatedDesc = desc.length > 80 ? desc.slice(0, 80) + '...' : desc;

  return (
    <div
      onClick={onClick}
      className='flex gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 cursor-pointer transition-all duration-200'
    >
      <div className='w-16 h-[5.5rem] shrink-0 rounded-lg overflow-hidden bg-gray-800'>
        {poster ? (
          <img src={processImageUrl(poster)} alt={title} referrerPolicy='origin' className='w-full h-full object-cover' />
        ) : (
          <div className='w-full h-full flex items-center justify-center text-gray-600'>
            <svg className='w-6 h-6' fill='none' viewBox='0 0 24 24' stroke='currentColor' strokeWidth={1}><path strokeLinecap='round' strokeLinejoin='round' d='M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z'/></svg>
          </div>
        )}
      </div>
      <div className='flex-1 min-w-0 flex flex-col justify-center gap-1'>
        <div className='flex items-center gap-2'>
          <h4 className='text-sm font-medium text-gray-200 truncate'>{title}</h4>
          {sourceName && (
            <span className='text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 shrink-0'>{sourceName}</span>
          )}
        </div>
        <div className='flex items-center gap-2 text-xs text-gray-500'>
          {year && <span>{year}</span>}
          {typeName && <span className='px-1 py-0.5 rounded bg-white/5'>{typeName}</span>}
          {epCount > 0 && <span>{epCount}集</span>}
          {query && title !== query && <span className='text-gray-600' title={`搜索词: ${query}`}>🔍{query}</span>}
        </div>
        {truncatedDesc && (
          <p className='text-xs text-gray-500 dark:text-gray-600 line-clamp-2 leading-relaxed'>{truncatedDesc}</p>
        )}
      </div>
    </div>
  );
}

function SearchPageClient() {
  // 搜索历史
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  // 返回顶部按钮显示状态
  const [showBackToTop, setShowBackToTop] = useState(false);
  // 记录上次搜索的关键词，防止侧滑返回时重复搜索
  const lastSearchedQueryRef = useRef<string>('');

  const SEARCH_CACHE_KEY = 'moontv_search_cache';

  const saveSearchCache = (query: string, results: any[], order: string[]) => {
    try {
      sessionStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify({ query, results, order, time: Date.now() }));
    } catch { /* ignore */ }
  };

  const loadSearchCache = (): { query: string; results: any[]; order: string[] } | null => {
    try {
      const raw = sessionStorage.getItem(SEARCH_CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (Date.now() - cached.time > 5 * 60 * 1000) {
        sessionStorage.removeItem(SEARCH_CACHE_KEY);
        return null;
      }
      return cached;
    } catch { return null; }
  };

  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [sourceOrder, setSourceOrder] = useState<string[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>('');
  const [loadingSources, setLoadingSources] = useState(false);

  // 按源分组
  const sourceGroups = useMemo(() => {
    const map = new Map<string, any[]>();
    searchResults.forEach((item) => {
      const name = item.source_name || item.source || '未知';
      const arr = map.get(name) || [];
      arr.push(item);
      map.set(name, arr);
    });
    return sourceOrder.filter(name => map.has(name)).map(name => [name, map.get(name)!] as [string, any[]]);
  }, [searchResults, sourceOrder]);

  // 当前选中源的结果
  const filteredResults = useMemo(() => {
    if (!selectedSource) return [];
    return searchResults.filter((item) => (item.source_name || item.source) === selectedSource);
  }, [searchResults, selectedSource]);

  // 计算结果后自动选第一个源
  useEffect(() => {
    if (!selectedSource && sourceGroups.length > 0) {
      setSelectedSource(sourceGroups[0][0]);
    }
  }, [sourceGroups, selectedSource]);

  useEffect(() => {
    // 无搜索参数时聚焦搜索框
    !searchParams?.get('q') && document.getElementById('searchInput')?.focus();

    // 初始加载搜索历史
    getSearchHistory().then(setSearchHistory);

    // 监听搜索历史更新事件
    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (newHistory: string[]) => {
        setSearchHistory(newHistory);
      }
    );

    // 获取滚动位置的函数 - 专门针对 body 滚动
    const getScrollTop = () => {
      return document.body.scrollTop || 0;
    };

    // 使用 requestAnimationFrame 持续检测滚动位置
    let isRunning = false;
    const checkScrollPosition = () => {
      if (!isRunning) return;

      const scrollTop = getScrollTop();
      const shouldShow = scrollTop > 300;
      setShowBackToTop(shouldShow);

      requestAnimationFrame(checkScrollPosition);
    };

    // 启动持续检测
    isRunning = true;
    checkScrollPosition();

    // 监听 body 元素的滚动事件
    const handleScroll = () => {
      const scrollTop = getScrollTop();
      setShowBackToTop(scrollTop > 300);
    };

    document.body.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      unsubscribe();
      isRunning = false;
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    // 当搜索参数变化时更新搜索状态
    const query = searchParams?.get('q');
    if (query) {
      // 如果已经搜索过相同的关键词，不重复搜索
      if (lastSearchedQueryRef.current === query && showResults) {
        setSearchQuery(query);
        return;
      }
      // 检查缓存，侧滑返回时直接从缓存恢复
      const cached = loadSearchCache();
      if (cached && cached.query === query) {
        setSearchQuery(query);
        setSearchResults(cached.results);
        if (cached.order) setSourceOrder(cached.order);
        setShowResults(true);
        lastSearchedQueryRef.current = query;
        setIsLoading(false);
        return;
      }
      setSearchQuery(query);
      lastSearchedQueryRef.current = query;
      fetchSearchResults(query);

      // 保存到搜索历史 (事件监听会自动更新界面)
      addSearchHistory(query);
    } else {
      setShowResults(false);
      lastSearchedQueryRef.current = '';
    }
  }, [searchParams]);

  const sortResults = (results: any[], query: string) => {
    return [...results].sort((a, b) => {
      const aExactMatch = a.title === query.trim();
      const bExactMatch = b.title === query.trim();
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;
      if (a.year === b.year) return a.title.localeCompare(b.title);
      if (a.year === 'unknown' && b.year === 'unknown') return 0;
      if (a.year === 'unknown') return 1;
      if (b.year === 'unknown') return -1;
      return parseInt(a.year) > parseInt(b.year) ? -1 : 1;
    });
  };

  const dedupeResults = (results: any[]) => {
    const seen = new Set<string>();
    return results.filter(r => {
      const key = `${r.source}-${r.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const fetchSearchResults = async (query: string) => {
    try {
      setIsLoading(true);
      setSearchResults([]);
      setSourceOrder([]);
      setSelectedSource('');
      setLoadingSources(true);

      const apiSites = await getAvailableApiSites();
      const allResults: any[] = [];
      const arrivedSources: string[] = [];

      // 并发搜索所有源，每个源结果到达即展示
      const sourcePromises = apiSites.map(async (site) => {
        try {
          const results = await searchFromApi(site, query);
          if (results.length > 0) {
            allResults.push(...results);
            const deduped = dedupeResults(allResults);
            setSearchResults(sortResults(deduped, query));
            arrivedSources.push(site.name);
            setSourceOrder([...arrivedSources]);
            if (deduped.length > 0 && !showResults) {
              setShowResults(true);
            }
          }
        } catch {
          // 该源搜索失败，跳过
        }
      });

      await Promise.all(sourcePromises);

      if (allResults.length > 0) {
        saveSearchCache(query, dedupeResults(allResults), arrivedSources);
      }
      setIsLoading(false);
      setLoadingSources(false);
    } catch {
      setSearchResults([]);
      setIsLoading(false);
      setLoadingSources(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;

    // 回显搜索框
    setSearchQuery(trimmed);
    setIsLoading(true);
    setShowResults(true);

    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    // 直接发请求
    fetchSearchResults(trimmed);

    // 保存到搜索历史 (事件监听会自动更新界面)
    addSearchHistory(trimmed);
  };

  // 返回顶部功能
  const scrollToTop = () => {
    try {
      // 根据调试结果，真正的滚动容器是 document.body
      document.body.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } catch (error) {
      // 如果平滑滚动完全失败，使用立即滚动
      document.body.scrollTop = 0;
    }
  };

  return (
    <PageLayout activePath='/search'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10'>
        {/* 搜索框 */}
        <div className='mb-10'>
          <form onSubmit={handleSearch} className='max-w-2xl mx-auto'>
            <div className='relative group'>
              <Search className='absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500 transition-colors group-focus-within:text-green-400' />
              <input
                id='searchInput'
                type='text'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='搜索电影、电视剧...'
                className='w-full h-14 rounded-full bg-white dark:bg-[#1a1a2e]/80 py-3 pl-14 pr-12 text-base text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-400/50 focus:border-green-400/50 border border-gray-200 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20 transition-all duration-300'
              />
              {searchQuery && (
                <button
                  type='button'
                  onClick={() => setSearchQuery('')}
                  className='absolute right-4 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-gray-400 hover:text-gray-200 transition-all'
                >
                  <X className='w-4 h-4' />
                </button>
              )}
            </div>
          </form>
        </div>

        {/* 搜索结果或搜索历史 */}
        <div className='max-w-[95%] mx-auto mt-12 overflow-visible'>
          {isLoading ? (
            <div className='flex justify-center items-center h-48'>
              <div className='relative'>
                <div className='w-10 h-10 rounded-full border-2 border-gray-700'></div>
                <div className='absolute inset-0 w-10 h-10 rounded-full border-2 border-t-green-400 animate-spin'></div>
              </div>
            </div>
          ) : showResults ? (
            <section className='mb-12'>
              <div className='flex items-center justify-between mb-6'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                  搜索结果 ({searchResults.length})
                </h2>
                {loadingSources && (
                  <span className='text-xs text-gray-400 animate-pulse'>加载更多源...</span>
                )}
              </div>
              {searchResults.length === 0 ? (
                <div className='flex flex-col items-center justify-center py-16 text-gray-500 dark:text-gray-400'>
                  <Search className='w-12 h-12 mb-4 opacity-30' />
                  <p className='text-lg'>未找到相关结果</p>
                  <p className='text-sm mt-1 opacity-60'>换个关键词试试吧</p>
                </div>
              ) : (
                <div className='flex gap-4'>
                  {/* 左侧源列表 */}
                  <div className='w-40 shrink-0'>
                    <div className='sticky top-20 space-y-0.5'>
                      {sourceGroups.map(([name, items]) => (
                        <button
                          key={name}
                          onClick={() => setSelectedSource(name)}
                          className={`w-full text-left px-2.5 py-2 rounded-md text-xs transition-colors ${
                            selectedSource === name
                              ? 'bg-green-500/20 text-green-400 font-medium'
                              : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                          }`}
                          title={name}
                        >
                          <span className='block truncate'>{name}</span>
                          <span className='text-[10px] opacity-60'>{items.length} 项</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* 右侧结果 - 行式布局 */}
                  <div className='flex-1 min-w-0'>
                    {!selectedSource ? (
                      <div className='flex items-center justify-center py-16 text-gray-500 text-sm'>选择左侧源查看结果</div>
                    ) : (
                      <div className='space-y-2'>
                        {filteredResults.map((item: SearchResult) => (
                          <ResultRow
                            key={`${item.source}-${item.id}`}
                            item={item}
                            query={searchQuery.trim()}
                            onClick={() => {
                              router.push(
                                `/play?source=${encodeURIComponent(item.source)}&id=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title)}&searchTitle=${encodeURIComponent(searchQuery.trim())}`
                              );
                            }}
                          />
                        ))}
                        {filteredResults.length === 0 && (
                          <div className='flex items-center justify-center py-16 text-gray-500 text-sm'>该源无匹配结果</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          ) : searchHistory.length > 0 ? (
            // 搜索历史
            <section className='mb-12'>
              <div className='flex items-center justify-between mb-6'>
                <div className='flex items-center gap-2'>
                  <History className='w-5 h-5 text-gray-500 dark:text-gray-400' />
                  <h2 className='text-lg font-semibold text-gray-800 dark:text-gray-200'>
                    搜索历史
                  </h2>
                </div>
                <button
                  onClick={() => {
                    clearSearchHistory(); // 事件监听会自动更新界面
                  }}
                  className='text-sm text-gray-500 hover:text-red-400 transition-colors dark:text-gray-400 dark:hover:text-red-400'
                >
                  清空
                </button>
              </div>
              <div className='flex flex-wrap gap-3'>
                {searchHistory.map((item) => (
                  <div key={item} className='relative group'>
                    <button
                      onClick={() => {
                        setSearchQuery(item);
                        router.push(
                          `/search?q=${encodeURIComponent(item.trim())}`
                        );
                      }}
                      className='px-5 py-2.5 rounded-full text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 border border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 transition-all duration-200'
                    >
                      {item}
                    </button>
                    {/* 删除按钮 */}
                    <button
                      aria-label='删除搜索历史'
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        deleteSearchHistory(item); // 事件监听会自动更新界面
                      }}
                      className='absolute -top-1.5 -right-1.5 w-5 h-5 opacity-0 group-hover:opacity-100 bg-gray-600 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] transition-all duration-200 shadow-lg'
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {/* 返回顶部悬浮按钮 */}
      <button
        onClick={scrollToTop}
        className={`fixed bottom-20 md:bottom-6 right-6 z-[500] w-10 h-10 glass rounded-full shadow-lg transition-all duration-300 ease-in-out flex items-center justify-center group hover:scale-110 ${
          showBackToTop
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        aria-label='返回顶部'
      >
        <ChevronUp className='w-5 h-5 text-gray-300 transition-transform group-hover:-translate-y-0.5' />
      </button>
    </PageLayout>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageClient />
    </Suspense>
  );
}
