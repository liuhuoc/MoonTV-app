'use client';

import { Clock, Heart, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

type TabType = 'history' | 'favorites';
type SubFilter = 'all' | 'movie' | 'tv' | 'show';

interface HistoryItem {
  id: string;
  source: string;
  title: string;
  poster: string;
  episodes: number;
  source_name: string;
  currentEpisode?: number;
  search_title?: string;
  year?: string;
  playTime?: number;
}

interface FavoriteItem {
  id: string;
  source: string;
  title: string;
  poster: string;
  episodes: number;
  source_name: string;
  year?: string;
  save_time?: number;
  search_title?: string;
}

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState<TabType>('history');
  const [subFilter, setSubFilter] = useState<SubFilter>('all');
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'history') {
        const records = await getAllPlayRecords();
        const sorted = Object.entries(records)
          .sort(([, a], [, b]) => (b.play_time || 0) - (a.play_time || 0))
          .map(([key, record]) => {
            const plusIndex = key.indexOf('+');
            const source = key.slice(0, plusIndex);
            const id = key.slice(plusIndex + 1);
            return {
              id,
              source,
              title: record.title,
              poster: record.cover,
              episodes: record.total_episodes || 1,
              source_name: record.source_name || '',
              currentEpisode: record.index,
              year: record.year,
              playTime: record.play_time,
              search_title: record.search_title,
            };
          });
        setHistoryItems(sorted);
      } else {
        const favorites = await getAllFavorites();
        const sorted = Object.entries(favorites)
          .sort(([, a], [, b]) => (b.save_time || 0) - (a.save_time || 0))
          .map(([key, fav]) => {
            const plusIndex = key.indexOf('+');
            const source = key.slice(0, plusIndex);
            const id = key.slice(plusIndex + 1);
            return {
              id,
              source,
              title: fav.title,
              poster: fav.cover,
              episodes: fav.total_episodes || 1,
              source_name: fav.source_name || '',
              year: fav.year,
              save_time: fav.save_time,
              search_title: fav.search_title,
            };
          });
        setFavoriteItems(sorted);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const unsub1 = subscribeToDataUpdates('playRecordsUpdated', () => {
      if (activeTab === 'history') loadData();
    });
    const unsub2 = subscribeToDataUpdates('favoritesUpdated', () => {
      if (activeTab === 'favorites') loadData();
    });
    return () => { unsub1(); unsub2(); };
  }, [activeTab, loadData]);

  const handleDelete = async (item: HistoryItem | FavoriteItem) => {
    if (activeTab === 'history') {
      await deletePlayRecord(item.source, item.id);
    } else {
      await deleteFavorite(item.source, item.id);
    }
    loadData();
  };

  const filterItems = <T extends { episodes?: number; title?: string }>(items: T[]): T[] => {
    if (subFilter === 'all') return items;
    if (subFilter === 'movie') return items.filter(i => (i.episodes || 1) <= 1);
    if (subFilter === 'tv') return items.filter(i => (i.episodes || 1) > 1 && !i.title?.includes('综艺'));
    if (subFilter === 'show') return items.filter(i => i.title?.includes('综艺'));
    return items;
  };

  const displayItems = activeTab === 'history'
    ? filterItems(historyItems)
    : filterItems(favoriteItems);

  const SkeletonCard = () => (
    <div className="w-full">
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-gray-200 dark:bg-gray-800" />
      <div className="mt-3 h-4 w-3/4 rounded-md bg-gray-200 dark:bg-gray-800" />
      <div className="mt-2 h-3 w-1/2 rounded-md bg-gray-200 dark:bg-gray-800" />
    </div>
  );

  const subFilters: { value: SubFilter; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'movie', label: '电影' },
    { value: 'tv', label: '剧集' },
    { value: 'show', label: '综艺' },
  ];

  return (
    <PageLayout activePath="/history">
      <div className="px-4 sm:px-10 py-4 sm:py-8">
        <div className="max-w-[95%] mx-auto">
          {/* 主 Tab */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => { setActiveTab('history'); setSubFilter('all'); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
                activeTab === 'history'
                  ? 'bg-indigo-500 text-white shadow-lg'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              <Clock size={16} />
              历史
            </button>
            <button
              onClick={() => { setActiveTab('favorites'); setSubFilter('all'); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
                activeTab === 'favorites'
                  ? 'bg-pink-500 text-white shadow-lg'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              <Heart size={16} />
              收藏
            </button>
          </div>

          {/* 子筛选 */}
          <div className="flex gap-2 mb-8">
            {subFilters.map(f => (
              <button
                key={f.value}
                onClick={() => setSubFilter(f.value)}
                className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                  subFilter === f.value
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* 内容 */}
          {loading ? (
            <div className="grid grid-cols-3 gap-x-3 gap-y-16 sm:gap-y-20 sm:grid-cols-[repeat(auto-fill,_minmax(12rem,_1fr))] sm:gap-x-8">
              {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : displayItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              {activeTab === 'history' ? <Clock size={48} className="mb-4 opacity-30" /> : <Heart size={48} className="mb-4 opacity-30" />}
              <p className="text-lg font-medium">
                {activeTab === 'history' ? '暂无播放记录' : '暂无收藏'}
              </p>
              <p className="text-sm mt-1 opacity-60">
                {activeTab === 'history' ? '观看过的内容会显示在这里' : '收藏的内容会显示在这里'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-x-3 gap-y-16 sm:gap-y-20 sm:grid-cols-[repeat(auto-fill,_minmax(12rem,_1fr))] sm:gap-x-8">
              {displayItems.map((item) => (
                <div key={item.id + item.source} className="relative group/item w-full">
                  <VideoCard
                    query={item.search_title}
                    {...item}
                    from={activeTab === 'history' ? 'playrecord' : 'favorite'}
                    type={item.episodes > 1 ? 'tv' : ''}
                  />
                  <button
                    onClick={() => handleDelete(item)}
                    className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-black/50 text-white opacity-0 group-hover/item:opacity-100 flex items-center justify-center hover:bg-red-500 transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}