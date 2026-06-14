/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { ArrowRight, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

// 客户端收藏 API
import { getDoubanCategories } from '@/lib/douban.client';
import { DoubanItem } from '@/lib/types';

import ContinueWatching from '@/components/ContinueWatching';
import PageLayout from '@/components/PageLayout';
import ScrollableRow from '@/components/ScrollableRow';
import VideoCard from '@/components/VideoCard';

function HomeClient() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [hotMovies, setHotMovies] = useState<DoubanItem[]>([]);
  const [hotTvShows, setHotTvShows] = useState<DoubanItem[]>([]);
  const [hotVarietyShows, setHotVarietyShows] = useState<DoubanItem[]>([]);
  const [hotAnimation, setHotAnimation] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(true);

  const CATEGORY_CACHE_KEY = 'moontv_category_cache';

  const getCacheTTL = () => {
    try {
      const raw = localStorage.getItem('categoryCacheMinutes');
      if (raw) return parseInt(raw, 10) * 60 * 1000;
    } catch { /* ignore */ }
    return 60 * 60 * 1000; // 默认1小时
  };

  const loadCategoryCache = () => {
    try {
      const raw = sessionStorage.getItem(CATEGORY_CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (Date.now() - cached.time > getCacheTTL()) {
        sessionStorage.removeItem(CATEGORY_CACHE_KEY);
        return null;
      }
      return cached.data;
    } catch { return null; }
  };

  const saveCategoryCache = (data: { movies: DoubanItem[]; tv: DoubanItem[]; variety: DoubanItem[]; anime: DoubanItem[] }) => {
    try {
      sessionStorage.setItem(CATEGORY_CACHE_KEY, JSON.stringify({ data, time: Date.now() }));
    } catch { /* ignore */ }
  };

  useEffect(() => {
    const fetchDoubanData = async () => {
      try {
        // 先尝试读取缓存
        const cached = loadCategoryCache();
        if (cached) {
          setHotMovies(cached.movies);
          setHotTvShows(cached.tv);
          setHotVarietyShows(cached.variety);
          setHotAnimation(cached.anime);
          setLoading(false);
          return;
        }

        setLoading(true);

        const results = await Promise.allSettled([
          getDoubanCategories({
            kind: 'movie',
            category: '热门',
            type: '全部',
          }),
          getDoubanCategories({ kind: 'tv', category: 'tv', type: 'tv' }),
          getDoubanCategories({ kind: 'tv', category: 'show', type: 'show' }),
          getDoubanCategories({ kind: 'movie', category: '热门', type: '日本' }),
        ]);

        const [moviesResult, tvResult, varietyResult, animationResult] = results;

        if (moviesResult.status === 'fulfilled' && moviesResult.value.code === 200) {
          setHotMovies(moviesResult.value.list);
        } else {
          const moviesErr = moviesResult.status === 'rejected' ? moviesResult.reason : moviesResult.value?.message;
          console.warn('热门电影加载失败:', moviesErr instanceof Error ? moviesErr.message : JSON.stringify(moviesErr));
        }

        if (tvResult.status === 'fulfilled' && tvResult.value.code === 200) {
          setHotTvShows(tvResult.value.list);
        } else {
          const tvErr = tvResult.status === 'rejected' ? tvResult.reason : tvResult.value?.message;
          console.warn('热门剧集加载失败:', tvErr instanceof Error ? tvErr.message : JSON.stringify(tvErr));
        }

        if (varietyResult.status === 'fulfilled' && varietyResult.value.code === 200) {
          setHotVarietyShows(varietyResult.value.list);
        } else {
          const varietyErr = varietyResult.status === 'rejected' ? varietyResult.reason : varietyResult.value?.message;
          console.warn('热门综艺加载失败:', varietyErr instanceof Error ? varietyErr.message : JSON.stringify(varietyErr));
        }

        if (animationResult.status === 'fulfilled' && animationResult.value.code === 200) {
          setHotAnimation(animationResult.value.list);
        } else {
          const animationErr = animationResult.status === 'rejected' ? animationResult.reason : animationResult.value?.message;
          console.warn('热门动漫加载失败:', animationErr instanceof Error ? animationErr.message : JSON.stringify(animationErr));
        }

        // 保存缓存（使用原始结果，state 尚未更新）
        const cachedMovies = moviesResult.status === 'fulfilled' && moviesResult.value.code === 200 ? moviesResult.value.list : [];
        const cachedTv = tvResult.status === 'fulfilled' && tvResult.value.code === 200 ? tvResult.value.list : [];
        const cachedVariety = varietyResult.status === 'fulfilled' && varietyResult.value.code === 200 ? varietyResult.value.list : [];
        const cachedAnime = animationResult.status === 'fulfilled' && animationResult.value.code === 200 ? animationResult.value.list : [];
        saveCategoryCache({ movies: cachedMovies, tv: cachedTv, variety: cachedVariety, anime: cachedAnime });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : JSON.stringify(error);
        console.error('获取豆瓣数据失败:', errMsg, error);
      } finally {
        setLoading(false);
      }
    };

    fetchDoubanData();
  }, []);

  // 骨架屏卡片
  const SkeletonCard = () => (
    <div className='min-w-[120px] w-28 sm:min-w-[200px] sm:w-48'>
      <div className='relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-gray-200 dark:bg-gray-800 shimmer' />
      <div className='mt-3 h-4 w-3/4 rounded-md bg-gray-200 dark:bg-gray-800 shimmer' />
      <div className='mt-2 h-3 w-1/2 rounded-md bg-gray-200 dark:bg-gray-800 shimmer' />
    </div>
  );

  // 带标题和横向滚动的内容区块
  const ContentSection = ({
    title,
    href,
    children,
  }: {
    title: string;
    href: string;
    children: React.ReactNode;
  }) => (
    <section className='mb-10 sm:mb-14'>
      <div className='mb-5 flex items-center justify-between'>
        <h2 className='text-2xl font-bold bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent'>
          {title}
        </h2>
        <Link
          href={href}
          className='flex items-center text-sm text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors'
          aria-label={`查看更多${title}`}
        >
          <ArrowRight className='w-5 h-5' />
        </Link>
      </div>
      <ScrollableRow>{children}</ScrollableRow>
    </section>
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <PageLayout>
      <div className='px-4 sm:px-10 py-8 sm:py-12 overflow-visible'>
        <div className='max-w-[95%] mx-auto'>
          {/* 顶部标题 */}
          <div className='mb-10 sm:mb-14'>
            <h1 className='text-4xl sm:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent'>
              MoonTV
            </h1>
            <p className='mt-2 text-base sm:text-lg text-gray-500 dark:text-gray-400'>
              发现精彩，随时观看
            </p>
          </div>

          {/* 搜索框 */}
          <div className='mb-10 sm:mb-14'>
            <form onSubmit={handleSearch} className='max-w-2xl'>
              <div className='relative group'>
                <Search className='absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500 transition-colors group-focus-within:text-green-400' />
                <input
                  type='text'
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder='搜索电影、电视剧...'
                  onClick={() => router.push('/search')}
                  className='w-full h-14 rounded-full bg-white dark:bg-[#1a1a2e]/80 py-3 pl-14 pr-12 text-base text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-400/50 focus:border-green-400/50 border border-gray-200 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20 transition-colors duration-200 cursor-pointer'
                  readOnly
                />
              </div>
            </form>
          </div>

          {/* 继续观看 */}
          <ContinueWatching />

          {/* 热门电影 */}
          <ContentSection title='热门电影' href='/douban?type=movie'>
            {loading
              ? Array.from({ length: 8 }).map((_, index) => (
                  <SkeletonCard key={index} />
                ))
              : hotMovies.map((movie, index) => (
                  <div
                    key={index}
                    className='min-w-[120px] w-28 sm:min-w-[200px] sm:w-48'
                  >
                    <VideoCard
                      from='douban'
                      title={movie.title}
                      poster={movie.poster}
                      douban_id={movie.id}
                      rate={movie.rate}
                      year={movie.year}
                      type='movie'
                    />
                  </div>
                ))}
          </ContentSection>

          {/* 热门剧集 */}
          <ContentSection title='热门剧集' href='/douban?type=tv'>
            {loading
              ? Array.from({ length: 8 }).map((_, index) => (
                  <SkeletonCard key={index} />
                ))
              : hotTvShows.map((show, index) => (
                  <div
                    key={index}
                    className='min-w-[120px] w-28 sm:min-w-[200px] sm:w-48'
                  >
                    <VideoCard
                      from='douban'
                      title={show.title}
                      poster={show.poster}
                      douban_id={show.id}
                      rate={show.rate}
                      year={show.year}
                    />
                  </div>
                ))}
          </ContentSection>

          {/* 热门综艺 */}
          <ContentSection title='热门综艺' href='/douban?type=show'>
            {loading
              ? Array.from({ length: 8 }).map((_, index) => (
                  <SkeletonCard key={index} />
                ))
              : hotVarietyShows.map((show, index) => (
                  <div
                    key={index}
                    className='min-w-[120px] w-28 sm:min-w-[200px] sm:w-48'
                  >
                    <VideoCard
                      from='douban'
                      title={show.title}
                      poster={show.poster}
                      douban_id={show.id}
                      rate={show.rate}
                      year={show.year}
                    />
                  </div>
                ))}
          </ContentSection>

          {/* 热门动漫 */}
          <ContentSection title='热门动漫' href='/douban?type=animation'>
            {loading
              ? Array.from({ length: 8 }).map((_, index) => (
                  <SkeletonCard key={index} />
                ))
              : hotAnimation.map((show, index) => (
                  <div
                    key={index}
                    className='min-w-[120px] w-28 sm:min-w-[200px] sm:w-48'
                  >
                    <VideoCard
                      from='douban'
                      title={show.title}
                      poster={show.poster}
                      douban_id={show.id}
                      rate={show.rate}
                      year={show.year}
                      type='movie'
                    />
                  </div>
                ))}
          </ContentSection>
        </div>
      </div>
    </PageLayout>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}
