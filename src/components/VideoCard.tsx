/* eslint-disable @typescript-eslint/no-explicit-any */

import { CheckCircle, Heart, Link, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  isFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { fetchImageAsDataUrl, processImageUrl } from '@/lib/utils';

import { ImagePlaceholder } from '@/components/ImagePlaceholder';

interface VideoCardProps {
  id?: string;
  source?: string;
  title?: string;
  query?: string;
  poster?: string;
  episodes?: number;
  source_name?: string;
  progress?: number;
  year?: string;
  from: 'playrecord' | 'favorite' | 'search' | 'douban';
  currentEpisode?: number;
  douban_id?: string;
  onDelete?: () => void;
  rate?: string;
  items?: SearchResult[];
  type?: string;
}

export default function VideoCard({
  id,
  title = '',
  query = '',
  poster = '',
  episodes,
  source,
  source_name,
  progress = 0,
  year,
  from,
  currentEpisode,
  douban_id,
  onDelete,
  rate,
  items,
  type = '',
}: VideoCardProps) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [capacitorImageUrl, setCapacitorImageUrl] = useState('');

  const isAggregate = from === 'search' && !!items?.length;

  const aggregateData = useMemo(() => {
    if (!isAggregate || !items) return null;
    const countMap = new Map<string | number, number>();
    const episodeCountMap = new Map<number, number>();
    items.forEach((item) => {
      if (item.douban_id && item.douban_id !== 0) {
        countMap.set(item.douban_id, (countMap.get(item.douban_id) || 0) + 1);
      }
      const len = item.episodes?.length || 0;
      if (len > 0) {
        episodeCountMap.set(len, (episodeCountMap.get(len) || 0) + 1);
      }
    });

    const getMostFrequent = <T extends string | number>(
      map: Map<T, number>
    ) => {
      let maxCount = 0;
      let result: T | undefined;
      map.forEach((cnt, key) => {
        if (cnt > maxCount) {
          maxCount = cnt;
          result = key;
        }
      });
      return result;
    };

    return {
      first: items[0],
      mostFrequentDoubanId: getMostFrequent(countMap),
      mostFrequentEpisodes: getMostFrequent(episodeCountMap) || 0,
    };
  }, [isAggregate, items]);

  const actualTitle = aggregateData?.first.title ?? title;
  const actualPoster = aggregateData?.first.poster ?? poster;

  // 切换海报时重置错误状态
  useEffect(() => {
    setHasError(false);
    setCapacitorImageUrl('');
  }, [poster]);

  const actualSource = aggregateData?.first.source ?? source;
  const actualId = aggregateData?.first.id ?? id;
  const actualDoubanIdRaw = aggregateData?.mostFrequentDoubanId ?? douban_id;
  const actualDoubanId =
    typeof actualDoubanIdRaw === 'number'
      ? String(actualDoubanIdRaw)
      : String(actualDoubanIdRaw || '');
  const hasDoubanId = /^\d+$/.test(actualDoubanId) && actualDoubanId !== '0';
  const actualEpisodes = aggregateData?.mostFrequentEpisodes ?? episodes;
  const actualYear = aggregateData?.first.year ?? year;
  const actualQuery = query || '';
  const actualSearchType = isAggregate
    ? aggregateData?.first.episodes?.length === 1
      ? 'movie'
      : 'tv'
    : type;

  // 获取收藏状态
  useEffect(() => {
    if (from === 'douban' || !actualSource || !actualId) return;

    const fetchFavoriteStatus = async () => {
      try {
        const fav = await isFavorited(actualSource, actualId);
        setFavorited(fav);
      } catch (err) {
        throw new Error('检查收藏状态失败');
      }
    };

    fetchFavoriteStatus();

    // 监听收藏状态更新事件
    const storageKey = generateStorageKey(actualSource, actualId);
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        // 检查当前项目是否在新的收藏列表中
        const isNowFavorited = !!newFavorites[storageKey];
        setFavorited(isNowFavorited);
      }
    );

    return unsubscribe;
  }, [from, actualSource, actualId]);

  // 豆瓣图片加载失败时通过 CapacitorHttp 重试（仅 doubanio.com 域名需要）
  useEffect(() => {
    if (!hasError || !actualPoster) return;
    // 只有 doubanio.com 的图片才需要 CapacitorHttp 回退（带 Referer 头绕过防盗链）
    if (!actualPoster.includes('doubanio.com')) return;
    let cancelled = false;
    (async () => {
      try {
        const dataUrl = await fetchImageAsDataUrl(processImageUrl(actualPoster));
        if (!cancelled) {
          setCapacitorImageUrl(dataUrl);
          setHasError(false);
          setIsLoading(true);
        }
      } catch {
        // 也失败了，保持 hasError=true 显示占位图
      }
    })();
    return () => { cancelled = true; };
  }, [hasError, actualPoster]);

  const handleToggleFavorite = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (from === 'douban' || !actualSource || !actualId) return;
      try {
        if (favorited) {
          // 如果已收藏，删除收藏
          await deleteFavorite(actualSource, actualId);
          setFavorited(false);
        } else {
          // 如果未收藏，添加收藏
          await saveFavorite(actualSource, actualId, {
            title: actualTitle,
            source_name: source_name || '',
            year: actualYear || '',
            cover: actualPoster,
            total_episodes: actualEpisodes ?? 1,
            save_time: Date.now(),
          });
          setFavorited(true);
        }
      } catch (err) {
        throw new Error('切换收藏状态失败');
      }
    },
    [
      from,
      actualSource,
      actualId,
      actualTitle,
      source_name,
      actualYear,
      actualPoster,
      actualEpisodes,
      favorited,
    ]
  );

  const handleDeleteRecord = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (from !== 'playrecord' || !actualSource || !actualId) return;
      try {
        await deletePlayRecord(actualSource, actualId);
        onDelete?.();
      } catch (err) {
        throw new Error('删除播放记录失败');
      }
    },
    [from, actualSource, actualId, onDelete]
  );

  const handleClick = useCallback(() => {
    if (from === 'douban') {
      router.push(
        `/play?title=${encodeURIComponent(actualTitle.trim())}${
          actualYear ? `&year=${actualYear}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}${
          hasDoubanId ? `&douban_id=${encodeURIComponent(actualDoubanId)}` : ''
        }`
      );
    } else if (actualSource && actualId) {
      router.push(
        `/play?source=${actualSource}&id=${actualId}&title=${encodeURIComponent(
          actualTitle
        )}${actualYear ? `&year=${actualYear}` : ''}${
          isAggregate ? '&prefer=true' : ''
        }${
          actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}`
      );
    }
  }, [
    from,
    actualSource,
    actualId,
    router,
    actualTitle,
    actualYear,
    isAggregate,
    actualQuery,
    actualSearchType,
    hasDoubanId,
    actualDoubanId,
  ]);

  const config = useMemo(() => {
    const configs = {
      playrecord: {
        showSourceName: true,
        showProgress: true,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: false,
        showDoubanLink: false,
        showRating: false,
      },
      favorite: {
        showSourceName: true,
        showProgress: false,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: false,
        showDoubanLink: false,
        showRating: false,
      },
      search: {
        showSourceName: true,
        showProgress: false,
        showPlayButton: true,
        showHeart: !isAggregate,
        showCheckCircle: false,
        showDoubanLink: hasDoubanId,
        showRating: false,
      },
      douban: {
        showSourceName: false,
        showProgress: false,
        showPlayButton: true,
        showHeart: false,
        showCheckCircle: false,
        showDoubanLink: true,
        showRating: !!rate,
      },
    };
    return configs[from] || configs.search;
  }, [from, isAggregate, hasDoubanId, rate]);

  return (
    <div
      className="group relative w-full cursor-pointer card-glow"
      onClick={handleClick}
    >
      {/* 海报容器 */}
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl shadow-sm transition-shadow duration-300 ease-out group-hover:shadow-xl">
        {/* 骨架屏 */}
        {!isLoading && <ImagePlaceholder aspectRatio="aspect-[2/3]" />}
        {/* 图片 */}
        {!hasError || capacitorImageUrl ? (
          <img
            src={capacitorImageUrl || processImageUrl(actualPoster)}
            alt={actualTitle}
            referrerPolicy="origin"
            crossOrigin="anonymous"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            onLoad={() => {
              console.log('[VideoCard] 图片加载成功:', processImageUrl(actualPoster).substring(0, 80));
              setIsLoading(true);
            }}
            onError={() => {
              console.error('[VideoCard] 图片加载失败:', processImageUrl(actualPoster).substring(0, 80), 'title:', actualTitle?.substring(0, 20));
              setHasError(true);
              setIsLoading(true);
            }}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-800">
            <svg className="w-10 h-10 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" />
            </svg>
            <span className="text-xs text-gray-500 dark:text-gray-400 px-2 text-center truncate max-w-full">
              {actualTitle?.slice(0, 6)}
            </span>
          </div>
        )}

        {/* 暗化 overlay */}
        <div className="absolute inset-0 bg-black/0 transition-colors duration-300 ease-out group-hover:bg-black/30" />

        {/* 播放按钮 */}
        {config.showPlayButton && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/90 text-gray-900 shadow-lg backdrop-blur-sm transition-transform duration-300 ease-out group-hover:scale-100 scale-90">
              <Play size={18} fill="currentColor" />
            </div>
          </div>
        )}

        {/* 收藏 / 删除按钮 */}
        <div className="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-0 translate-y-1 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-y-0">
          {config.showCheckCircle && (
            <button
              onClick={handleDeleteRecord}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors duration-200 hover:bg-red-500/80"
            >
              <CheckCircle size={14} />
            </button>
          )}
          {config.showHeart && (
            <button
              onClick={handleToggleFavorite}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors duration-200 hover:bg-red-500/80"
            >
              <Heart
                size={14}
                className={
                  favorited ? 'fill-red-400 text-red-400' : 'fill-transparent'
                }
              />
            </button>
          )}
        </div>

        {/* 徽章：评分 */}
        {config.showRating && rate && (
          <div className="absolute top-2 left-2 bg-pink-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
            {rate}
          </div>
        )}

        {/* 徽章：集数 */}
        {actualEpisodes && actualEpisodes > 1 && (
          <div className="absolute top-2 left-2 bg-green-500 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full shadow-sm">
            {currentEpisode
              ? `${currentEpisode}/${actualEpisodes}`
              : actualEpisodes}
          </div>
        )}

        {/* 豆瓣链接 */}
        {config.showDoubanLink && actualDoubanId && (
          <a
            href={`https://movie.douban.com/subject/${actualDoubanId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute top-2 left-2 opacity-0 -translate-x-1 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-x-0"
          >
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-green-500 text-white text-[10px] font-bold shadow-sm hover:bg-green-600 transition-colors duration-200">
              <Link size={14} />
            </div>
          </a>
        )}
      </div>

      {/* 进度条 */}
      {config.showProgress && progress !== undefined && (
        <div className="mt-1.5 h-0.5 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-green-400 to-green-600 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* 标题与来源 */}
      <div className="mt-2 px-0.5">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate leading-snug">
          {actualTitle}
        </p>
        {config.showSourceName && source_name && (
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 truncate leading-snug">
            {source_name}
          </p>
        )}
      </div>
    </div>
  );
}
