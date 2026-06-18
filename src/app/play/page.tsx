/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import { ScreenOrientation } from '@capacitor/screen-orientation';
import { StatusBar } from '@capacitor/status-bar';
import { Directory, Filesystem } from '@capacitor/filesystem';
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import {
  browserReadSegment,
  browserReadPlaylist,
} from '@/lib/storage';
import { Heart, Download } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  isFavorited,
  saveFavorite,
  savePlayRecord,
  saveSkipConfig,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { fetchVideoDetail, downstreamSearchFast } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';
import { addDownloadTask, getDownloadTasks, startDownload, subscribeToDownloadUpdates, type DownloadTask } from '@/lib/download';
import Swal from 'sweetalert2';

import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';

// 扩展 HTMLVideoElement 类型以支持 hls 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

function PlayPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // -----------------------------------------------------------------------------
  // 状态变量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  // 收藏状态
  const [favorited, setFavorited] = useState(false);

  // 跳过片头片尾配置
  const [skipConfig, setSkipConfig] = useState<{
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [
    skipConfig,
    skipConfig.enable,
    skipConfig.intro_time,
    skipConfig.outro_time,
  ]);

  // 去广告开关（从 localStorage 继承，默认 true）
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  // 视频基本信息
  const [videoTitle, setVideoTitle] = useState(searchParams?.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams?.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  // 当前源和ID
  const [currentSource, setCurrentSource] = useState(
    searchParams?.get('source') || ''
  );
  const [currentId, setCurrentId] = useState(searchParams?.get('id') || '');

  // 搜索所需信息
  const [searchTitle] = useState(searchParams?.get('stitle') || '');
  const [searchType] = useState(searchParams?.get('stype') || '');
  const [doubanId] = useState(searchParams?.get('douban_id') || '');

  // 是否需要优选
  const [needPrefer, setNeedPrefer] = useState(
    searchParams?.get('prefer') === 'true'
  );
  const needPreferRef = useRef(needPrefer);
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);
  // 集数相关
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(0);

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);
  const hasInitializedRef = useRef(false);

  // 下载任务追踪（用于判断是否已下载）
  const [downloadTasks, setDownloadTasks] = useState<DownloadTask[]>([]);
  useEffect(() => {
    setDownloadTasks(getDownloadTasks());
    const unsub = subscribeToDownloadUpdates(setDownloadTasks);
    return unsub;
  }, []);

  // 同步最新值到 refs
  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
  ]);

  // 视频播放地址
  const [videoUrl, setVideoUrl] = useState('');
  const [isLocalPlayback, setIsLocalPlayback] = useState(false);

  // 总集数
  const totalEpisodes = detail?.episodes?.length || 0;

  // 用于记录是否需要在播放器 ready 后跳转到指定进度
  const resumeTimeRef = useRef<number | null>(null);
  // 上次使用的音量，默认 0.7
  const lastVolumeRef = useRef<number>(0.7);

  // 换源相关状态
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null
  );

  // 优选和测速开关
  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  // 保存优选时的测速结果，避免EpisodeSelector重复测速
  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, { quality: string; loadSpeed: string; pingTime: number }>
  >(new Map());

  // 折叠状态（仅在 lg 及以上屏幕有效）
  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  // 换源加载状态
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');

  // 下载选集弹窗
  const [showDownloadSelector, setShowDownloadSelector] = useState(false);
  const [downloadSelections, setDownloadSelections] = useState<Set<number>>(new Set());

  const downloadedEpisodes = useMemo(() => {
    const d = detail;
    if (!d || !d.episodes) return new Set<number>();
    const title = videoTitle || d.title || '';
    const downloaded = new Set<number>();
    d.episodes.forEach((url, i) => {
      const label = d.episodes.length > 1 ? `第${i + 1}集` : '完整版';
      const exists = downloadTasks.find(t =>
        t.url === url &&
        t.episodeLabel === label &&
        t.title === title
      );
      if (exists) downloaded.add(i);
    });
    return downloaded;
  }, [detail, downloadTasks, videoTitle]);

  // 播放进度保存相关
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

  // 播放源优选函数
  const preferBestSource = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    if (sources.length === 1) return sources[0];

    // 将播放源均分为两批，并发测速各批，避免一次性过多请求
    const batchSize = Math.ceil(sources.length / 2);
    const allResults: Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    } | null> = [];

    for (let start = 0; start < sources.length; start += batchSize) {
      const batchSources = sources.slice(start, start + batchSize);
      const batchResults = await Promise.all(
        batchSources.map(async (source) => {
          try {
            // 检查是否有第一集的播放地址
            if (!source.episodes || source.episodes.length === 0) {
              console.warn(`播放源 ${source.source_name} 没有可用的播放地址`);
              return null;
            }

            const episodeUrl =
              source.episodes.length > 1
                ? source.episodes[1]
                : source.episodes[0];
            const testResult = await getVideoResolutionFromM3u8(episodeUrl);

            return {
              source,
              testResult,
            };
          } catch (error) {
            return null;
          }
        })
      );
      allResults.push(...batchResults);
    }

    // 等待所有测速完成，包含成功和失败的结果
    // 保存所有测速结果到 precomputedVideoInfo，供 EpisodeSelector 使用（包含错误结果）
    const newVideoInfoMap = new Map<
      string,
      {
        quality: string;
        loadSpeed: string;
        pingTime: number;
        hasError?: boolean;
      }
    >();
    allResults.forEach((result, index) => {
      const source = sources[index];
      const sourceKey = `${source.source}-${source.id}`;

      if (result) {
        // 成功的结果
        newVideoInfoMap.set(sourceKey, result.testResult);
      }
    });

    // 过滤出成功的结果用于优选计算
    const successfulResults = allResults.filter(Boolean) as Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    }>;

    setPrecomputedVideoInfo(newVideoInfoMap);

    if (successfulResults.length === 0) {
      console.warn('所有播放源测速都失败，使用第一个播放源');
      return sources[0];
    }

    // 找出所有有效速度的最大值，用于线性映射
    const validSpeeds = successfulResults
      .map((result) => {
        const speedStr = result.testResult.loadSpeed;
        if (speedStr === '未知' || speedStr === '测量中...') return 0;

        const match = speedStr.match(/^(\d[\d.]+)\s*(KB\/s|MB\/s)$/);
        if (!match) return 0;

        const value = parseFloat(match[1]);
        const unit = match[2];
        return unit === 'MB/s' ? value * 1024 : value; // 统一转换为 KB/s
      })
      .filter((speed) => speed > 0);

    const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024; // 默认1MB/s作为基准

    // 找出所有有效延迟的最小值和最大值，用于线性映射
    const validPings = successfulResults
      .map((result) => result.testResult.pingTime)
      .filter((ping) => ping > 0);

    const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
    const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

    // 计算每个结果的评分
    const resultsWithScore = successfulResults.map((result) => ({
      ...result,
      score: calculateSourceScore(
        result.testResult,
        maxSpeed,
        minPing,
        maxPing
      ),
    }));

    // 按综合评分排序，选择最佳播放源
    resultsWithScore.sort((a, b) => b.score - a.score);

    console.log('播放源评分排序结果:');
    resultsWithScore.forEach((result, index) => {
      console.log(
        `${index + 1}. ${
          result.source.source_name
        } - 评分: ${result.score.toFixed(2)} (${result.testResult.quality}, ${
          result.testResult.loadSpeed
        }, ${result.testResult.pingTime}ms)`
      );
    });

    return resultsWithScore[0].source;
  };

  // 计算播放源综合评分
  const calculateSourceScore = (
    testResult: {
      quality: string;
      loadSpeed: string;
      pingTime: number;
    },
    maxSpeed: number,
    minPing: number,
    maxPing: number
  ): number => {
    let score = 0;

    // 分辨率评分 (40% 权重)
    const qualityScore = (() => {
      switch (testResult.quality) {
        case '4K':
          return 100;
        case '2K':
          return 85;
        case '1080p':
          return 75;
        case '720p':
          return 60;
        case '480p':
          return 40;
        case 'SD':
          return 20;
        default:
          return 0;
      }
    })();
    score += qualityScore * 0.4;

    // 下载速度评分 (40% 权重) - 基于最大速度线性映射
    const speedScore = (() => {
      const speedStr = testResult.loadSpeed;
      if (speedStr === '未知' || speedStr === '测量中...') return 30;

      // 解析速度值
      const match = speedStr.match(/^(\d[\d.]+)\s*(KB\/s|MB\/s)$/);
      if (!match) return 30;

      const value = parseFloat(match[1]);
      const unit = match[2];
      const speedKBps = unit === 'MB/s' ? value * 1024 : value;

      // 基于最大速度线性映射，最高100分
      const speedRatio = speedKBps / maxSpeed;
      return Math.min(100, Math.max(0, speedRatio * 100));
    })();
    score += speedScore * 0.4;

    // 网络延迟评分 (20% 权重) - 基于延迟范围线性映射
    const pingScore = (() => {
      const ping = testResult.pingTime;
      if (ping <= 0) return 0; // 无效延迟给默认分

      // 如果所有延迟都相同，给满分
      if (maxPing === minPing) return 100;

      // 线性映射：最低延迟=100分，最高延迟=0分
      const pingRatio = (maxPing - ping) / (maxPing - minPing);
      return Math.min(100, Math.max(0, pingRatio * 100));
    })();
    score += pingScore * 0.2;

    return Math.round(score * 100) / 100; // 保留两位小数
  };

  // 更新视频地址
  const updateVideoUrl = (
    detailData: SearchResult | null,
    episodeIndex: number
  ) => {
    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex >= detailData.episodes.length
    ) {
      setVideoUrl('');
      return;
    }
    const newUrl = detailData?.episodes[episodeIndex] || '';
    if (newUrl !== videoUrl) {
      setVideoUrl(newUrl);
    }
  };

  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      // 移除旧的 source，保持唯一
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    // 始终允许远程播放（AirPlay / Cast）
    video.disableRemotePlayback = false;
    // 如果曾经有禁用属性，移除之
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  // 去广告相关函数
  function filterAdsFromM3U8(m3u8Content: string): string {
    if (!m3u8Content) return '';

    // 按行分割M3U8内容
    const lines = m3u8Content.split('\n');
    const filteredLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 只过滤#EXT-X-DISCONTINUITY标识
      if (!line.includes('#EXT-X-DISCONTINUITY')) {
        filteredLines.push(line);
      }
    }

    return filteredLines.join('\n');
  }

  // 跳过片头片尾配置相关函数
  const handleSkipConfigChange = async (newConfig: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;

    try {
      await saveSkipConfig(
        currentSourceRef.current,
        currentIdRef.current,
        newConfig
      );
      setSkipConfig(newConfig);
      console.log('跳过片头片尾配置已保存:', newConfig);
    } catch (err) {
      console.error('保存跳过片头片尾配置失败:', err);
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds === 0) return '0秒';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    if (minutes === 0) {
      return `${remainingSeconds}秒`;
    }
    return `${minutes}分${remainingSeconds.toString().padStart(2, '0')}秒`;
  };

  // 本地播放上下文，由 playLocalVideo 函数设置
