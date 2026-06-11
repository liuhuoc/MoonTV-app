/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';

// 客户端收藏 API
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getDoubanCategories } from '@/lib/douban.client';
import { DoubanItem } from '@/lib/types';

import ContinueWatching from '@/components/ContinueWatching';
import PageLayout from '@/components/PageLayout';
import ScrollableRow from '@/components/ScrollableRow';
import VideoCard from '@/components/VideoCard';

function HomeClient() {
  const [hotMovies, setHotMovies] = useState<DoubanItem[]>([]);
  const [hotTvShows, setHotTvShows] = useState<DoubanItem[]>([]);
  const [hotVarietyShows, setHotVarietyShows] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 收藏夹数据
  type FavoriteItem = {
    id: string;
    source: string;
    title: string;
    poster: string;
    episodes: number;
    source_name: string;
    currentEpisode?: number;
    search_title?: string;
  };

  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);

  useEffect(() => {
    const fetchDoubanData = async () => {
      try {
        setLoading(true);

        // 并行获取热门电影、热门剧集和热门综艺
        const [moviesData, tvShowsData, varietyShowsData] = await Promise.all([
          getDoubanCategories({
            kind: 'movie',
            category: '热门',
            type: '全部',
          }),
          getDoubanCategories({ kind: 'tv', category: 'tv', type: 'tv' }),
          getDoubanCategories({ kind: 'tv', category: 'show', type: 'show' }),
        ]);

        if (moviesData.code === 200) {
          setHotMovies(moviesData.list);
        }

        if (tvShowsData.code === 200) {
          setHotTvShows(tvShowsData.list);
        }

        if (varietyShowsData.code === 200) {
          setHotVarietyShows(varietyShowsData.list);
        }
      } catch (error) {
        console.error('获取豆瓣数据失败:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDoubanData();
  }, []);

  // 处理收藏数据更新的函数
  const updateFavoriteItems = async (allFavorites: Record<string, any>) => {
    const allPlayRecords = await getAllPlayRecords();

    // 根据保存时间排序（从近到远）
    const sorted = Object.entries(allFavorites)
      .sort(([, a], [, b]) => b.save_time - a.save_time)
      .map(([key, fav]) => {
        const plusIndex = key.indexOf('+');
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);

        // 查找对应的播放记录，获取当前集数
        const playRecord = allPlayRecords[key];
        const currentEpisode = playRecord?.index;

        return {
          id,
          source,
          title: fav.title,
          year: fav.year,
          poster: fav.cover,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode,
          search_title: fav?.search_title,
        } as FavoriteItem;
      });
    setFavoriteItems(sorted);
  };

  // 加载收藏数据
  useEffect(() => {
    const loadFavorites = async () => {
      const allFavorites = await getAllFavorites();
      await updateFavoriteItems(allFavorites);
    };

    loadFavorites();

    // 监听收藏更新事件
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        updateFavoriteItems(newFavorites);
      }
    );

    return unsubscribe;
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

          {/* 收藏夹（底部独立区块，有收藏时显示） */}
          {favoriteItems.length > 0 && (
            <section className='mb-10 sm:mb-14'>
              <div className='mb-5 flex items-center justify-between'>
                <h2 className='text-2xl font-bold bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent'>
                  我的收藏
                </h2>
                <button
                  className='text-sm text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors'
                  onClick={async () => {
                    await clearAllFavorites();
                    setFavoriteItems([]);
                  }}
                >
                  清空
                </button>
              </div>
              <div className='justify-start grid grid-cols-3 gap-x-3 gap-y-16 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(12rem,_1fr))] sm:gap-x-8'>
                {favoriteItems.map((item) => (
                  <div key={item.id + item.source} className='w-full'>
                    <VideoCard
                      query={item.search_title}
                      {...item}
                      from='favorite'
                      type={item.episodes > 1 ? 'tv' : ''}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}
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
