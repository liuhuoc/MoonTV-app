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
import { processImageUrl } from '@/lib/utils';
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

  // 保存优选时的测速结果，避免EpisodeSelector重复测速
  const [precomputedVideoInfo] = useState<
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

  // 手势控制相关状态
  const [gestureState, setGestureState] = useState<{
    active: boolean;
    type: 'volume' | 'brightness' | 'none';
    value: number;
    initialValue: number;
  }>({
    active: false,
    type: 'none',
    value: 0,
    initialValue: 0,
  });
  const gestureStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const [brightness, setBrightness] = useState(1);
  const brightnessRef = useRef(1);
  const isFullscreenRef = useRef(false);

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

  //  -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

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

// 自定义 HLS.js Loader：用于远程播放时过滤广告
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

  // 本地视频 HLS.js Loader：从文件系统按需加载分段，实现点开即播
  class LocalVideoLoader {
    private stats: any;

    constructor() {
      this.stats = {
        aborted: false,
        loaded: 0,
        total: 0,
        retry: 0,
        chunkCount: 0,
        bwEstimate: 0,
        loading: { start: 0, first: 0, end: 0 },
        parsing: { start: 0, end: 0 },
        buffering: { start: 0, first: 0, end: 0 },
      };
    }

    load(context: any, config: any, callbacks: any) {
      const ctx = (window as any).__localVideoCtx;
      if (!ctx) {
        callbacks.onError({ type: 'networkError', details: 'loaderError', fatal: false }, context);
        return;
      }

      try {
        // HLS.js fragment context 用 context.frag 标识，manifest/level 用 context.type
        if (context.frag) {
          // 片段加载：从 URL 中提取分段索引
          const match = context.url.match(/seg_(\d+)\.ts/);
          if (!match) {
            callbacks.onError({ type: 'networkError', details: 'loaderError', fatal: false }, context);
            return;
          }
          const segIndex = parseInt(match[1], 10);
          this.loadSegment(ctx, segIndex, callbacks, context);
        } else {
          // manifest / level 加载：直接返回 M3U8 内容
          this.stats.loading.start = performance.now();
          this.stats.loading.first = performance.now();
          this.stats.loading.end = performance.now();
          this.stats.loaded = ctx.m3u8Content.length;
          this.stats.total = ctx.m3u8Content.length;
          callbacks.onSuccess(
            { url: context.url, data: ctx.m3u8Content },
            this.stats,
            context
          );
        }
      } catch (e) {
        callbacks.onError({ type: 'networkError', details: 'loaderError', fatal: false }, context);
      }
    }

    private async loadSegment(ctx: any, segIndex: number, callbacks: any, context: any) {
      try {
        if (ctx.segmentCache.has(segIndex)) {
          const data = ctx.segmentCache.get(segIndex);
          this.stats.loading.start = performance.now();
          this.stats.loading.first = performance.now();
          this.stats.loading.end = performance.now();
          this.stats.loaded = data.byteLength;
          this.stats.total = data.byteLength;
          callbacks.onSuccess(
            { url: context.url, data },
            this.stats,
            context
          );
          return;
        }

        let arrayBuffer: ArrayBuffer;
        if (ctx.writeDirectory === 'IndexedDB') {
          const buf = await ctx.browserReadSegment(ctx.taskId, segIndex + 1);
          arrayBuffer = buf;
        } else {
          const { Filesystem } = await import('@capacitor/filesystem');
          const segFileName = `seg_${String(segIndex).padStart(5, '0')}.ts`;
          const segPath = `${ctx.dirPath}/${segFileName}`;
          const segResult = await Filesystem.readFile({ path: segPath, directory: ctx.writeDirEnum });
          const base64 = segResult.data as string;
          const binaryStr = atob(base64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
          arrayBuffer = bytes.buffer;
        }

        ctx.segmentCache.set(segIndex, arrayBuffer);
        this.stats.loading.start = performance.now();
        this.stats.loading.first = performance.now();
        this.stats.loading.end = performance.now();
        this.stats.loaded = arrayBuffer.byteLength;
        this.stats.total = arrayBuffer.byteLength;

        callbacks.onSuccess(
          { url: context.url, data: arrayBuffer },
          this.stats,
          context
        );
      } catch (e) {
        callbacks.onError(
          { type: 'networkError', details: 'loaderError', fatal: false, error: e },
          context
        );
      }
    }

    abort() {
      this.stats.aborted = true;
    }

    destroy() {
      this.stats.aborted = true;
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
        }).catch(() => {
          // 忽略后台加载失败
        });

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

      // 本地文件播放：使用 HLS.js 加载 M3U8 播放列表
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
          poster: dlTask.poster || '',
          episodes: [dlTask.localPath],
          douban_id: 0,
        } as any);

        try {
          setLoadingMessage('正在读取视频信息...');

          // 读取 M3U8 获取分段信息
          const segmentDurations: number[] = [];
          let playlistContent: string;
          let dirPath = '';
          let writeDirEnum: any;

          if (dlTask.writeDirectory === 'IndexedDB') {
            playlistContent = await browserReadPlaylist(currentId || dlTask.id);
          } else {
            if (!dlTask.writeDirectory) {
              setError('已下载文件信息不完整，请重新下载');
              setLoading(false);
              return;
            }
            writeDirEnum = dlTask.writeDirectory === 'Library' ? Directory.Library : Directory.Data;
            const result = await Filesystem.readFile({ path: dlTask.localPath, directory: writeDirEnum });
            try {
              playlistContent = atob(result.data as string);
            } catch {
              playlistContent = result.data as string;
            }
            dirPath = dlTask.localPath.replace(/\/playlist\.m3u8$/, '');
          }

          // 解析分段时长
          const extinfRegex = /#EXTINF:([\d.]+)/g;
          let match;
          while ((match = extinfRegex.exec(playlistContent)) !== null) {
            segmentDurations.push(parseFloat(match[1]));
          }

          const segCount = segmentDurations.length;
          if (segCount === 0) {
            setError('视频分段信息不完整');
            setLoading(false);
            return;
          }

          // 构建 M3U8，使用相对路径（由 LocalVideoLoader 按需加载）
          const m3u8Lines = [
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...segmentDurations))}`,
            '#EXT-X-MEDIA-SEQUENCE:0',
            '#EXT-X-PLAYLIST-TYPE:VOD',
          ];
          for (let i = 0; i < segCount; i++) {
            m3u8Lines.push(`#EXTINF:${segmentDurations[i].toFixed(3)},`);
            m3u8Lines.push(`seg_${String(i).padStart(5, '0')}.ts`);
          }
          m3u8Lines.push('#EXT-X-ENDLIST');
          const m3u8Content = m3u8Lines.join('\n');

          // 预加载前 3 个分段，加快启动
          setLoadingMessage('正在预加载视频...');
          const preloadCount = Math.min(3, segCount);
          const preloadCache = new Map<number, ArrayBuffer>();
          await Promise.all(Array.from({ length: preloadCount }, async (_, i) => {
            const segFileName = `seg_${String(i).padStart(5, '0')}.ts`;
            if (dlTask.writeDirectory === 'IndexedDB') {
              const buf = await browserReadSegment(currentId || dlTask.id, i + 1);
              preloadCache.set(i, buf);
            } else {
              const segPath = `${dirPath}/${segFileName}`;
              const segResult = await Filesystem.readFile({ path: segPath, directory: writeDirEnum });
              const base64 = segResult.data as string;
              const binaryStr = atob(base64);
              const bytes = new Uint8Array(binaryStr.length);
              for (let j = 0; j < binaryStr.length; j++) bytes[j] = binaryStr.charCodeAt(j);
              preloadCache.set(i, bytes.buffer);
            }
          }));

          // 计算总时长
          const totalDuration = segmentDurations.reduce((a, b) => a + b, 0);

          // 保存上下文供 LocalVideoLoader 使用
          (window as any).__localVideoCtx = {
            m3u8Content,
            segmentCache: preloadCache,
            writeDirectory: dlTask.writeDirectory,
            writeDirEnum,
            dirPath,
            taskId: currentId || dlTask.id,
            browserReadSegment,
            totalDuration,
          };
          // 创建 M3U8 blob URL
          const m3u8Blob = new Blob([m3u8Content], { type: 'application/vnd.apple.mpegurl' });
          const blobUrl = URL.createObjectURL(m3u8Blob);
          setVideoUrl(blobUrl);
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

      const detailData: SearchResult = sourcesInfo[0];

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

      // 清除前一个历史记录
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deletePlayRecord(
            currentSourceRef.current,
            currentIdRef.current
          );
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

      // 尝试跳转到当前正在播放的集数
      let targetIndex = currentEpisodeIndex;

      // 获取新源详情
      const newDetail = availableSources.find(
        (source) => source.source === newSource && source.id === newId
      );
      if (!newDetail) {
        setError('未找到匹配结果');
        setIsVideoLoading(false);
        return;
      }

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
  // 手势控制
  // ---------------------------------------------------------------------------
  const handleGestureStart = (e: React.TouchEvent) => {
    if (!artPlayerRef.current || !isFullscreenRef.current) return;
    const touch = e.touches[0];
    const container = e.currentTarget as HTMLElement;
    const rect = container.getBoundingClientRect();
    
    gestureStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };

    const relativeX = touch.clientX - rect.left;
    const isLeftSide = relativeX < rect.width / 2;

    const initialValue = isLeftSide 
      ? brightnessRef.current 
      : artPlayerRef.current.volume;

    setGestureState({
      active: true,
      type: isLeftSide ? 'brightness' : 'volume',
      value: initialValue,
      initialValue,
    });
  };

  const handleGestureMove = (e: React.TouchEvent) => {
    if (!gestureStartRef.current || !gestureState.active || !artPlayerRef.current) return;
    
    const touch = e.touches[0];
    const container = e.currentTarget as HTMLElement;
    const rect = container.getBoundingClientRect();
    
    const deltaY = gestureStartRef.current.y - touch.clientY;
    const maxChange = rect.height * 0.6;
    const normalizedDelta = Math.max(-1, Math.min(1, deltaY / maxChange));

    if (gestureState.type === 'volume') {
      const newVolume = Math.max(0, Math.min(1, gestureState.initialValue + normalizedDelta));
      const roundedVolume = Math.round(newVolume * 100) / 100;
      artPlayerRef.current.volume = roundedVolume;
      lastVolumeRef.current = roundedVolume;
      setGestureState(prev => ({ ...prev, value: roundedVolume }));
    } else if (gestureState.type === 'brightness') {
      const newBrightness = Math.max(0.2, Math.min(1, gestureState.initialValue + normalizedDelta * 0.8));
      const roundedBrightness = Math.round(newBrightness * 100) / 100;
      brightnessRef.current = roundedBrightness;
      setBrightness(roundedBrightness);
      // 直接应用到视频播放器元素，确保全屏时也生效
      const videoPlayer = document.querySelector('.art-video-player');
      if (videoPlayer) {
        (videoPlayer as HTMLElement).style.filter = `brightness(${roundedBrightness})`;
      }
      setGestureState(prev => ({ ...prev, value: roundedBrightness }));
    }
  };

  const handleGestureEnd = () => {
    gestureStartRef.current = null;
    setTimeout(() => {
      setGestureState({
        active: false,
        type: 'none',
        value: 0,
        initialValue: 0,
      });
    }, 500);
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
        // 忽略错误
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
    // 清除本地视频上下文，防止远程视频错误使用 LocalVideoLoader
    if (!isLocalPlayback) {
      delete (window as any).__localVideoCtx;
    }

    try {
      // 创建新的播放器实例
      Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
      Artplayer.USE_RAF = true;

      artPlayerRef.current = new Artplayer({
        container: artRef.current,
        url: videoUrl,
        // 本地播放使用 M3U8 播放列表，需要指定 type 让 Artplayer 调用 customType.m3u8
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
        fullscreenWeb: false,
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
                return;
              }

              if (video.hls) {
                video.hls.destroy();
              }

              let hls: Hls;
              try {
                // 本地视频使用 LocalVideoLoader 从文件系统按需加载分段
                // 在线视频使用 CustomHlsJsLoader（去广告）或默认 loader
                let loaderClass: any;
                if ((window as any).__localVideoCtx) {
                  loaderClass = LocalVideoLoader;
                } else if (blockAdEnabledRef.current) {
                  loaderClass = CustomHlsJsLoader;
                } else {
                  loaderClass = Hls.DefaultConfig.loader;
                }

                const isLocal = !!(window as any).__localVideoCtx;
                const hlsConfig: any = {
                  debug: false,
                  enableWorker: true,
                  lowLatencyMode: false,
                  // autoStartLoad: false 只对本地视频生效（本地视频 manifest 同步加载，需手动控制时序）
                  // 在线视频 manifest 异步加载，必须用默认的 true 否则 startLoad 不会被调用
                  autoStartLoad: !isLocal,

                  /* 缓冲/内存相关 */
                  // 本地视频：片段从文件系统按需加载，速度极快，使用大缓冲区避免 evict 导致回拖卡住
                  // 在线视频：保持默认限制，防止内存占用过大
                  maxBufferLength: isLocal ? 3600 : 30,
                  backBufferLength: isLocal ? 3600 : 30,
                  maxBufferSize: isLocal ? 0 : 60 * 1000 * 1000, // 0 = 不限制

                  /* 自定义loader */
                  loader: loaderClass,
                };

                hls = new Hls(hlsConfig);
              } catch (e) {
                return;
              }

              try {
                hls.attachMedia(video);
                video.hls = hls;

                // 事件处理器必须在 loadSource 之前注册
                // 因为 manifest 加载在 loadSource 内部同步完成

                let savedLevels: any = null;
                hls.on(Hls.Events.MANIFEST_PARSED, (_event: any, data: any) => {
                  savedLevels = data.levels; // 保存 levels，等 MANIFEST_LOADING 监听器全部执行完后再恢复
                });

                hls.on(Hls.Events.ERROR, function (event: any, data: any) {
                  if (data.details === 'bufferFullError') {
                    return;
                  }
                  if (data.fatal) {
                    switch (data.type) {
                      case Hls.ErrorTypes.NETWORK_ERROR:
                        hls.startLoad();
                        break;
                      case Hls.ErrorTypes.MEDIA_ERROR:
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
                        hls.destroy();
                        break;
                    }
                  }
                });

                hls.loadSource(url);

                // 根因：MANIFEST_LOADING 监听器执行顺序导致
                // 1. PlaylistLoader.onManifestLoading → 同步加载 manifest → sc.levels 被设置
                // 2. LevelController.onManifestLoading → _levels = []
                // 3. BaseStreamController.onManifestLoading → sc.levels = null (重置!)
                // 所以必须在所有 MANIFEST_LOADING 监听器执行完后，恢复状态再调用 startLoad
                setTimeout(() => {
                  const sc = (hls as any).streamController;
                  const lc = (hls as any).levelController;
                  if (savedLevels && savedLevels.length > 0) {
                    // 恢复被 onManifestLoading 重置的状态
                    sc.levels = savedLevels;
                    lc._levels = savedLevels;
                    sc.levelLastLoaded = savedLevels[0];
                    hls.startLoad();
                  }

                  // 修复：本地视频进度条首次点击跳到末尾的问题
                  // MediaSource 播放时 video.duration 初始为 NaN，
                  // 用 M3U8 已知总时长覆盖 duration getter，确保进度条可用
                  const localCtx = (window as any).__localVideoCtx;
                  if (localCtx?.totalDuration && localCtx.totalDuration > 0) {
                    const knownDuration = localCtx.totalDuration;
                    try {
                      Object.defineProperty(video, 'duration', {
                        get() { return knownDuration; },
                        configurable: true,
                      });
                    } catch {
                      // ignore
                    }
                  }
                }, 0);
              } catch (e) {
                return;
              }
              ensureVideoSource(video, url);
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
        
        // 给播放器元素绑定手势控制
        const playerEl = document.querySelector('.art-video-player') as HTMLElement;
        if (playerEl && !playerEl.dataset.gestureBound) {
          playerEl.dataset.gestureBound = 'true';
          
          let localGestureStart: { x: number; y: number; time: number } | null = null;
          let localGestureType: 'volume' | 'brightness' | 'none' = 'none';
          let localInitialValue = 0;
          let localGestureActive = false;
          let indicatorTimeout: NodeJS.Timeout | null = null;
          
          // 创建指示器容器
          const indicatorContainer = document.createElement('div');
          indicatorContainer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:99999;';
          indicatorContainer.className = 'gesture-indicator-container';
          playerEl.appendChild(indicatorContainer);
          
          const showIndicator = (type: 'volume' | 'brightness', value: number) => {
            if (indicatorTimeout) {
              clearTimeout(indicatorTimeout);
            }
            indicatorContainer.innerHTML = '';
            
            const isLeft = type === 'brightness';
            
            // 进度条
            const progressBar = document.createElement('div');
            progressBar.style.cssText = `
              position: absolute;
              ${isLeft ? 'left: 20px;' : 'right: 20px;'}
              top: 50%;
              transform: translateY(-50%);
              width: 4px;
              height: 120px;
              background: rgba(255,255,255,0.3);
              border-radius: 2px;
              overflow: hidden;
            `;
            
            const progressFill = document.createElement('div');
            const percent = type === 'brightness' 
              ? Math.max(0, Math.min(100, ((value - 0.2) / 0.8) * 100))
              : value * 100;
            progressFill.style.cssText = `
              position: absolute;
              bottom: 0;
              left: 0;
              width: 100%;
              height: ${percent}%;
              background: ${isLeft ? 'linear-gradient(to top, #fbbf24, #f59e0b)' : 'linear-gradient(to top, #22c55e, #16a34a)'};
              border-radius: 2px;
              transition: height 0.1s ease;
            `;
            progressBar.appendChild(progressFill);
            indicatorContainer.appendChild(progressBar);
            
            // 指示器图标和数值
            const indicator = document.createElement('div');
            indicator.style.cssText = `
              position: absolute;
              ${isLeft ? 'left: 40px;' : 'right: 40px;'}
              top: 50%;
              transform: translateY(-50%);
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 8px;
              color: white;
              font-size: 14px;
              font-weight: 500;
              text-shadow: 0 1px 3px rgba(0,0,0,0.5);
            `;
            
            const iconSvg = isLeft 
              ? `<svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                   <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                 </svg>`
              : (value > 0.5 
                  ? `<svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                       <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                     </svg>`
                  : value > 0 
                    ? `<svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                         <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                       </svg>`
                    : `<svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                         <path stroke-linecap="round" stroke-linejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                       </svg>`
                );
            
            const displayPercent = type === 'brightness'
              ? Math.round(((value - 0.2) / 0.8) * 100)
              : Math.round(value * 100);
            
            indicator.innerHTML = `${iconSvg}<span>${displayPercent}%</span>`;
            indicatorContainer.appendChild(indicator);
          };
          
          const hideIndicator = () => {
            if (indicatorTimeout) {
              clearTimeout(indicatorTimeout);
            }
            indicatorTimeout = setTimeout(() => {
              indicatorContainer.innerHTML = '';
            }, 500);
          };
          
          playerEl.addEventListener('touchstart', (e) => {
            if (!artPlayerRef.current || !isFullscreenRef.current) return;
            if (e.touches.length !== 1) return;
            
            const touch = e.touches[0];
            const rect = playerEl.getBoundingClientRect();
            const relativeX = touch.clientX - rect.left;
            const edgeWidth = rect.width * 0.2; // 左右各20%边缘区域
            
            // 只在左右边缘区域内才触发手势控制
            const isLeftEdge = relativeX < edgeWidth;
            const isRightEdge = relativeX > rect.width - edgeWidth;
            if (!isLeftEdge && !isRightEdge) return;
            
            localGestureStart = {
              x: touch.clientX,
              y: touch.clientY,
              time: Date.now(),
            };
            
            localGestureType = isLeftEdge ? 'brightness' : 'volume';
            localInitialValue = isLeftEdge 
              ? brightnessRef.current 
              : artPlayerRef.current.volume;
          }, { passive: true });
          
          playerEl.addEventListener('touchmove', (e) => {
            if (!localGestureStart || !artPlayerRef.current || !isFullscreenRef.current) return;
            if (e.touches.length !== 1) return;
            
            const touch = e.touches[0];
            const rect = playerEl.getBoundingClientRect();
            const deltaY = localGestureStart.y - touch.clientY;
            
            // 最小滑动距离阈值，避免轻微触碰就触发
            const minDelta = 10;
            if (Math.abs(deltaY) < minDelta && !localGestureActive) {
              return;
            }
            localGestureActive = true;
            
            const maxChange = rect.height * 0.6;
            const normalizedDelta = Math.max(-1, Math.min(1, deltaY / maxChange));
            
            if (localGestureType === 'volume') {
              const newVolume = Math.max(0, Math.min(1, localInitialValue + normalizedDelta));
              const roundedVolume = Math.round(newVolume * 100) / 100;
              artPlayerRef.current.volume = roundedVolume;
              lastVolumeRef.current = roundedVolume;
              showIndicator('volume', roundedVolume);
            } else if (localGestureType === 'brightness') {
              const newBrightness = Math.max(0.2, Math.min(1, localInitialValue + normalizedDelta * 0.8));
              const roundedBrightness = Math.round(newBrightness * 100) / 100;
              brightnessRef.current = roundedBrightness;
              setBrightness(roundedBrightness);
              // 应用到播放器元素
              playerEl.style.filter = `brightness(${roundedBrightness})`;
              showIndicator('brightness', roundedBrightness);
            }
          }, { passive: true });
          
          playerEl.addEventListener('touchend', () => {
            localGestureStart = null;
            localGestureType = 'none';
            localGestureActive = false;
            hideIndicator();
          });
        }
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
            
            // 确保视频和音频同步，强制刷新播放状态
            setTimeout(() => {
              if (artPlayerRef.current && artPlayerRef.current.video) {
                const video = artPlayerRef.current.video;
                if (!video.paused) {
                  video.pause();
                  setTimeout(() => {
                    video.play().catch(() => {
                      // 自动播放失败，需要用户手动点击播放
                    });
                  }, 100);
                }
              }
            }, 500);
          } catch (err) {
            // 恢复播放进度失败
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
            setCurrentEpisodeIndex(idx + 1);
          }
        }
      });

      // 监听 video 元素原生错误事件（更底层的错误捕获）
      if (artPlayerRef.current?.video) {
        const videoEl = artPlayerRef.current.video as HTMLVideoElement;
        videoEl.addEventListener('error', () => {
          // 视频加载错误
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
        isFullscreenRef.current = state;
        if (typeof window !== 'undefined') {
          if (state) {
            // 进入全屏时，强制横屏
            try {
              await ScreenOrientation.lock({ orientation: 'landscape' });
            } catch (e) {
              // 如果Capacitor失败，尝试使用Web API
              try {
                if ('orientation' in screen && 'lock' in screen.orientation) {
                  await (screen.orientation as any).lock('landscape');
                }
              } catch (webError) {
                // Web Screen Orientation API也失败
              }
            }
            
            // 隐藏移动端状态栏
            try {
              await StatusBar.hide();
            } catch (e) {
              // 状态栏隐藏失败
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
              }
            }, 2000);
          } else {
            // 退出全屏时，恢复正常
            try {
              await ScreenOrientation.unlock();
            } catch {
              // 如果Capacitor失败，尝试使用Web API
              try {
                if ('orientation' in screen && 'unlock' in screen.orientation) {
                  (screen.orientation as any).unlock();
                }
              } catch {
                // Web Screen Orientation API解锁失败
              }
            }
            
            // 恢复状态栏显示
            try {
              await StatusBar.show();
            } catch {
              // 状态栏恢复显示失败
            }
            
            // 恢复播放器控制栏
            if (artPlayerRef.current) {
              artPlayerRef.current.controls = true;
            }
            
            // 恢复CSS样式（先恢复视频容器样式）
            const videoContainer = document.querySelector('.art-video-player');
            if (videoContainer) {
              const container = videoContainer as HTMLElement;
              container.style.filter = '';
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
            
            // 延迟恢复viewport，确保状态栏完全显示后再更新safe-area
            setTimeout(() => {
              const metaViewport = document.querySelector('meta[name="viewport"]');
              if (metaViewport) {
                metaViewport.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
              }
              // 强制触发重排，确保safe-area-inset正确计算
              const header = document.querySelector('.mobile-header-safe');
              if (header) {
                const el = header as HTMLElement;
                el.style.display = 'none';
                // 触发reflow
                void el.offsetHeight;
                el.style.display = '';
              }
            }, 50);
          }
        }
      });

      // 网页全屏事件监听
      artPlayerRef.current.on('fullscreenWeb', async (state: boolean) => {
        isFullscreenRef.current = state;
        if (typeof window !== 'undefined') {
          if (state) {
            // 进入网页全屏时，强制横屏
            try {
              await ScreenOrientation.lock({ orientation: 'landscape' });
            } catch {
              // 如果Capacitor失败，尝试使用Web API
              try {
                if ('orientation' in screen && 'lock' in screen.orientation) {
                  await (screen.orientation as any).lock('landscape');
                }
              } catch {
                // Web Screen Orientation API也失败
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
            } catch (e) {
              // 如果Capacitor失败，尝试使用Web API
              try {
                if ('orientation' in screen && 'unlock' in screen.orientation) {
                  (screen.orientation as any).unlock();
                }
              } catch (webError) {
                // Web Screen Orientation API解锁失败
              }
            }
            
            // 恢复CSS样式（先恢复视频容器样式）
            const videoContainer = document.querySelector('.art-video-player');
            if (videoContainer) {
              const container = videoContainer as HTMLElement;
              container.style.filter = '';
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
            
            // 延迟恢复viewport，确保状态栏完全显示后再更新safe-area
            setTimeout(() => {
              const metaViewport = document.querySelector('meta[name="viewport"]');
              if (metaViewport) {
                metaViewport.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
              }
              // 强制触发重排，确保safe-area-inset正确计算
              const header = document.querySelector('.mobile-header-safe');
              if (header) {
                const el = header as HTMLElement;
                el.style.display = 'none';
                // 触发reflow
                void el.offsetHeight;
                el.style.display = '';
              }
            }, 50);
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
      console.error(`创建播放器失败: ${(err as Error).message || JSON.stringify(err)}`);
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
              <div 
                className='relative w-full h-[300px] lg:h-full'
                onTouchStart={handleGestureStart}
                onTouchMove={handleGestureMove}
                onTouchEnd={handleGestureEnd}
              >
                <div
                  ref={artRef}
                  className='bg-black w-full h-full rounded-2xl overflow-hidden shadow-lg'
                  style={{ 
                    filter: `brightness(${brightness})`,
                    transition: gestureState.active ? 'none' : 'filter 0.3s ease'
                  }}
                />

                {/* 亮度/音量手势指示器 */}
                {gestureState.active && (
                  <>
                    {/* 左侧亮度指示器 */}
                    {gestureState.type === 'brightness' && (
                      <>
                        <div className='gesture-progress-bar gesture-progress-bar-left'>
                          <div 
                            className='gesture-progress-fill'
                            style={{ 
                              height: `${Math.max(0, Math.min(100, ((gestureState.value - 0.2) / 0.8) * 100))}%`,
                              background: 'linear-gradient(to top, #fbbf24, #f59e0b)'
                            }}
                          />
                        </div>
                        <div className='gesture-indicator gesture-indicator-left show'>
                          <svg className='w-5 h-5' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
                            <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} 
                              d='M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z' />
                          </svg>
                          <span>{Math.round(((gestureState.value - 0.2) / 0.8) * 100)}%</span>
                        </div>
                      </>
                    )}
                    
                    {/* 右侧音量指示器 */}
                    {gestureState.type === 'volume' && (
                      <>
                        <div className='gesture-progress-bar gesture-progress-bar-right'>
                          <div 
                            className='gesture-progress-fill'
                            style={{ height: `${gestureState.value * 100}%` }}
                          />
                        </div>
                        <div className='gesture-indicator gesture-indicator-right show'>
                          <svg className='w-5 h-5' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
                            {gestureState.value > 0.5 ? (
                              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} 
                                d='M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z' />
                            ) : gestureState.value > 0 ? (
                              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} 
                                d='M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z' />
                            ) : (
                              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} 
                                d='M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2' />
                            )}
                          </svg>
                          <span>{Math.round(gestureState.value * 100)}%</span>
                        </div>
                      </>
                    )}
                  </>
                )}

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