type LocalPlaybackCtx =
  | { platform: 'capacitor'; dirPath: string; writeDirEnum: Directory }
  | { platform: 'browser'; taskId: string };
let localPlaybackCtx: LocalPlaybackCtx | null = null;

// 创建本地分段 Loader：拦截 local://segment/N URL，从磁盘读取文件
function createLocalSegmentLoader() {
  class LocalSegmentLoader {
    private aborted = false;
    context: any = null;
    stats: any = { aborted: false, loaded: 0, total: 0, retry: 0, chunkCount: 0, bwEstimate: 0,
      loading: { start: 0, first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 } };

    // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
    constructor(_config: any) {
      this.context = null;
      console.log('[LocalLoader] 实例化');
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    destroy() {}
    abort() {
      this.aborted = true;
    }

    load(context: any, _config: any, callbacks: any) {
      const url: string = context.url || '';
      console.log(`[LocalLoader] load() url=${url}`);

      if (url.startsWith('local://segment/')) {
        // 延迟检查上下文（在 load() 调用时读取，避免闭包时序问题）
        const ctx = localPlaybackCtx;
        if (!ctx) {
          console.error('[LocalLoader] localPlaybackCtx 未设置');
          callbacks.onError({ code: 500, text: '本地播放上下文未设置' }, context, null);
          return;
        }

        const segIdx = url.replace('local://segment/', '');
        const segNum = parseInt(segIdx, 10);

        // 浏览器端：从 IndexedDB 读取
        if (ctx.platform === 'browser') {
          const segIndex = segNum + 1; // IndexedDB key 是 1-based
          console.log(`[LocalLoader] 读浏览器片段: ${segNum} (key=${segIndex})`);
          browserReadSegment(ctx.taskId, segIndex)
            .then((buf: ArrayBuffer) => {
              console.log(`[LocalLoader] 片段 ${segNum} 读取成功: ${buf.byteLength} bytes`);
              const stats = {
                aborted: false, loaded: buf.byteLength, total: buf.byteLength, retry: 0, chunkCount: 1,
                bwEstimate: 0, loading: { start: performance.now(), first: performance.now(), end: performance.now() },
                parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 },
                ...(context.stats || {}),
              };
              callbacks.onSuccess({ url, data: buf }, stats, context, null);
            })
            .catch((err: any) => {
              console.error(`[LocalLoader] 浏览器片段 ${segNum} 读取失败: ${(err as Error).message || JSON.stringify(err)}`);
              callbacks.onError({ code: 404, text: (err as Error).message || '读取失败' }, context, null);
            });
          return;
        }

        // Capacitor 端：从 Filesystem 读取
        const segFileName = `seg_${String(segNum).padStart(5, '0')}.ts`;
        const segPath = `${ctx.dirPath}/${segFileName}`;
        console.log(`[LocalLoader] 读片段: ${segFileName} (path=${segPath})`);

        Filesystem.readFile({ path: segPath, directory: ctx.writeDirEnum as any })
          .then((result: any) => {
            const base64 = result.data as string;
            const bytes = atob(base64);
            const arr = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
            console.log(`[LocalLoader] 片段 ${segNum} 读取成功: ${arr.length} bytes`);
            const stats = {
              aborted: false, loaded: arr.length, total: arr.length, retry: 0, chunkCount: 1,
              bwEstimate: 0, loading: { start: performance.now(), first: performance.now(), end: performance.now() },
              parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 },
              ...(context.stats || {}),
            };
            callbacks.onSuccess({ url, data: arr.buffer }, stats, context, null);
          })
          .catch((err: any) => {
            console.error(`[LocalLoader] 片段 ${segNum} 读取失败: ${(err as Error).message || JSON.stringify(err)}`);
            callbacks.onError({ code: 404, text: (err as Error).message || '读取失败' }, context, null);
          });
      } else if (url.startsWith('data:')) {
        // data: URI（Android WebView 中用 data: 替代 blob URL）直接解码
        const base64Content = url.replace(/^data:[^;]*;base64,/, '');
        const text = atob(base64Content);
        console.log(`[LocalLoader] data: URI 解码成功: ${text.length} chars`);
        const stats = {
          aborted: false, loaded: text.length, total: text.length, retry: 0, chunkCount: 1,
          bwEstimate: 0, loading: { start: performance.now(), first: performance.now(), end: performance.now() },
          parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 },
          ...(context.stats || {}),
        };
        callbacks.onSuccess({ url, data: text }, stats, context, null);
      } else {
        // 非 local:// 且非 data: 的 URL，使用 fetch 加载
        console.log(`[LocalLoader] fetch: ${url.substring(0, 80)}...`);
        fetch(url, { headers: context.headers as Record<string, string> | undefined } as any)
          .then((resp: any) => {
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            console.log(`[LocalLoader] fetch 成功: ${resp.status}, 开始读body`);
            return resp.arrayBuffer();
          })
          .then((data: ArrayBuffer) => {
            console.log(`[LocalLoader] fetch body: ${data.byteLength} bytes`);
            const stats = {
              aborted: false, loaded: data.byteLength, total: data.byteLength, retry: 0, chunkCount: 1,
              bwEstimate: 0, loading: { start: performance.now(), first: performance.now(), end: performance.now() },
              parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 },
              ...(context.stats || {}),
            };
            callbacks.onSuccess({ url, data }, stats, context, null);
          })
          .catch((err: any) => {
            console.error(`[LocalLoader] fetch 失败: ${(err as Error).message || JSON.stringify(err)}`);
            callbacks.onError({ code: 0, text: (err as Error).message || 'fetch失败' }, context, null);
          });
      }
    }
  }

  return LocalSegmentLoader;
}

