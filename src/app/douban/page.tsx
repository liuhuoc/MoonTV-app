/* eslint-disable no-console,react-hooks/exhaustive-deps */

'use client';

import { Clapperboard, Film, Loader2, MonitorPlay, Tv } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getDoubanCategories } from '@/lib/douban.client';
import { DoubanItem } from '@/lib/types';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import DoubanSelector from '@/components/DoubanSelector';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

function DoubanPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [doubanData, setDoubanData] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef<HTMLDivElement>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const requestVersionRef = useRef(0);

  const type = searchParams?.get('type') || 'movie';
  const pageSize = type === 'movie' || type === 'animation' ? 20 : 25;

  // 选择器状态 - 完全独立，不依赖URL参数
  const [primarySelection, setPrimarySelection] = useState<string>(() => {
    return type === 'movie' ? '热门' : '';
  });
  const [secondarySelection, setSecondarySelection] = useState<string>(() => {
    if (type === 'movie') return '全部';
    if (type === 'tv') return 'tv';
    if (type === 'show') return 'show';
    if (type === 'animation') return '日本';
    return '全部';
  });
  const [yearSelection, setYearSelection] = useState<string>(() => {
    return type === 'movie' || type === 'animation' ? '全部' : '全部';
  });
  const [sortSelection, setSortSelection] = useState<string>(() => {
    return type === 'movie' || type === 'animation' ? '时间' : '时间';
  });
  const timeCursorYearRef = useRef<number>(new Date().getFullYear());
  const timeCursorStartRef = useRef<number>(0);
  const timeCursorExhaustedRef = useRef<boolean>(false);

  const isMovieTimeCursorMode =
    (type === 'movie' || type === 'animation') && sortSelection === '时间' && yearSelection === '全部';

  // 当type变化时重置选择器状态
  useEffect(() => {
    if (type === 'movie') {
      setPrimarySelection('热门');
      setSecondarySelection('全部');
      setYearSelection('全部');
      setSortSelection('时间');
    } else if (type === 'tv') {
      setPrimarySelection('');
      setSecondarySelection('tv');
      setYearSelection('全部');
      setSortSelection('时间');
    } else if (type === 'show') {
      setPrimarySelection('');
      setSecondarySelection('show');
      setYearSelection('全部');
      setSortSelection('时间');
    } else if (type === 'animation') {
      setPrimarySelection('热门');
      setSecondarySelection('日本');
      setYearSelection('全部');
      setSortSelection('时间');
    } else {
      setPrimarySelection('');
      setSecondarySelection('全部');
      setYearSelection('全部');
      setSortSelection('时间');
    }
  }, [type]);

  // 生成骨架屏数据
  const skeletonData = Array.from({ length: pageSize }, (_, index) => index);

  // 生成API请求参数的辅助函数
  const getRequestParams = useCallback(
    (pageStart: number) => {
      if (type === 'tv' || type === 'show') {
        return {
          kind: 'tv' as const,
          category: type,
          type: secondarySelection,
          pageLimit: pageSize,
          pageStart,
        };
      }
      return {
        kind: (type === 'animation' ? 'movie' : type) as 'tv' | 'movie',
        category: primarySelection,
        type: secondarySelection,
        year: yearSelection,
        sort: sortSelection,
        pageLimit: pageSize,
        pageStart,
        isAnimation: type === 'animation',
      };
    },
    [type, primarySelection, secondarySelection, yearSelection, sortSelection, pageSize]
  );

  const fetchMovieTimeSortedPage = useCallback(
    async (resetCursor: boolean) => {
      let nextYear = resetCursor
        ? new Date().getFullYear()
        : timeCursorYearRef.current;
      let nextStart = resetCursor ? 0 : timeCursorStartRef.current;
      let exhausted = resetCursor ? false : timeCursorExhaustedRef.current;
      const collected: DoubanItem[] = [];

      let safety = 0;
      while (collected.length < pageSize && !exhausted && safety < 200) {
        safety += 1;
        const remaining = pageSize - collected.length;

        const data = await getDoubanCategories({
          kind: 'movie',
          category: primarySelection,
          type: secondarySelection,
          year: String(nextYear),
          sort: sortSelection,
          pageLimit: remaining,
          pageStart: nextStart,
          isAnimation: type === 'animation',
        });

        if (data.code !== 200) {
          throw new Error(data.message || '获取数据失败');
        }

        if (data.list.length > 0) {
          collected.push(...data.list);
        }

        if (data.list.length < remaining) {
          nextYear -= 1;
          nextStart = 0;
          if (nextYear < 1900) {
            exhausted = true;
          }
        } else {
          nextStart += data.list.length;
        }
      }

      return { collected, nextYear, nextStart, exhausted };
    },
    [pageSize, primarySelection, secondarySelection, sortSelection]
  );

  // 防抖的数据加载函数
  const loadInitialData = useCallback(async (requestVersion: number) => {
    try {
      setLoading(true);
      if (isMovieTimeCursorMode) {
        const { collected, nextYear, nextStart, exhausted } =
          await fetchMovieTimeSortedPage(true);
        if (requestVersionRef.current !== requestVersion) return;
        setDoubanData(collected);
        timeCursorYearRef.current = nextYear;
        timeCursorStartRef.current = nextStart;
        timeCursorExhaustedRef.current = exhausted;
        setHasMore(!exhausted && collected.length > 0);
        setLoading(false);
        return;
      }

      const data = await getDoubanCategories(getRequestParams(0));
      if (requestVersionRef.current !== requestVersion) return;

      if (data.code === 200) {
        setDoubanData(data.list);
        setHasMore(
          (type === 'movie' || type === 'animation') ? data.list.length > 0 : data.list.length === pageSize
        );
        setLoading(false);
      } else {
        throw new Error(data.message || '获取数据失败');
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
      console.error('分类加载失败:', errMsg, err);
      if (requestVersionRef.current !== requestVersion) return;
      setDoubanData([]);
      setHasMore(false);
      setLoading(false);
    }
  }, [
    fetchMovieTimeSortedPage,
    getRequestParams,
    isMovieTimeCursorMode,
    pageSize,
    primarySelection,
    secondarySelection,
    sortSelection,
    type,
  ]);

  // 初始化时直接触发数据加载
  useEffect(() => {
    setDoubanData([]);
    setCurrentPage(0);
    setHasMore(true);
    setIsLoadingMore(false);
    timeCursorYearRef.current = new Date().getFullYear();
    timeCursorStartRef.current = 0;
    timeCursorExhaustedRef.current = false;

    requestVersionRef.current += 1;
    const requestVersion = requestVersionRef.current;

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      loadInitialData(requestVersion);
    }, 100);

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [
    type,
    primarySelection,
    secondarySelection,
    yearSelection,
    sortSelection,
    loadInitialData,
  ]);

  // 单独处理 currentPage 变化（加载更多）
  useEffect(() => {
    if (currentPage > 0) {
      const fetchMoreData = async () => {
        try {
          const requestVersion = requestVersionRef.current;
          setIsLoadingMore(true);

          if (isMovieTimeCursorMode) {
            const { collected, nextYear, nextStart, exhausted } =
              await fetchMovieTimeSortedPage(false);
            if (requestVersionRef.current !== requestVersion) return;
            setDoubanData((prev) => [...prev, ...collected]);
            timeCursorYearRef.current = nextYear;
            timeCursorStartRef.current = nextStart;
            timeCursorExhaustedRef.current = exhausted;
            setHasMore(!exhausted && collected.length > 0);
            return;
          }

          const data = await getDoubanCategories(getRequestParams(currentPage * pageSize));
          if (requestVersionRef.current !== requestVersion) return;

          if (data.code === 200) {
            setDoubanData((prev) => [...prev, ...data.list]);
            setHasMore(
              (type === 'movie' || type === 'animation') ? data.list.length > 0 : data.list.length === pageSize
            );
          } else {
            throw new Error(data.message || '获取数据失败');
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
          console.error('加载更多失败:', errMsg, err);
        } finally {
          setIsLoadingMore(false);
        }
      };

      fetchMoreData();
    }
  }, [
    currentPage,
    fetchMovieTimeSortedPage,
    getRequestParams,
    isMovieTimeCursorMode,
    pageSize,
    primarySelection,
    secondarySelection,
    sortSelection,
    type,
    yearSelection,
  ]);

  // 设置滚动监听
  useEffect(() => {
    if (!hasMore || isLoadingMore || loading) return;
    if (!loadingRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          setCurrentPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadingRef.current);
    observerRef.current = observer;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [hasMore, isLoadingMore, loading]);

  // 处理选择器变化
  const handlePrimaryChange = useCallback(
    (value: string) => {
      if (value !== primarySelection) {
        setLoading(true);
        setPrimarySelection(value);
      }
    },
    [primarySelection]
  );

  const handleSecondaryChange = useCallback(
    (value: string) => {
      if (value !== secondarySelection) {
        setLoading(true);
        setSecondarySelection(value);
      }
    },
    [secondarySelection]
  );

  const handleYearChange = useCallback(
    (value: string) => {
      if (value !== yearSelection) {
        setLoading(true);
        setYearSelection(value);
      }
    },
    [yearSelection]
  );

  const handleSortChange = useCallback(
    (value: string) => {
      if (value !== sortSelection) {
        setLoading(true);
        setSortSelection(value);
      }
    },
    [sortSelection]
  );

  // 类型切换：保留当前筛选条件，切换 type
  const handleTypeSwitch = (newType: string) => {
    const params = new URLSearchParams();
    params.set('type', newType);
    router.push(`/douban?${params.toString()}`);
  };

  const getPageTitle = () => {
    return type === 'movie' ? '电影' : type === 'tv' ? '电视剧' : type === 'animation' ? '动漫' : '综艺';
  };

  const getActivePath = () => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    const queryString = params.toString();
    const activePath = `/douban${queryString ? `?${queryString}` : ''}`;
    return activePath;
  };

  const TitleIcon = type === 'movie' ? Film : type === 'animation' ? Clapperboard : Tv;

  const typeTabs = [
    { key: 'movie', label: '电影', icon: Film },
    { key: 'tv', label: '剧集', icon: Tv },
    { key: 'animation', label: '动漫', icon: Clapperboard },
    { key: 'show', label: '综艺', icon: MonitorPlay },
  ];

  return (
    <PageLayout activePath={getActivePath()}>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible'>
        {/* 页面标题和选择器 */}
        <div className='mb-8 sm:mb-10 space-y-6 sm:space-y-8 fade-in-up'>
          {/* 页面标题 */}
          <div className='flex items-center gap-3'>
            <TitleIcon className='w-8 h-8 text-green-500' />
            <div>
              <h1 className='text-3xl sm:text-4xl font-bold text-gradient'>
                {getPageTitle()}
              </h1>
              <p className='text-sm sm:text-base text-gray-500 dark:text-gray-400 mt-1'>
                来自豆瓣的精选内容
              </p>
            </div>
          </div>

          {/* 类型切换 Tab */}
          <div className='flex gap-2 fade-in-up fade-in-up-delay-1'>
            {typeTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = type === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => handleTypeSwitch(tab.key)}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-300 ${
                    isActive
                      ? 'bg-green-500 text-white shadow-lg shadow-green-500/25'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:scale-105'
                  }`}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* 选择器组件 */}
          <div className='glass rounded-3xl p-5 sm:p-8 fade-in-up fade-in-up-delay-2'>
            <DoubanSelector
              type={type as 'movie' | 'tv' | 'show'}
              primarySelection={primarySelection}
              secondarySelection={secondarySelection}
              yearSelection={yearSelection}
              sortSelection={sortSelection}
              onPrimaryChange={handlePrimaryChange}
              onSecondaryChange={handleSecondaryChange}
              onYearChange={handleYearChange}
              onSortChange={handleSortChange}
            />
          </div>
        </div>

        {/* 内容展示区域 */}
        <div className='max-w-[95%] mx-auto mt-8 overflow-visible fade-in-up fade-in-up-delay-3'>
          {/* 内容网格 */}
          <div className='grid grid-cols-3 gap-x-3 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] sm:gap-x-10'>
            {loading
              ? skeletonData.map((index) => <DoubanCardSkeleton key={index} />)
              : doubanData.map((item, index) => (
                  <div key={`${item.title}-${index}`} className='w-full'>
                    <VideoCard
                      from='douban'
                      title={item.title}
                      poster={item.poster}
                      douban_id={item.id}
                      rate={item.rate}
                      year={item.year}
                      type={type === 'movie' ? 'movie' : ''}
                    />
                  </div>
                ))}
          </div>

          {/* 加载更多指示器 */}
          {hasMore && !loading && (
            <div
              ref={(el) => {
                if (el && el.offsetParent !== null) {
                  (
                    loadingRef as React.MutableRefObject<HTMLDivElement | null>
                  ).current = el;
                }
              }}
              className='flex justify-center mt-16 py-8'
            >
              {isLoadingMore && (
                <div className='flex items-center gap-3'>
                  <Loader2 className='w-5 h-5 text-green-500 animate-spin' />
                  <span className='text-sm text-gray-500 dark:text-gray-400'>加载中...</span>
                </div>
              )}
            </div>
          )}

          {/* 没有更多数据提示 */}
          {!hasMore && doubanData.length > 0 && (
            <div className='text-center text-gray-500 dark:text-gray-500 py-8 text-sm'>
              已加载全部内容
            </div>
          )}

          {/* 空状态 */}
          {!loading && doubanData.length === 0 && (
            <div className='flex flex-col items-center justify-center py-16 text-gray-500 dark:text-gray-400 fade-in'>
              <Film className='w-12 h-12 mb-4 opacity-30' />
              <p className='text-lg'>暂无相关内容</p>
              <p className='text-sm mt-1 opacity-60'>试试更换分类、地区、年份或排序</p>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

export default function DoubanPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin"></div></div>}>
      <DoubanPageClient />
    </Suspense>
  );
}