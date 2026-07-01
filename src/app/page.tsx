/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { ArrowRight, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { getDoubanCategories } from '@/lib/douban.client';
import { DoubanItem } from '@/lib/types';

import ContinueWatching from '@/components/ContinueWatching';
import PageLayout from '@/components/PageLayout';
import ScrollableRow from '@/components/ScrollableRow';
import VideoCard from '@/components/VideoCard';

type CategoryCache = {
  movies: DoubanItem[];
  tv: DoubanItem[];
  variety: DoubanItem[];
  anime: DoubanItem[];
  time: number;
};

let __categoryCache: CategoryCache | null = null;

function HomeClient() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [hotMovies, setHotMovies] = useState<DoubanItem[]>([]);
  const [hotTvShows, setHotTvShows] = useState<DoubanItem[]>([]);
  const [hotVarietyShows, setHotVarietyShows] = useState<DoubanItem[]>([]);
  const [hotAnimation, setHotAnimation] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);

  const getCacheTTL = () => {
    try {
      const raw = localStorage.getItem('categoryCacheMinutes');
      if (raw) return parseInt(raw, 10) * 60 * 1000;
    } catch { /* ignore */ }
    return 60 * 60 * 1000; // 默认1小时
  };

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const fetchDoubanData = async () => {
      try {
        // 先检查模块级缓存（同一次 app 启动内有效）
        if (__categoryCache && Date.now() - __categoryCache.time < getCacheTTL()) {
          setHotMovies(__categoryCache.movies);
          setHotTvShows(__categoryCache.tv);
          setHotVarietyShows(__categoryCache.variety);
          setHotAnimation(__categoryCache.anime);
          setLoading(false);
          return;
        }

        setLoading(true);

        // 先请求 m.douban.com（tv）接口，它们不限流
        const [tvResult, varietyResult] = await Promise.allSettled([
          getDoubanCategories({ kind: 'tv', category: 'tv', type: 'tv' }),
          getDoubanCategories({ kind: 'tv', category: 'show', type: 'show' }),
        ]);

        // movie.douban.com 容易限流，串行请求并加延迟
        const moviesResult = await Promise.resolve(getDoubanCategories({ kind: 'movie', category: '热门', type: '全部' }));
        await new Promise(r => setTimeout(r, 300)); // 间隔 300ms 避免触发限流
        const animationResult = await Promise.resolve(getDoubanCategories({ kind: 'movie', category: '热门', type: '日本' }));

        // movies/animation 是直接返回值，tv/variety 是 PromiseSettledResult
        const movieOk = moviesResult.code === 200;
        const tvOk = tvResult.status === 'fulfilled' && tvResult.value.code === 200;
        const varietyOk = varietyResult.status === 'fulfilled' && varietyResult.value.code === 200;
        const animationOk = animationResult.code === 200;

        if (movieOk) setHotMovies(moviesResult.list);
        if (tvOk) setHotTvShows(tvResult.value.list);
        if (varietyOk) setHotVarietyShows(varietyResult.value.list);
        if (animationOk) setHotAnimation(animationResult.list);

        __categoryCache = {
          movies: movieOk ? moviesResult.list : [],
          tv: tvOk ? tvResult.value.list : [],
          variety: varietyOk ? varietyResult.value.list : [],
          anime: animationOk ? animationResult.list : [],
          time: Date.now(),
        };
      } catch (error) {
        console.error('获取豆瓣数据失败:', error);
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
        <h2 className='text-2xl font-bold text-gradient'>
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
          <div className='mb-10 sm:mb-14 fade-in-up'>
            <h1 className='text-4xl sm:text-5xl font-extrabold tracking-tight text-gradient'>
              MoonTV
            </h1>
            <p className='mt-2 text-base sm:text-lg text-gray-500 dark:text-gray-400'>
              发现精彩，随时观看
            </p>
          </div>

          {/* 搜索框 */}
          <div className='mb-10 sm:mb-14 fade-in-up fade-in-up-delay-1'>
            <form onSubmit={handleSearch} className='max-w-2xl'>
              <div className='relative group'>
                <Search className='absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500 transition-colors group-focus-within:text-green-500' />
                <input
                  type='text'
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder='搜索电影、电视剧...'
                  onClick={() => router.push('/search')}
                  className='w-full h-14 rounded-full bg-white dark:bg-[#1a1a2e]/80 py-3 pl-14 pr-12 text-base text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500/30 border border-gray-200 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20 transition-all duration-300 cursor-pointer hover:shadow-xl hover:border-green-500/20'
                  readOnly
                />
              </div>
            </form>
          </div>

          {/* 继续观看 */}
          <div className="fade-in-up fade-in-up-delay-2">
            <ContinueWatching />
          </div>

          {/* 热门电影 */}
          <div className="fade-in-up fade-in-up-delay-3">
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
          </div>

          {/* 热门剧集 */}
          <div className="fade-in-up fade-in-up-delay-4">
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
          </div>

          {/* 热门综艺 */}
          <div className="fade-in-up fade-in-up-delay-5">
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
          </div>

          {/* 热门动漫 */}
          <div className="fade-in-up fade-in-up-delay-6">
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