class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this);
      this.load = function (context: any, config: any, callbacks: any) {
        // 拦截manifest和level请求
        if (
          (context as any).type === 'manifest' ||
          (context as any).type === 'level'
        ) {
          const onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function (
            response: any,
            stats: any,
            context: any
          ) {
            // 如果是m3u8文件，处理内容以移除广告分段
            if (response.data && typeof response.data === 'string') {
              // 过滤掉广告段 - 实现更精确的广告过滤逻辑
              response.data = filterAdsFromM3U8(response.data);
            }
            return onSuccess(response, stats, context, null);
          };
        }
        // 执行原始load方法
        load(context, config, callbacks);
      };
    }
  }

  // 当集数索引变化时自动更新视频地址
  useEffect(() => {
    updateVideoUrl(detail, currentEpisodeIndex);
  }, [detail, currentEpisodeIndex]);

  // 进入页面时直接获取全部源信息
  useEffect(() => {
    const normalizeTitleForMatch = (value: string) => {
      return value
        .replace(
          /[\s\u3000·•:：，,。.!！？?（）()《》「」【】\-_—]/g,
          ''
        )
        .toLowerCase();
    };

    const fetchSourceDetail = async (
      source: string,
      id: string
    ): Promise<SearchResult[]> => {
      try {
        const titleParam = (
          videoTitleRef.current ||
          searchTitle ||
          videoTitle ||
          ''
        ).trim();
        const detailData = await fetchVideoDetail({ source, id, fallbackTitle: titleParam });
        setAvailableSources([detailData]);
        return [detailData];
      } catch (err) {
        console.error('获取视频详情失败:', err);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };
    const fetchSourcesData = async (query: string): Promise<SearchResult[]> => {
      // 根据搜索词获取全部源信息
      try {
        const trimmedQuery = query.trim();
        const [fastResults, getRemaining] = await downstreamSearchFast(trimmedQuery, 6);
        const normalizedDoubanId = doubanId.trim();

        // 后台继续加载剩余源
        getRemaining().then((remainingResults) => {
          setAvailableSources((prev) => {
            const allResults = filterAndMergeResults(
              [...prev, ...remainingResults],
              normalizedDoubanId,
              trimmedQuery
            );
            return allResults;
          });
        }).catch((err) => { console.warn('后台源加载失败:', err); });

        // 先使用快速结果
        const allResults = filterAndMergeResults(
          fastResults,
          normalizedDoubanId,
          trimmedQuery
        );
        setAvailableSources(allResults);
        return allResults;
      } catch (err) {
        setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
        setAvailableSources([]);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    const filterAndMergeResults = (
      allResults: SearchResult[],
      normalizedDoubanId: string,
      trimmedQuery: string
    ): SearchResult[] => {
      if (normalizedDoubanId) {
        const doubanMatched = allResults.filter(
          (result) =>
            result.douban_id && String(result.douban_id) === normalizedDoubanId
        );
        if (doubanMatched.length > 0) {
          return doubanMatched;
        }
      }

      const isNumericQuery = /^\d+$/.test(trimmedQuery);
      if (isNumericQuery && normalizedDoubanId) {
        return allResults;
      }

      const expectedTitle = normalizeTitleForMatch(videoTitleRef.current);
      const queryTitle = normalizeTitleForMatch(trimmedQuery);

      const typeMatches = (result: SearchResult) => {
        if (!searchType) return true;
        if (searchType === 'tv') return result.episodes.length > 1;
        if (searchType === 'movie') return result.episodes.length === 1;
        return true;
      };

      const yearMatches = (result: SearchResult) => {
        if (!videoYearRef.current) return true;
        const y = (result.year || '').toLowerCase();
        const expected = videoYearRef.current.toLowerCase();
        if (!y || y === 'unknown') return true;
        if (!expected || expected === 'unknown') return true;
        return y === expected;
      };

      const titleMatches = (result: SearchResult) => {
        const t = normalizeTitleForMatch(result.title || '');
        if (!t) return false;
        if (expectedTitle) {
          return t === expectedTitle || t.includes(expectedTitle) || expectedTitle.includes(t);
        }
        return queryTitle ? t.includes(queryTitle) || queryTitle.includes(t) : true;
      };

      let results = allResults.filter(
        (result) => titleMatches(result) && yearMatches(result) && typeMatches(result)
      );

      if (results.length === 0) {
        results = allResults.filter(
          (result) => titleMatches(result) && typeMatches(result)
        );
      }

      if (results.length === 0 && allResults.length > 0) {
        results = allResults;
      }

      return results;
    };

    const initAll = async () => {
      // 防止重复初始化（侧滑返回时不再重新搜索）
      if (hasInitializedRef.current) return;
      hasInitializedRef.current = true;

      // 本地文件播放：用 HLS.js + 自定义 Loader 从磁盘读取 TS 分段
      if (currentSource === 'local') {
        const dlTasks = getDownloadTasks();
        const dlTask = dlTasks.find(t => t.id === currentId);
        if (!dlTask?.localPath) {
          setError('已下载文件信息不完整，请重新下载');
          setLoading(false);
          return;
        }

        setVideoTitle(dlTask.title || '');
        setVideoCover(dlTask.poster || '');
        setIsLocalPlayback(true);
        setDetail({
          id: dlTask.id,
          title: dlTask.title,
          source: 'local',
          source_name: '本地文件',
          episodes: [dlTask.localPath],
          douban_id: 0,
        } as any);

        try {
          setLoadingMessage('正在加载本地视频...');

          // 浏览器端：从 IndexedDB 读取
          if (dlTask.writeDirectory === 'IndexedDB') {
            localPlaybackCtx = { platform: 'browser', taskId: currentId || dlTask.id };
            const playlistContent = await browserReadPlaylist(currentId || dlTask.id);
            console.log(
              `本地播放诊断:\n  M3U8内容前200字符:\n${playlistContent.substring(0, 200)}`
            );
            // 浏览器端可以直接用 data: URI，不会像 Android WebView 那样有问题
            const dataUri = 'data:application/vnd.apple.mpegurl;base64,' + btoa(playlistContent);
            console.log(`[本地播放] data URI 长度: ${dataUri.length}`);
            setVideoUrl(dataUri);
            setLoading(false);
            return;
          }

          // Capacitor 端：从 Filesystem 读取
          if (!dlTask.writeDirectory) {
            setError('已下载文件信息不完整，请重新下载');
            setLoading(false);
            return;
          }
          const writeDirEnum = dlTask.writeDirectory === 'Library' ? Directory.Library : Directory.Data;
          const dirPath = dlTask.localPath.replace(/\/playlist\.m3u8$/, '');
          localPlaybackCtx = { platform: 'capacitor', dirPath, writeDirEnum };

          // 读取 M3U8 播放列表
          const result = await Filesystem.readFile({ path: dlTask.localPath, directory: writeDirEnum });
          let playlistContent: string;
          try {
            playlistContent = atob(result.data as string);
          } catch {
            // 非 base64（旧格式兼容）
            playlistContent = result.data as string;
          }

          console.log(
            `本地播放诊断:\n  M3U8内容前200字符:\n${playlistContent.substring(0, 200)}`
          );

          // 创建 data URI 给 HLS.js（Android WebView 中 blob URL 无法被 fetch）
          const dataUri = 'data:application/vnd.apple.mpegurl;base64,' + btoa(playlistContent);
          console.log(`[本地播放] data URI 长度: ${dataUri.length}`);
          setVideoUrl(dataUri);
          setLoading(false);
        } catch (e) {
          setError(`读取本地视频失败: ${(e as Error).message}`);
          setLoading(false);
        }
        return;
      }

      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缺少必要参数');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');
      setLoadingMessage(
        currentSource && currentId
          ? '🎬 正在获取视频详情...'
          : '🔍 正在搜索播放源...'
      );

      let sourcesInfo = await fetchSourcesData(searchTitle || videoTitle);
      if (sourcesInfo.length === 0 && doubanId.trim()) {
        setLoadingStage('searching');
        setLoadingMessage('🔍 正在用豆瓣ID补充搜索播放源...');
        sourcesInfo = await fetchSourcesData(doubanId);
      }
      if (
        currentSource &&
        currentId &&
        !sourcesInfo.some(
          (source) => source.source === currentSource && source.id === currentId
        )
      ) {
        sourcesInfo = await fetchSourceDetail(currentSource, currentId);
      }
      if (sourcesInfo.length === 0) {
        setError('未找到匹配结果');
        setLoading(false);
        return;
      }

      let detailData: SearchResult = sourcesInfo[0];
      // 指定源和id且无需优选
      if (currentSource && currentId && !needPreferRef.current) {
        const target = sourcesInfo.find(
          (source) => source.source === currentSource && source.id === currentId
        );
        if (target) {
          detailData = target;
        } else {
          setError('未找到匹配结果');
          setLoading(false);
          return;
        }
      }

      // 未指定源和 id 或需要优选，且开启优选开关
      if (
        (!currentSource || !currentId || needPreferRef.current) &&
        optimizationEnabled
      ) {
        setLoadingStage('preferring');
        setLoadingMessage('⚡ 正在优选最佳播放源...');

        detailData = await preferBestSource(sourcesInfo);
      }

      console.log(detailData.source, detailData.id);

      setNeedPrefer(false);
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      setDetail(detailData);
      if (currentEpisodeIndex >= detailData.episodes.length) {
        setCurrentEpisodeIndex(0);
      }

      // 规范URL参数
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', detailData.year);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.delete('prefer');
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('✨ 准备就绪，即将开始播放...');

      // 短暂延迟让用户看到完成状态
      setTimeout(() => {
        setLoading(false);
      }, 1000);
    };

    initAll();
  }, []);

  // 播放记录处理
  useEffect(() => {
    // 仅在初次挂载时检查播放记录
    const initFromHistory = async () => {
      if (!currentSource || !currentId) return;

      try {
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(currentSource, currentId);
        const record = allRecords[key];

        if (record) {
          const targetIndex = record.index - 1;
          const targetTime = record.play_time;

          // 更新当前选集索引
          if (targetIndex !== currentEpisodeIndex) {
            setCurrentEpisodeIndex(targetIndex);
          }

          // 保存待恢复的播放进度，待播放器就绪后跳转
          resumeTimeRef.current = targetTime;
        }
      } catch (err) {
        console.error('读取播放记录失败:', err);
      }
    };

    initFromHistory();
  }, []);

  // 跳过片头片尾配置处理
  useEffect(() => {
    // 仅在初次挂载时检查跳过片头片尾配置
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;

      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (config) {
          setSkipConfig(config);
        }
      } catch (err) {
        console.error('读取跳过片头片尾配置失败:', err);
      }
    };

    initSkipConfig();
  }, []);

  // 处理换源
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string
  ) => {
    try {
      // 显示换源加载状态
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);

      // 记录当前播放进度（仅在同一集数切换时恢复）
      const currentPlayTime = artPlayerRef.current?.currentTime || 0;
      console.log('换源前当前播放时间:', currentPlayTime);

      // 清除前一个历史记录
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deletePlayRecord(
            currentSourceRef.current,
            currentIdRef.current
          );
          console.log('已清除前一个播放记录');
        } catch (err) {
          console.error('清除播放记录失败:', err);
        }
      }

      // 清除并设置下一个跳过片头片尾配置
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deleteSkipConfig(
            currentSourceRef.current,
            currentIdRef.current
          );
          await saveSkipConfig(newSource, newId, skipConfigRef.current);
        } catch (err) {
          console.error('清除跳过片头片尾配置失败:', err);
        }
      }

      const newDetail = availableSources.find(
        (source) => source.source === newSource && source.id === newId
      );
      if (!newDetail) {
        setError('未找到匹配结果');
        return;
      }

      // 尝试跳转到当前正在播放的集数
      let targetIndex = currentEpisodeIndex;

      // 如果当前集数超出新源的范围，则跳转到第一集
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
      }

      // 如果仍然是同一集数且播放进度有效，则在播放器就绪后恢复到原始进度
      if (targetIndex !== currentEpisodeIndex) {
        resumeTimeRef.current = 0;
      } else if (
        (!resumeTimeRef.current || resumeTimeRef.current === 0) &&
        currentPlayTime > 1
      ) {
        resumeTimeRef.current = currentPlayTime;
      }

      // 更新URL参数（不刷新页面）
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newSource);
      newUrl.searchParams.set('id', newId);
      newUrl.searchParams.set('year', newDetail.year);
      window.history.replaceState({}, '', newUrl.toString());

      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);
    } catch (err) {
      // 隐藏换源加载状态
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 集数切换
  // ---------------------------------------------------------------------------
  // 处理集数切换
  const handleEpisodeChange = (episodeNumber: number) => {
    if (episodeNumber >= 0 && episodeNumber < totalEpisodes) {
      // 在更换集数前保存当前播放进度
      if (artPlayerRef.current && artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(episodeNumber);
    }
  };

  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(idx - 1);
    }
  };

  const handleNextEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx < d.episodes.length - 1) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(idx + 1);
    }
  };

  // ---------------------------------------------------------------------------
  // 键盘快捷键
  // ---------------------------------------------------------------------------
  // 处理全局快捷键
  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    // 忽略输入框中的按键事件
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      const idx = currentEpisodeIndexRef.current;
      if (d && idx < d.episodes.length - 1) {
        handleNextEpisode();
        e.preventDefault();
      }
    }

    // 左箭头 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }

    // 右箭头 = 快进
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }

    // 上箭头 = 音量+
    if (e.key === 'ArrowUp') {
      if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 下箭头 = 音量-
    if (e.key === 'ArrowDown') {
      if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 空格 = 播放/暂停
    if (e.key === ' ') {
      if (artPlayerRef.current) {
        artPlayerRef.current.toggle();
        e.preventDefault();
      }
    }

    // f 键 = 切换全屏
    if (e.key === 'f' || e.key === 'F') {
      if (artPlayerRef.current) {
        artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        e.preventDefault();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 播放记录相关
  // ---------------------------------------------------------------------------
  // 保存播放进度
  const saveCurrentPlayProgress = async () => {
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    ) {
      return;
    }

    const player = artPlayerRef.current;
    const currentTime = player.currentTime || 0;
    const duration = player.duration || 0;

    // 如果播放时间太短（少于5秒）或者视频时长无效，不保存
    if (currentTime < 1 || !duration) {
      return;
    }

    try {
      await savePlayRecord(currentSourceRef.current, currentIdRef.current, {
        title: videoTitleRef.current,
        source_name: detailRef.current?.source_name || '',
        year: detailRef.current?.year,
        cover: detailRef.current?.poster || '',
        index: currentEpisodeIndexRef.current + 1, // 转换为1基索引
        total_episodes: detailRef.current?.episodes.length || 1,
        play_time: Math.floor(currentTime),
        total_time: Math.floor(duration),
        save_time: Date.now(),
        search_title: searchTitle,
      });

      lastSaveTimeRef.current = Date.now();
      console.log('播放进度已保存:', {
        title: videoTitleRef.current,
        episode: currentEpisodeIndexRef.current + 1,
        year: detailRef.current?.year,
        progress: `${Math.floor(currentTime)}/${Math.floor(duration)}`,
      });
    } catch (err) {
      console.error('保存播放进度失败:', err);
    }
  };

  useEffect(() => {
    // 页面即将卸载时保存播放进度
    const handleBeforeUnload = () => {
      saveCurrentPlayProgress();
    };

    // 页面可见性变化时保存播放进度
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress();
      }
    };

    // 添加事件监听器
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // 清理事件监听器
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail, artPlayerRef.current]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 收藏相关
  // ---------------------------------------------------------------------------
  // 每当 source 或 id 变化时检查收藏状态
  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    })();
  }, [currentSource, currentId]);

  // 监听收藏数据更新事件
  useEffect(() => {
    if (!currentSource || !currentId) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(currentSource, currentId);
        const isFav = !!favorites[key];
        setFavorited(isFav);
      }
    );

    return unsubscribe;
  }, [currentSource, currentId]);

  // 切换收藏
  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    try {
      if (favorited) {
        // 如果已收藏，删除收藏
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        // 如果未收藏，添加收藏
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  // 下载当前剧集
  const handleDownloadEpisode = async () => {
    const d = detailRef.current;
    if (!d || !d.episodes || d.episodes.length === 0) return;
    setShowDownloadSelector(true);
  };

  // 确认下载选中的剧集
  const handleConfirmDownloads = async () => {
    const d = detailRef.current;
    if (!d) return;

    const title = videoTitleRef.current || d.title || '未知';
    const sourceName = d.source_name || '';
    const existingTasks = getDownloadTasks();
    let addedCount = 0;
    let skippedCount = 0;

    Array.from(downloadSelections).forEach((index) => {
      const url = d.episodes[index];
      const label = d.episodes.length > 1 ? `第${index + 1}集` : '完整版';

      // 跳过已存在的任务
      const exists = existingTasks.find(t =>
        t.url === url &&
        t.episodeLabel === label &&
        t.title === title
      );
      if (exists) {
        skippedCount++;
        return;
      }

      const task = addDownloadTask({
        title,
        episodeLabel: label,
        sourceName,
        url,
        poster: d.poster || videoCover || '',
      });
      startDownload(task.id);
      addedCount++;
    });

    if (addedCount > 0) {
      Swal.mixin({
        toast: true,
        position: 'top',
        showConfirmButton: false,
        timer: 2500,
        timerProgressBar: true,
        didOpen: (popup) => {
          const el = popup as HTMLElement;
          el.style.setProperty('top', 'env(safe-area-inset-top, 44px)', 'important');
        },
        customClass: {
          popup: '!bg-gray-900 !text-white !rounded-2xl !shadow-2xl !border !border-gray-700 !px-6 !py-4',
          title: '!text-sm !font-medium',
        },
      }).fire({
        icon: 'success',
        title: `已添加 ${addedCount} 个下载任务`,
        text: skippedCount > 0 ? `${skippedCount} 个已存在，已跳过` : '',
      });
    } else if (skippedCount > 0) {
      Swal.mixin({
        toast: true,
        position: 'top',
        showConfirmButton: false,
        timer: 2500,
        timerProgressBar: true,
        didOpen: (popup) => {
          const el = popup as HTMLElement;
          el.style.setProperty('top', 'env(safe-area-inset-top, 44px)', 'important');
        },
        customClass: {
          popup: '!bg-gray-900 !text-white !rounded-2xl !shadow-2xl !border !border-gray-700 !px-6 !py-4',
          title: '!text-sm !font-medium',
        },
      }).fire({
        icon: 'info',
        title: '所选剧集均已存在',
      });
    }

    setShowDownloadSelector(false);
    setDownloadSelections(new Set());
  };

  useEffect(() => {
    if (
      !Artplayer ||
      (!isLocalPlayback && !Hls) ||
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      return;
    }

    // 确保选集索引有效
    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('视频地址无效');
      return;
    }
    console.log(videoUrl);

    // 检测是否为WebKit浏览器
    const isWebkit =
      typeof window !== 'undefined' &&
      typeof (window as any).webkitConvertPointFromNodeToPage === 'function';

    // 非WebKit浏览器且播放器已存在，使用switch方法切换
    if (!isWebkit && artPlayerRef.current) {
      artPlayerRef.current.switch = videoUrl;
      artPlayerRef.current.title = `${videoTitle} - 第${
        currentEpisodeIndex + 1
      }集`;
      artPlayerRef.current.poster = videoCover;
      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }
      return;
    }

    // WebKit浏览器或首次创建：销毁之前的播放器实例并创建新的
    if (artPlayerRef.current) {
      if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
        artPlayerRef.current.video.hls.destroy();
      }
      // 销毁播放器实例
      artPlayerRef.current.destroy();
      artPlayerRef.current = null;
    }

    try {
      // 创建新的播放器实例
      Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
      Artplayer.USE_RAF = true;

      artPlayerRef.current = new Artplayer({
        container: artRef.current,
        url: videoUrl,
        ...(isLocalPlayback ? { type: 'm3u8' } : {}),
        poster: videoCover,
        volume: 0.7,
        isLive: false,
        muted: false,
        autoplay: true,
        pip: false, // 禁用画中画功能，防止移动端页面错乱
        autoSize: false,
        autoMini: false,
        screenshot: false,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: true,
        fullscreenWeb: true,
        subtitleOffset: false,
        miniProgressBar: false,
        mutex: true,
        playsInline: true,
        autoPlayback: false,
        airplay: true,
        theme: '#22c55e',
        lang: 'zh-cn',
        hotkey: false,
        fastForward: true,
        autoOrientation: true,
        lock: true,
        moreVideoAttr: {
          crossOrigin: 'anonymous',
        },
        // HLS 支持配置
        customType: {
          m3u8: function (video: HTMLVideoElement, url: string) {
              if (!Hls) {
                console.error('HLS.js 未加载');
                return;
              }

              console.log(`[customType.m3u8] 被调用\n  url: ${url}\n  本地播放: ${isLocalPlayback}`);

              if (video.hls) {
                video.hls.destroy();
              }

              console.log('[customType] 创建HLS实例...');
              let hls: Hls;
              try {
                const customLoader = isLocalPlayback
                  ? createLocalSegmentLoader()
                  : blockAdEnabledRef.current
                  ? CustomHlsJsLoader
                  : Hls.DefaultConfig.loader;

                const hlsConfig: any = {
                  debug: false, // 关闭日志
                  enableWorker: true, // WebWorker 解码，降低主线程压力
                  lowLatencyMode: true, // 开启低延迟 LL-HLS
                  autoStartLoad: true, // 让 HLS.js 自动管理加载

                  /* 缓冲/内存相关 */
                  maxBufferLength: 30, // 前向缓冲最大 30s，过大容易导致高延迟
                  backBufferLength: 30, // 仅保留 30s 已播放内容，避免内存占用
                  maxBufferSize: 60 * 1000 * 1000, // 约 60MB，超出后触发清理

                  /* 自定义loader */
                  loader: customLoader,
                };

                // 本地播放时显式设置 fLoader/pLoader，确保片段也被 LocalLoader 拦截
                if (isLocalPlayback) {
                  hlsConfig.fLoader = customLoader;
                  hlsConfig.pLoader = customLoader;
                }

                hls = new Hls(hlsConfig);
                console.log('[customType] HLS实例创建成功');
              } catch (e) {
                console.error(`[customType] HLS实例创建失败: ${(e as Error).message}\n  堆栈: ${(e as Error).stack}`);
                return;
              }

              hls.on(Hls.Events.MANIFEST_PARSED, (_event: any, data: any) => {
                const levels = data.levels || [];
                console.log(`[HLS] MANIFEST_PARSED: 成功解析播放列表, ${levels.length} 个level`);
                if (levels.length > 0) {
                  const frags = levels[0].details?.fragments || [];
                  console.log(`[HLS] level[0] details:`, JSON.stringify({
                    bitrate: levels[0].bitrate,
                    width: levels[0].width,
                    height: levels[0].height,
                    fragments: frags.length,
                    firstFragUrl: frags[0]?.url,
                    lastFragUrl: frags[frags.length - 1]?.url,
                  }));
                }
              });

              // MEDIA_ATTACHED 时由 HLS.js 自动加载（autoStartLoad: true）
              hls.on(Hls.Events.MEDIA_ATTACHED, () => {
                console.log('[HLS] MEDIA_ATTACHED');
                try {
                  const playResult = video.play();
                  console.log(`[HLS] video.play() 返回: ${typeof playResult}`);
                  if (playResult && typeof playResult.then === 'function') {
                    playResult.then(() => console.log('[HLS] video.play() resolve')).catch((e: any) => console.warn(`[HLS] video.play() reject: ${e?.message || e}`));
                  }
                } catch (e: any) {
                  console.warn(`[HLS] video.play() 同步异常: ${e?.message || e}`);
                }
              });

              // 监听分段加载事件
              hls.on(Hls.Events.FRAG_LOADING, (_event: any, data: any) => {
                console.log(`[HLS] FRAG_LOADING: ${data.frag?.url || 'N/A'}, sn=${data.frag?.sn}, level=${data.frag?.level}`);
              });
              hls.on(Hls.Events.FRAG_LOADED, (_event: any, data: any) => {
                console.log(`[HLS] FRAG_LOADED: ${data.frag?.url || 'N/A'}, stats.loaded=${data.frag?.stats?.loaded}`);
              });
              hls.on(Hls.Events.BUFFER_APPENDING, (_event: any, data: any) => {
                console.log(`[HLS] BUFFER_APPENDING: type=${data.type}`);
              });

              try {
                console.log('[customType] 绑定video...');
                hls.attachMedia(video);
                console.log('[customType] attachMedia 完成');
                console.log('[customType] 调用 loadSource...');
                hls.loadSource(url);
                console.log('[customType] loadSource 成功');
              } catch (e) {
                console.error(`[customType] loadSource/attachMedia 失败: ${(e as Error).message}`);
                return;
              }
              video.hls = hls;

              // 本地播放时不要添加 <source> 元素，避免干扰 HLS.js 的 MediaSource
              if (!isLocalPlayback) {
                ensureVideoSource(video, url);
              }

              hls.on(Hls.Events.ERROR, function (event: any, data: any) {
                // bufferFullError 是非致命错误，不需要处理
                if (data.details === 'bufferFullError') {
                  return;
                }

                // 详细错误信息
                const errInfo = `HLS Error [${data.type}] ${data.details}`;
                const urlInfo = data.url ? `\n  URL: ${data.url}` : '';
                const responseInfo = data.response ? `\n  HTTP状态: ${data.response.code || 'N/A'}, URL: ${data.response.url || 'N/A'}` : '';

                // SSL/网络错误通常是源头问题，不作为严重错误日志（因为可能有其他集数可用）
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                  console.warn(`${errInfo}${urlInfo}${responseInfo}`);
                } else {
                  console.error(`${errInfo}${urlInfo}${responseInfo}`);
                }

                if (data.fatal) {
                  switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                      console.log('网络错误，尝试恢复...');
                      hls.startLoad();
                      break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                      console.log('媒体错误，尝试恢复...');
                      hls.recoverMediaError();
                      setTimeout(() => {
                        if (video && !video.paused) {
                          video.pause();
                          setTimeout(() => {
                            video.play().catch(() => { /* ignore */ });
                          }, 100);
                        }
                      }, 500);
                      break;
                    default:
                      console.log('无法恢复的错误');
                      hls.destroy();
                      break;
                  }
                }
              });
            },
          },
        icons: {
          loading:
            '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
        },
        settings: [
          {
            html: '去广告',
            icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
            tooltip: blockAdEnabled ? '已开启' : '已关闭',
            onClick() {
              const newVal = !blockAdEnabled;
              try {
                localStorage.setItem('enable_blockad', String(newVal));
                if (artPlayerRef.current) {
                  resumeTimeRef.current = artPlayerRef.current.currentTime;
                  if (
                    artPlayerRef.current.video &&
                    artPlayerRef.current.video.hls
                  ) {
                    artPlayerRef.current.video.hls.destroy();
                  }
                  artPlayerRef.current.destroy();
                  artPlayerRef.current = null;
                }
                setBlockAdEnabled(newVal);
              } catch (_) {
                // ignore
              }
              return newVal ? '当前开启' : '当前关闭';
            },
          },
          {
            html: '跳过片头片尾',
            switch: skipConfig.enable,
            onSwitch: function (item) {
              const newConfig = {
                ...skipConfigRef.current,
                enable: !item.switch,
              };
              handleSkipConfigChange(newConfig);
              return !item.switch;
            },
          },
          {
            html: '设置片头',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
            tooltip:
              skipConfig.intro_time === 0
                ? '设置片头时间'
                : `${formatTime(skipConfig.intro_time)}`,
            onClick: function () {
              const currentTime = artPlayerRef.current?.currentTime || 0;
              if (currentTime > 0) {
                const newConfig = {
                  ...skipConfigRef.current,
                  intro_time: currentTime,
                };
                handleSkipConfigChange(newConfig);
                return `${formatTime(currentTime)}`;
              }
            },
          },
          {
            html: '设置片尾',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
            tooltip:
              skipConfig.outro_time === 0
                ? '设置片尾时间'
                : `${formatTime(skipConfig.outro_time)}`,
            onClick: function () {
              const currentTime = artPlayerRef.current?.currentTime || 0;
              if (currentTime > 0) {
                const newConfig = {
                  ...skipConfig,
                  outro_time: currentTime,
                };
                handleSkipConfigChange(newConfig);
                return `${formatTime(currentTime)}`;
              }
            },
          },
        ],
        // 控制栏配置
        controls: [
          {
            position: 'left',
            index: 13,
            html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
            tooltip: '播放下一集',
            click: function () {
              handleNextEpisode();
            },
          },
        ],
      });

      // 监听播放器事件
      artPlayerRef.current.on('ready', () => {
        setError(null);
      });

      artPlayerRef.current.on('video:volumechange', () => {
        lastVolumeRef.current = artPlayerRef.current.volume;
      });

      // 监听视频可播放事件，这时恢复播放进度更可靠
      artPlayerRef.current.on('video:canplay', () => {
        // 若存在需要恢复的播放进度，则跳转
        if (resumeTimeRef.current && resumeTimeRef.current > 0) {
          try {
            const duration = artPlayerRef.current.duration || 0;
            let target = resumeTimeRef.current;
            if (duration && target >= duration - 2) {
              target = Math.max(0, duration - 5);
            }
            artPlayerRef.current.currentTime = target;
            console.log('成功恢复播放进度到:', resumeTimeRef.current);
            
            // 确保视频和音频同步，强制刷新播放状态
            setTimeout(() => {
              if (artPlayerRef.current && artPlayerRef.current.video) {
                const video = artPlayerRef.current.video;
                if (!video.paused) {
                  video.pause();
                  setTimeout(() => {
                    video.play().catch(() => {
                      console.warn('自动播放失败，需要用户手动点击播放');
                    });
                  }, 100);
                }
              }
            }, 500);
          } catch (err) {
            console.warn('恢复播放进度失败:', err);
          }
        }
        resumeTimeRef.current = null;

        setTimeout(() => {
          if (
            Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) > 0.01
          ) {
            artPlayerRef.current.volume = lastVolumeRef.current;
          }
          artPlayerRef.current.notice.show = '';
        }, 0);

        // 隐藏换源加载状态
        setIsVideoLoading(false);
      });

      // 监听视频时间更新事件，实现跳过片头片尾
      artPlayerRef.current.on('video:timeupdate', () => {
        if (!skipConfigRef.current.enable) return;

        const currentTime = artPlayerRef.current.currentTime || 0;
        const duration = artPlayerRef.current.duration || 0;

        // 跳过片头
        if (
          skipConfigRef.current.intro_time > 0 &&
          currentTime < skipConfigRef.current.intro_time
        ) {
          artPlayerRef.current.currentTime = skipConfigRef.current.intro_time;
          artPlayerRef.current.notice.show = `已跳过片头 (${formatTime(
            skipConfigRef.current.intro_time
          )})`;
        }

        // 跳过片尾
        if (
          skipConfigRef.current.outro_time > 0 &&
          duration > 0 &&
          currentTime > skipConfigRef.current.outro_time
        ) {
          handleNextEpisode();
          artPlayerRef.current.notice.show = `已跳过片尾 (${formatTime(
            skipConfigRef.current.outro_time
          )})`;
        }
      });

      artPlayerRef.current.on('error', (err: any) => {
        // 尝试获取底层 video 元素的详细错误信息
        const videoEl = artPlayerRef.current?.video as HTMLVideoElement | undefined;
        let detail = '';
        if (videoEl) {
          const mediaError = videoEl.error;
          if (mediaError) {
            const codes: Record<number, string> = {
              1: 'MEDIA_ERR_ABORTED - 加载被中断',
              2: 'MEDIA_ERR_NETWORK - 网络错误',
              3: 'MEDIA_ERR_DECODE - 解码错误',
              4: 'MEDIA_ERR_SRC_NOT_SUPPORTED - 视频格式不支持',
              5: 'MEDIA_ERR_ENCRYPTED - 视频加密(DRM)',
            };
            detail = `\n  video.error.code=${mediaError.code} (${codes[mediaError.code] || '未知'})`;
            if (mediaError.message) {
              detail += `\n  video.error.message=${mediaError.message}`;
            }
          }
        }
        console.error(
          `播放器错误 [${isLocalPlayback ? '本地' : '在线'}]${detail}\n  URL: ${videoUrl}\n  原始错误: ${JSON.stringify(err)}`
        );
        if (artPlayerRef.current.currentTime > 0) {
          return;
        }
        // 尝试自动切换到下一个可用集数（仅远程源）
        if (!isLocalPlayback) {
          const d = detailRef.current;
          const idx = currentEpisodeIndexRef.current;
          if (d?.episodes && idx < d.episodes.length - 1) {
            console.log(`自动切换到下一集 ${idx + 2}`);
            setCurrentEpisodeIndex(idx + 1);
          }
        }
      });

      // 监听 video 元素原生错误事件（更底层的错误捕获）
      if (artPlayerRef.current?.video) {
        const videoEl = artPlayerRef.current.video as HTMLVideoElement;
        videoEl.addEventListener('error', (e) => {
          console.error(
            `video.onerror 事件:\n  URL: ${videoEl.currentSrc || videoUrl}\n  code: ${videoEl.error?.code || 'N/A'}\n  message: ${videoEl.error?.message || 'N/A'}`
          );
        });
      }

      // 监听视频播放结束事件，自动播放下一集
      artPlayerRef.current.on('video:ended', () => {
        const d = detailRef.current;
        const idx = currentEpisodeIndexRef.current;
        if (d && d.episodes && idx < d.episodes.length - 1) {
          setTimeout(() => {
            setCurrentEpisodeIndex(idx + 1);
          }, 1000);
        }
      });

      artPlayerRef.current.on('video:timeupdate', () => {
        const now = Date.now();
        let interval = 5000;
        if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'd1') {
          interval = 10000;
        }
        if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'upstash') {
          interval = 20000;
        }
        if (now - lastSaveTimeRef.current > interval) {
          saveCurrentPlayProgress();
          lastSaveTimeRef.current = now;
        }
      });

      artPlayerRef.current.on('pause', () => {
        saveCurrentPlayProgress();
      });

      // 移动端全屏事件监听
      artPlayerRef.current.on('fullscreen', async (state: boolean) => {
        if (typeof window !== 'undefined') {
          if (state) {
            // 进入全屏时，强制横屏
            try {
              await ScreenOrientation.lock({ orientation: 'landscape' });
              console.log('Capacitor屏幕方向锁定成功');
            } catch (e) {
              console.log('Capacitor屏幕锁定失败，使用CSS备用', e);
              // 如果Capacitor失败，尝试使用Web API
              try {
                if ('orientation' in screen && 'lock' in screen.orientation) {
                  await (screen.orientation as any).lock('landscape');
                  console.log('Web Screen Orientation API锁定成功');
                }
              } catch (webError) {
                console.log('Web Screen Orientation API也失败', webError);
              }
            }
            
            // 隐藏移动端状态栏
            try {
              await StatusBar.hide();
              console.log('状态栏隐藏成功');
            } catch (e) {
              console.log('状态栏隐藏失败', e);
            }
            
            // 隐藏移动端导航栏和状态栏
            const metaViewport = document.querySelector('meta[name="viewport"]');
            if (metaViewport) {
              metaViewport.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no');
            }
            
            // 强制CSS横屏显示
            const videoContainer = document.querySelector('.art-video-player');
            if (videoContainer) {
              const container = videoContainer as HTMLElement;
              container.style.position = 'fixed';
              container.style.top = '0';
              container.style.left = '0';
              container.style.width = '100vw';
              container.style.height = '100vh';
              container.style.zIndex = '9999';
              container.style.backgroundColor = '#000';
              
              // 检测当前是否为竖屏，如果是则旋转
              if (window.innerHeight > window.innerWidth) {
                container.style.transform = 'rotate(90deg)';
                container.style.transformOrigin = 'center center';
                container.style.width = '100vh';
                container.style.height = '100vw';
                container.style.left = '50%';
                container.style.top = '50%';
                container.style.marginLeft = '-50vh';
                container.style.marginTop = '-50vw';
              }
            }
            
            document.body.style.overflow = 'hidden';
            document.documentElement.style.overflow = 'hidden';
            
            // 隐藏地址栏（移动端浏览器）
            setTimeout(() => {
              window.scrollTo(0, 1);
            }, 100);
            
            // 2秒后隐藏播放器控制栏
            setTimeout(() => {
              if (artPlayerRef.current && artPlayerRef.current.isFullscreen) {
                // 隐藏控制栏
                artPlayerRef.current.controls = false;
                console.log('全屏模式下隐藏控制栏');
              }
            }, 2000);
          } else {
            // 退出全屏时，恢复正常
            try {
              await ScreenOrientation.unlock();
              console.log('Capacitor屏幕方向解锁成功');
            } catch (e) {
              console.log('Capacitor屏幕解锁失败', e);
              // 如果Capacitor失败，尝试使用Web API
              try {
                if ('orientation' in screen && 'unlock' in screen.orientation) {
                  (screen.orientation as any).unlock();
                  console.log('Web Screen Orientation API解锁成功');
                }
              } catch (webError) {
                console.log('Web Screen Orientation API解锁失败', webError);
              }
            }
            
            // 恢复状态栏显示
            try {
              await StatusBar.show();
              console.log('状态栏恢复显示成功');
            } catch (e) {
              console.log('状态栏恢复显示失败', e);
            }
            
            // 恢复播放器控制栏
            if (artPlayerRef.current) {
              artPlayerRef.current.controls = true;
              console.log('恢复播放器控制栏');
            }
            
            // 恢复viewport设置
            const metaViewport = document.querySelector('meta[name="viewport"]');
            if (metaViewport) {
              metaViewport.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
            }
            
            // 恢复CSS样式
            const videoContainer = document.querySelector('.art-video-player');
            if (videoContainer) {
              const container = videoContainer as HTMLElement;
              container.style.transform = '';
              container.style.transformOrigin = '';
              container.style.width = '';
              container.style.height = '';
              container.style.position = '';
              container.style.top = '';
              container.style.left = '';
              container.style.zIndex = '';
              container.style.backgroundColor = '';
              container.style.marginLeft = '';
              container.style.marginTop = '';
            }
            
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
          }
        }
      });

      // 网页全屏事件监听
      artPlayerRef.current.on('fullscreenWeb', async (state: boolean) => {
        if (typeof window !== 'undefined') {
          if (state) {
            // 进入网页全屏时，强制横屏
            try {
              await ScreenOrientation.lock({ orientation: 'landscape' });
              console.log('Capacitor屏幕方向锁定成功');
            } catch (e) {
              console.log('Capacitor屏幕锁定失败，使用CSS备用', e);
              // 如果Capacitor失败，尝试使用Web API
              try {
                if ('orientation' in screen && 'lock' in screen.orientation) {
                  await (screen.orientation as any).lock('landscape');
                  console.log('Web Screen Orientation API锁定成功');
                }
              } catch (webError) {
                console.log('Web Screen Orientation API也失败', webError);
              }
            }
            
            // 隐藏移动端导航栏和状态栏
            const metaViewport = document.querySelector('meta[name="viewport"]');
            if (metaViewport) {
              metaViewport.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no');
            }
            
            // 强制CSS横屏显示
            const videoContainer = document.querySelector('.art-video-player');
            if (videoContainer) {
              const container = videoContainer as HTMLElement;
              container.style.position = 'fixed';
              container.style.top = '0';
              container.style.left = '0';
              container.style.width = '100vw';
              container.style.height = '100vh';
              container.style.zIndex = '9999';
              container.style.backgroundColor = '#000';
              
              // 检测当前是否为竖屏，如果是则旋转
              if (window.innerHeight > window.innerWidth) {
                container.style.transform = 'rotate(90deg)';
                container.style.transformOrigin = 'center center';
                container.style.width = '100vh';
                container.style.height = '100vw';
                container.style.left = '50%';
                container.style.top = '50%';
                container.style.marginLeft = '-50vh';
                container.style.marginTop = '-50vw';
              }
            }
            
            document.body.style.overflow = 'hidden';
            document.documentElement.style.overflow = 'hidden';
            
            // 隐藏地址栏（移动端浏览器）
            setTimeout(() => {
              window.scrollTo(0, 1);
            }, 100);
          } else {
            // 退出网页全屏时，恢复正常
            try {
              await ScreenOrientation.unlock();
              console.log('Capacitor屏幕方向解锁成功');
            } catch (e) {
              console.log('Capacitor屏幕解锁失败', e);
              // 如果Capacitor失败，尝试使用Web API
              try {
                if ('orientation' in screen && 'unlock' in screen.orientation) {
                  (screen.orientation as any).unlock();
                  console.log('Web Screen Orientation API解锁成功');
                }
              } catch (webError) {
                console.log('Web Screen Orientation API解锁失败', webError);
              }
            }
            
            // 恢复viewport设置
            const metaViewport = document.querySelector('meta[name="viewport"]');
            if (metaViewport) {
              metaViewport.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
            }
            
            // 恢复CSS样式
            const videoContainer = document.querySelector('.art-video-player');
            if (videoContainer) {
              const container = videoContainer as HTMLElement;
              container.style.transform = '';
              container.style.transformOrigin = '';
              container.style.width = '';
              container.style.height = '';
              container.style.position = '';
              container.style.top = '';
              container.style.left = '';
              container.style.zIndex = '';
              container.style.backgroundColor = '';
              container.style.marginLeft = '';
              container.style.marginTop = '';
            }
            
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
          }
        }
      });

      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }
    } catch (err) {
      console.error(
        `创建播放器失败:\n  URL: ${videoUrl}\n  本地播放: ${isLocalPlayback}\n  错误: ${(err as Error).message || JSON.stringify(err)}`
      );
      setError('播放器初始化失败');
    }
  }, [Artplayer, Hls, videoUrl, loading, blockAdEnabled, isLocalPlayback]);

  // 当组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, []);

  if (loading) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='glass rounded-3xl px-10 py-12 text-center max-w-md mx-auto'>
            {/* 简洁 spinner */}
            <div className='relative mb-8 mx-auto w-20 h-20'>
              <div className='absolute inset-0 rounded-full border-4 border-gray-200 dark:border-gray-700'></div>
              <div className='absolute inset-0 rounded-full border-4 border-transparent border-t-green-500 animate-spin'></div>
              <div className='absolute inset-0 flex items-center justify-center text-2xl'>
                {loadingStage === 'searching' && '🔍'}
                {loadingStage === 'preferring' && '⚡'}
                {loadingStage === 'fetching' && '🎬'}
                {loadingStage === 'ready' && '✨'}
              </div>
            </div>

            {/* 进度指示器 */}
            <div className='mb-8 w-72 mx-auto'>
              <div className='flex items-center justify-between mb-3'>
                {['搜索', '优选', '就绪'].map((label, idx) => {
                  const stageOrder = ['searching', 'preferring', 'ready'];
                  const currentOrder = stageOrder.indexOf(loadingStage);
                  const isActive = idx <= currentOrder;
                  const isCurrent = idx === currentOrder;
                  return (
                    <div key={label} className='flex flex-col items-center gap-1.5'>
                      <div
                        className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${
                          isCurrent
                            ? 'bg-green-500 scale-125'
                            : isActive
                            ? 'bg-green-400'
                            : 'bg-gray-300 dark:bg-gray-600'
                        }`}
                      />
                      <span
                        className={`text-[10px] font-medium transition-colors duration-300 ${
                          isActive
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-gray-400 dark:text-gray-500'
                        }`}
                      >
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 进度条 */}
              <div className='w-full bg-gray-200/60 dark:bg-gray-700/60 rounded-full h-1.5 overflow-hidden'>
                <div
                  className='h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all duration-1000 ease-out'
                  style={{
                    width:
                      loadingStage === 'searching' ||
                      loadingStage === 'fetching'
                        ? '33%'
                        : loadingStage === 'preferring'
                        ? '66%'
                        : '100%',
                  }}
                />
              </div>
            </div>

            {/* 加载消息 */}
            <p className='text-lg font-semibold text-gradient animate-pulse'>
              {loadingMessage}
            </p>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='glass rounded-3xl px-10 py-12 text-center max-w-md mx-auto'>
            {/* 简洁 X 圆圈 */}
            <div className='mx-auto mb-8 w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center'>
              <svg
                className='w-10 h-10 text-red-500'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M6 18L18 6M6 6l12 12'
                />
              </svg>
            </div>

            {/* 错误信息 */}
            <div className='space-y-4 mb-8'>
              <h2 className='text-2xl font-bold text-gray-800 dark:text-gray-100'>
                哎呀，出现了一些问题
              </h2>
              <div className='bg-red-500/5 rounded-xl p-4'>
                <p className='text-red-600 dark:text-red-400 font-medium'>
                  {error}
                </p>
              </div>
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                请检查网络连接或尝试刷新页面
              </p>
            </div>

            {/* 操作按钮 */}
            <div className='space-y-3'>
              <button
                onClick={() =>
                  videoTitle
                    ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
                    : router.back()
                }
                className='w-full px-6 py-3 bg-green-500 text-white rounded-full font-medium hover:bg-green-600 transition-colors duration-200'
              >
                {videoTitle ? '🔍 返回搜索' : '← 返回上页'}
              </button>

              <button
                onClick={() => window.location.reload()}
                className='w-full px-6 py-3 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 rounded-full font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-200'
              >
                🔄 重新尝试
              </button>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/play'>
      <div className='flex flex-col gap-5 py-6 px-5 lg:px-[3rem] 2xl:px-20'>
        {/* 第一行：影片标题 */}
        <div className='py-1'>
          <h1 className='text-xl font-semibold text-gradient'>
            {videoTitle || '影片标题'}
            {totalEpisodes > 1 && (
              <span className='text-gray-500 dark:text-gray-400 font-normal'>
                {` > 第 ${currentEpisodeIndex + 1} 集`}
              </span>
            )}
            {totalEpisodes === 1 && detail && (() => {
              const title = videoTitle || '未知影片';
              const currentUrl = detail.episodes?.[0];
              const isDownloaded = downloadTasks.some(
                t => t.title === title && t.status === 'completed'
              );
              if (isDownloaded) {
                return (
                  <span className='ml-3 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-gray-400/20 text-gray-400 dark:bg-gray-600/20 dark:text-gray-500 text-sm font-medium cursor-not-allowed'>
                    <Download className='w-3.5 h-3.5' />
                    已下载
                  </span>
                );
              }
              return (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (currentUrl) {
                      const t = videoTitleRef.current || detailRef.current?.title || '未知';
                      const existingTasks = getDownloadTasks();
                      const exists = existingTasks.find(
                        et => et.url === currentUrl && et.title === t
                      );
                      if (!exists) {
                        const task = addDownloadTask({
                          title: t,
                          episodeLabel: '完整版',
                          sourceName: detailRef.current?.source_name || '',
                          url: currentUrl,
                          poster: detailRef.current?.poster || videoCover || '',
                        });
                        startDownload(task.id);
                        Swal.mixin({
                          toast: true,
                          position: 'top',
                          showConfirmButton: false,
                          timer: 2500,
                          timerProgressBar: true,
                          didOpen: (popup) => {
                            const el = popup as HTMLElement;
                            el.style.setProperty('top', 'env(safe-area-inset-top, 44px)', 'important');
                          },
                          customClass: {
                            popup: '!bg-gray-900 !text-white !rounded-2xl !shadow-2xl !border !border-gray-700 !px-6 !py-4',
                            title: '!text-sm !font-medium',
                          },
                        }).fire({
                          icon: 'success',
                          title: '已开始下载',
                        });
                      } else {
                        Swal.mixin({
                          toast: true,
                          position: 'top',
                          showConfirmButton: false,
                          timer: 2500,
                          timerProgressBar: true,
                          didOpen: (popup) => {
                            const el = popup as HTMLElement;
                            el.style.setProperty('top', 'env(safe-area-inset-top, 44px)', 'important');
                          },
                          customClass: {
                            popup: '!bg-gray-900 !text-white !rounded-2xl !shadow-2xl !border !border-gray-700 !px-6 !py-4',
                            title: '!text-sm !font-medium',
                          },
                        }).fire({
                          icon: 'info',
                          title: '该影片已在下载列表中',
                        });
                      }
                    }
                  }}
                  className='ml-3 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 text-sm font-medium transition-colors'
                  title='下载'
                >
                  <Download className='w-3.5 h-3.5' />
                  下载
                </button>
              );
            })()}
          </h1>
        </div>
        {/* 第二行：播放器和选集 */}
        <div className='space-y-3'>
          {/* 折叠控制 - 仅在 lg 及以上屏幕显示 */}
          <div className='hidden lg:flex justify-end gap-2'>
            <button
              onClick={() =>
                setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
              }
              className='group flex items-center gap-2 px-4 py-2 rounded-full bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm border border-gray-200/40 dark:border-gray-700/40 hover:bg-white dark:hover:bg-gray-800 transition-all duration-200'
              title={
                isEpisodeSelectorCollapsed ? '显示选集面板' : '隐藏选集面板'
              }
            >
              <svg
                className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${
                  isEpisodeSelectorCollapsed ? 'rotate-180' : 'rotate-0'
                }`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M9 5l7 7-7 7'
                />
              </svg>
              <span className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                {isEpisodeSelectorCollapsed ? '显示' : '隐藏'}
              </span>

              {/* 状态指示点 */}
              <div
                className={`w-1.5 h-1.5 rounded-full transition-all duration-200 ${
                  isEpisodeSelectorCollapsed
                    ? 'bg-orange-400 animate-pulse'
                    : 'bg-green-400'
                }`}
              />
            </button>
          </div>

          <div
            className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${
              isEpisodeSelectorCollapsed
                ? 'grid-cols-1'
                : 'grid-cols-1 md:grid-cols-4'
            }`}
          >
            {/* 播放器 */}
            <div
              className={`h-full transition-all duration-300 ease-in-out rounded-2xl border border-gray-200/30 dark:border-gray-700/30 overflow-hidden ${
                isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
              }`}
            >
              <div className='relative w-full h-[300px] lg:h-full'>
                <div
                  ref={artRef}
                  className='bg-black w-full h-full rounded-2xl overflow-hidden shadow-lg'
                />

                {/* 换源加载蒙层 */}
                {isVideoLoading && (
                  <div className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-2xl flex items-center justify-center z-[500] transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      {/* 简洁 spinner */}
                      <div className='relative mb-8 mx-auto w-20 h-20'>
                        <div className='absolute inset-0 rounded-full border-4 border-gray-600'></div>
                        <div className='absolute inset-0 rounded-full border-4 border-transparent border-t-green-500 animate-spin'></div>
                        <div className='absolute inset-0 flex items-center justify-center text-2xl'>
                          🎬
                        </div>
                      </div>

                      {/* 换源消息 */}
                      <p className='text-lg font-semibold text-white animate-pulse'>
                        {videoLoadingStage === 'sourceChanging'
                          ? '🔄 切换播放源...'
                          : '🔄 视频加载中...'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 选集和换源 - 本地播放时完全隐藏 */}
            <div
              className={`h-[300px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${
                isLocalPlayback
                  ? 'hidden'
                  : isEpisodeSelectorCollapsed
                  ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                  : 'md:col-span-1 lg:opacity-100 lg:scale-100'
              }`}
            >
              <EpisodeSelector
                totalEpisodes={totalEpisodes}
                value={currentEpisodeIndex + 1}
                onChange={handleEpisodeChange}
                onSourceChange={handleSourceChange}
                currentSource={currentSource}
                currentId={currentId}
                videoTitle={searchTitle || videoTitle}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
                precomputedVideoInfo={precomputedVideoInfo}
                episodes={detail?.episodes}
                onDownloadClick={handleDownloadEpisode}
                showSourceTab={currentSource !== 'local'}
                hideAllTabs={currentSource === 'local'}
              />
            </div>
          </div>
        </div>

        {/* 详情展示 */}
        <div className='grid grid-cols-1 md:grid-cols-4 gap-6'>
          {/* 文字区 */}
          <div className='md:col-span-3'>
            <div className='py-2 flex flex-col min-h-0'>
              {/* 标题 */}
              <h1 className='text-3xl font-bold mb-3 tracking-wide flex items-center flex-shrink-0 text-center md:text-left w-full'>
                <span className='text-gradient'>
                  {videoTitle || '影片标题'}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleFavorite();
                  }}
                  className='ml-3 flex-shrink-0 hover:scale-110 transition-transform duration-200'
                >
                  <FavoriteIcon filled={favorited} />
                </button>
              </h1>

              {/* 关键信息行 */}
              <div className='flex flex-wrap items-center gap-2 text-base mb-5 flex-shrink-0'>
                {detail?.class && (
                  <span className='px-3 py-1 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 text-sm font-semibold'>
                    {detail.class}
                  </span>
                )}
                {(detail?.year || videoYear) && (
                  <span className='px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-sm'>
                    {detail?.year || videoYear}
                  </span>
                )}
                {detail?.source_name && (
                  <span className='px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-sm'>
                    {detail.source_name}
                  </span>
                )}
                {detail?.type_name && (
                  <span className='px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-sm'>
                    {detail.type_name}
                  </span>
                )}
              </div>
              {/* 剧情简介 */}
              {detail?.desc && (
                <div
                  className='text-base leading-relaxed text-gray-700 dark:text-gray-300 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide'
                  style={{ whiteSpace: 'pre-line' }}
                >
                  {detail.desc}
                </div>
              )}
            </div>
          </div>

          {/* 封面展示 */}
          <div className='hidden md:block md:col-span-1 md:order-first'>
            <div className='pl-0 py-2 pr-6'>
              <div className='bg-gray-200 dark:bg-gray-800 aspect-[2/3] flex items-center justify-center rounded-2xl overflow-hidden shadow-md'>
                {videoCover ? (
                  <img
                    src={processImageUrl(videoCover)}
                    alt={videoTitle}
                    className='w-full h-full object-cover'
                  />
                ) : (
                  <span className='text-gray-400 dark:text-gray-500 text-sm'>
                    封面图片
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 下载选集弹窗 */}
      {showDownloadSelector && detail && detail.episodes && detail.episodes.length > 0 && (() => {
        return (
        <div className='fixed inset-0 z-[1000] flex items-center justify-center'>
          {/* 半透明背景遮罩 */}
          <div
            className='absolute inset-0 bg-black/60 backdrop-blur-sm'
            onClick={() => setShowDownloadSelector(false)}
          />
          {/* 弹窗内容 */}
          <div className='relative z-10 w-full max-w-md mx-4 max-h-[80vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col'>
            {/* 标题栏 */}
            <div className='flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700'>
              <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                选择要下载的剧集
              </h2>
              <button
                onClick={() => {
                  setShowDownloadSelector(false);
                  setDownloadSelections(new Set());
                }}
                className='p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors'
              >
                <svg className='w-5 h-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M6 18L18 6M6 6l12 12' />
                </svg>
              </button>
            </div>
            {/* 操作栏 */}
            <div className='flex items-center justify-between px-6 py-3 border-b border-gray-100 dark:border-gray-800'>
              <button
                onClick={() => {
                  if (downloadSelections.size === detail.episodes.length) {
                    setDownloadSelections(new Set());
                  } else {
                    setDownloadSelections(new Set(detail.episodes.map((_, i) => i)));
                  }
                }}
                className='text-xs text-blue-500 hover:text-blue-600 font-medium transition-colors'
              >
                {downloadSelections.size === detail.episodes.length ? '取消全选' : '全选'}
              </button>
              <span className='text-xs text-gray-400'>
                已选 <span className='text-green-500 font-semibold'>{downloadSelections.size}</span> / {detail.episodes.length}
              </span>
            </div>
            {/* 剧集列表 */}
            <div className='overflow-y-auto max-h-[50vh] p-4'>
              <div className='grid grid-cols-5 sm:grid-cols-6 gap-2'>
                {detail.episodes.map((url, index) => {
                  const episodeNum = index + 1;
                  const isCurrent = index === currentEpisodeIndex;
                  const isSelected = downloadSelections.has(index);
                  const isDownloaded = downloadedEpisodes.has(index);
                  const isDisabled = isDownloaded;

                  return (
                    <button
                      key={episodeNum}
                      disabled={isDisabled}
                      onClick={() => {
                        if (isDisabled) return;
                        setDownloadSelections(prev => {
                          const next = new Set(prev);
                          if (next.has(index)) next.delete(index);
                          else next.add(index);
                          return next;
                        });
                      }}
                      className={`h-10 flex items-center justify-center text-sm font-medium rounded-lg transition-all duration-200
                        ${isDisabled
                          ? 'bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                          : isSelected
                            ? 'bg-blue-500 text-white shadow-md'
                            : isCurrent
                              ? 'bg-green-500 text-white shadow-md'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400'
                        }`}
                    >
                      {isDownloaded ? (
                        <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                          <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M5 13l4 4L19 7' />
                        </svg>
                      ) : (
                        episodeNum
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* 底部确认按钮 */}
            <div className='px-6 py-4 border-t border-gray-200 dark:border-gray-700'>
              <button
                onClick={handleConfirmDownloads}
                disabled={downloadSelections.size === 0}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  downloadSelections.size > 0
                    ? 'bg-blue-500 text-white hover:bg-blue-600 active:scale-[0.98] shadow-lg shadow-blue-500/25'
                    : 'bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                }`}
              >
                {downloadSelections.size > 0
                  ? `下载 ${downloadSelections.size} 集`
                  : '请选择要下载的剧集'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </PageLayout>
  );
}

// FavoriteIcon 组件
const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-7 w-7'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='#ef4444'
          stroke='#ef4444'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }
  return (
    <Heart className='h-7 w-7 stroke-[1.5] text-gray-400 dark:text-gray-500 hover:text-red-400 dark:hover:text-red-400 transition-colors duration-200' />
  );
};

export default function PlayPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayPageClient />
    </Suspense>
  );
}
