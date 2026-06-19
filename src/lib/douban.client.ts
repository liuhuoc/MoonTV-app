import { DoubanItem, DoubanResult } from './types';
import { nativeFetch } from './capacitor-http';
import { addGlobalDebugLog } from './debug-log';

/**
 * CORS 代理列表（按优先级）
 */
const CORS_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

/**
 * 读取用户配置的豆瓣代理
 */
function getUserDoubanProxy(): { url: string; enabled: boolean } {
  if (typeof window === 'undefined') return { url: '', enabled: false };
  try {
    const enabled = localStorage.getItem('enableDoubanProxy');
    const url = localStorage.getItem('doubanProxyUrl') || '';
    return { url, enabled: enabled === 'true' };
  } catch {
    return { url: '', enabled: false };
  }
}

/**
 * 获取代理列表：用户自定义代理优先，然后才是公共代理
 */
function getProxyList(): ((url: string) => string)[] {
  const { url, enabled } = getUserDoubanProxy();
  const list: ((url: string) => string)[] = [];

  if (enabled && url) {
    // 用户自定义代理放最前面
    const userProxy = url.includes('{url}') || url.includes('%7Burl%7D')
      ? url
      : url.includes('?')
        ? `${url}${encodeURIComponent('{URL}')}`
        : `${url}?url={URL}`;
    list.push((apiPath: string) => userProxy.replace('{URL}', encodeURIComponent(apiPath)).replace('{url}', encodeURIComponent(apiPath)).replace('%7Burl%7D', encodeURIComponent(apiPath)).replace('%7BURL%7D', encodeURIComponent(apiPath)));
  }

  // 追加公共代理
  list.push(...CORS_PROXIES);
  return list;
}

/**
 * 创建带超时的 abort controller
 */
function createTimeoutController(ms: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller;
}

/**
 * 先尝试直接访问，失败后再尝试 CORS 代理
 * 直接访问成功最快，代理作为后备方案
 */
async function fetchWithCorsProxy(apiPath: string): Promise<Response> {
  // 第一步：先尝试直接访问豆瓣 API（最快）
  try {
    const directController = createTimeoutController(5000);
    const directResponse = await fetch(apiPath, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://movie.douban.com/',
      },
      signal: directController.signal,
    });
    if (directResponse.ok) {
      return directResponse;
    }
  } catch {
    // 直接访问失败（可能是 CORS 错误或网络超时），继续尝试代理
  }

  // 第二步：尝试代理（作为后备）
  // 注意：不使用 AbortController，因为 abort 会导致已成功请求的 response body 不可读
  const proxies = getProxyList();
  const TIMEOUT_MS = 6000;

  const requests = proxies.map(async (proxyFn) => {
    const proxyUrl = proxyFn(apiPath);
    const fetchPromise = fetch(proxyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
    );
    try {
      const res = await Promise.race([fetchPromise, timeout]);
      if (res.ok) {
        return res;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      throw err;
    }
  });

  try {
    return await Promise.any(requests);
  } catch {
    throw new Error('所有 CORS 代理均不可用');
  }
}

interface DoubanCategoriesParams {
  kind: 'tv' | 'movie';
  category: string;
  type: string;
  year?: string;
  sort?: string;
  pageLimit?: number;
  pageStart?: number;
  isAnimation?: boolean;
}

interface DoubanCategoryApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    card_subtitle: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

interface DoubanSubjectCollectionApiResponse {
  total: number;
  subject_collection_items: Array<{
    id: string;
    title: string;
    card_subtitle?: string;
    cover?: {
      url?: string;
    };
    cover_url?: string;
    pic?: {
      large?: string;
      normal?: string;
    };
    rating?: {
      value?: number;
    };
  }>;
}

/**
 * 缓存配置
 */
const DOUBAN_CACHE_KEY = 'douban_cache';
const DOUBAN_CACHE_TTL = 30 * 60 * 1000; // 30 分钟缓存

interface CachedData {
  data: DoubanResult;
  timestamp: number;
}

/**
 * 生成缓存 Key - 根据请求参数唯一标识
 */
function getCacheKey(params: DoubanCategoriesParams): string {
  return `${DOUBAN_CACHE_KEY}_${params.kind}_${params.category}_${params.type}_${params.year}_${params.sort}_${params.pageStart}_${params.pageLimit}`;
}

/**
 * 从 localStorage 读取缓存
 */
function readCache(key: string): DoubanResult | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const cached: CachedData = JSON.parse(raw);
    // 检查是否过期
    if (Date.now() - cached.timestamp > DOUBAN_CACHE_TTL) {
      localStorage.removeItem(key);
      return null;
    }
    return cached.data;
  } catch {
    return null;
  }
}

/**
 * 写入缓存到 localStorage
 */
function writeCache(key: string, data: DoubanResult): void {
  if (typeof window === 'undefined') return;
  try {
    const cached: CachedData = {
      data,
      timestamp: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(cached));
  } catch {
    // localStorage 满了，忽略错误
  }
}

/**
 * 检查是否应该使用客户端获取豆瓣数据
 */
export function shouldUseDoubanClient(): boolean {
  // 纯客户端模式下始终使用客户端获取
  return true;
}

/**
 * 客户端豆瓣分类数据获取函数（使用 Capacitor HTTP 绕过 CORS）
 * 支持 localStorage 缓存，命中缓存直接返回，30 分钟过期
 */
export async function getDoubanCategories(
  params: DoubanCategoriesParams
): Promise<DoubanResult> {
  const { kind, category, type, year, sort, pageLimit = 20, pageStart = 0 } = params;

  if (!['tv', 'movie'].includes(kind)) {
    return {
      code: 400,
      message: 'kind 参数必须是 tv 或 movie',
      list: [],
    };
  }

  if (!category || !type) {
    return {
      code: 400,
      message: 'category 和 type 参数不能为空',
      list: [],
    };
  }

  const movieGenresFromSelector = new Set([
    '剧情', '喜剧', '爱情', '动作',
    '科幻', '悬疑', '犯罪', '恐怖',
    '奇幻', '冒险', '动画', '热血', '搞笑',
  ]);
  const movieRegionsFromSelector = new Set([
    '全部', '大陆', '美国', '香港', '台湾', '日本', '韩国', '英国',
  ]);
  const currentYear = new Date().getFullYear();
  const movieYearsFromSelector = new Set(
    Array.from({ length: 10 }, (_, idx) => String(currentYear - idx))
  );

  const tvShowTags: Record<string, string> = {
    'tv': '电视剧',
    'tv_domestic': '国产剧',
    'tv_american': '欧美剧',
    'tv_japanese': '日剧',
    'tv_korean': '韩剧',
    'tv_animation': '动漫',
    'tv_documentary': '纪录片',
    'show': '综艺',
    'show_domestic': '国内综艺',
    'show_foreign': '国外综艺',
  };

  const animationRegionTags: Record<string, string | undefined> = {
    '全部': '',
    '日本': '日本动画',
    '大陆': '国产动画',
    '美国': '欧美动画',
  };

  const isAnimationFilter =
    params.isAnimation === true &&
    kind === 'movie' &&
    animationRegionTags[type] !== undefined;

  const isTVShowFilter =
    (kind === 'tv' && (category === 'tv' || category === 'show')) ||
    (kind === 'movie' && tvShowTags[category]);

  const isMovieTagsFilter =
    kind === 'movie' &&
    (category === '全部' || category === '热门' || movieGenresFromSelector.has(category)) &&
    (isAnimationFilter || movieRegionsFromSelector.has(type)) &&
    (!year || year === '全部' || movieYearsFromSelector.has(year));

  const isMovieSubjectCollection =
    kind === 'movie' && category.startsWith('movie_');

  const tags = isAnimationFilter
    ? [
        '动画',
        animationRegionTags[type] || '',
      ].filter((v): v is string => Boolean(v))
    : isMovieTagsFilter
      ? [(category === '全部' || category === '热门') ? null : category, type === '全部' ? null : type].filter(
          (v): v is string => Boolean(v)
        )
      : isTVShowFilter
        ? [tvShowTags[category] || category, type === '全部' || type === category ? null : tvShowTags[type] || type].filter(
            (v): v is string => Boolean(v)
          )
        : [];
  const yearRange =
    isMovieTagsFilter && year && year !== '全部' ? `${year},${year}` : null;
  const sortValue =
    sort === '人气' ? 'U'
    : sort === '评分' ? 'S'
    : sort === '时间' ? 'T'
    : category === '热门' ? 'U'
    : sort && ['T', 'U', 'S', 'R'].includes(sort) ? sort : 'T';

  const target = isMovieSubjectCollection
    ? `https://m.douban.com/rexxar/api/v2/subject_collection/${category}/items?start=${pageStart}&count=${pageLimit}`
    : (isMovieTagsFilter || isAnimationFilter)
      ? (() => {
          const searchParams = new URLSearchParams({
            sort: sortValue,
            range: '0,10',
            tags: tags.join(','),
            start: String(pageStart),
            count: String(pageLimit),
          });
          if (yearRange) {
            searchParams.set('year_range', yearRange);
          }
          return `https://movie.douban.com/j/new_search_subjects?${searchParams}`;
        })()
      : `https://m.douban.com/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${category}&type=${type}`;

  // 检查缓存（第一页才缓存，翻页数据不缓存）
  const cacheKey = getCacheKey(params);
  if (pageStart === 0) {
    const cached = readCache(cacheKey);
    if (cached) {
      addGlobalDebugLog(`豆瓣API: localStorage缓存命中 ${params.kind}/${params.category}/${params.type} count=${cached.list.length}`);
      return cached;
    }
  }

  try {
    addGlobalDebugLog(`豆瓣API: 请求 ${params.kind}/${params.category}/${params.type} pageStart=${pageStart}`);
    // Capacitor 原生环境：通过 CapacitorHttp 直连（绕过 CORS）
    // 浏览器环境：nativeFetch 内部回退到原生 fetch
    // 失败时回退到 CORS 代理
    let response: Response;
    try {
      response = await nativeFetch(target, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          Referer: isMovieTagsFilter ? 'https://movie.douban.com/explore' : 'https://movie.douban.com/',
          Accept: 'application/json, text/plain, */*',
        },
        timeout: 10000,
      });
    } catch {
      // nativeFetch 失败，回退到 CORS 代理
      response = await fetchWithCorsProxy(target);
    }

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const responseJson = await response.json();
    addGlobalDebugLog(`豆瓣API: ${params.kind}/${params.category}/${params.type} 响应 OK`);

    let list: DoubanItem[];
    if (isMovieSubjectCollection) {
      const doubanData = responseJson as DoubanSubjectCollectionApiResponse;
      list = doubanData.subject_collection_items.map((item) => ({
        id: item.id,
        title: item.title,
        poster:
          item.pic?.normal ||
          item.pic?.large ||
          item.cover?.url ||
          item.cover_url ||
          '',
        rate:
          item.rating?.value !== undefined
            ? Number(item.rating.value).toFixed(1)
            : '',
        year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
      }));
    } else if (isMovieTagsFilter || isAnimationFilter) {
      const doubanData = responseJson as any;
      const dataArray = doubanData?.data;
      // 豆瓣 API 可能返回限流响应：{msg: "检测到有异常请求...", r: 1}
      if (!Array.isArray(dataArray)) {
        if (doubanData?.r !== undefined && doubanData?.msg) {
          // 被限流了，等 1~2 秒重试一次
          addGlobalDebugLog(`豆瓣API: ${params.kind}/${params.category}/${params.type} 被限流，1.5s后重试...`);
          await new Promise(r => setTimeout(r, 1500));
          const retryResp = await nativeFetch(target, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
              Referer: 'https://movie.douban.com/explore',
              Accept: 'application/json, text/plain, */*',
            },
            timeout: 10000,
          }).catch(() => null);
          if (retryResp && retryResp.ok) {
            const retryJson = await retryResp.json() as any;
            const retryData = retryJson?.data;
            if (Array.isArray(retryData)) {
              addGlobalDebugLog(`豆瓣API: ${params.kind}/${params.category}/${params.type} 重试成功 count=${retryData.length}`);
              list = retryData.slice(0, pageLimit).map((item: any) => ({
                id: item.id,
                title: item.title,
                poster: item.cover,
                rate: item.rate,
                year: year && year !== '全部' ? year : '',
              }));
            } else {
              list = [];
            }
          } else {
            list = [];
          }
        } else if (Array.isArray(responseJson)) {
          list = responseJson.slice(0, pageLimit).map((item: any) => ({
            id: item.id,
            title: item.title,
            poster: item.cover,
            rate: item.rate,
            year: year && year !== '全部' ? year : '',
          }));
        } else {
          list = [];
        }
      } else {
        addGlobalDebugLog(`豆瓣API: ${params.kind}/${params.category}/${params.type} 解析 data.length=${dataArray.length}`);
        list = dataArray.slice(0, pageLimit).map((item: any) => ({
          id: item.id,
          title: item.title,
          poster: item.cover,
          rate: item.rate,
          year: year && year !== '全部' ? year : '',
        }));
      }
    } else {
      const doubanData = responseJson as DoubanCategoryApiResponse;
      list = doubanData.items.map((item) => ({
        id: item.id,
        title: item.title,
        poster: item.pic?.normal || item.pic?.large || '',
        rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
        year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
      }));
    }

    const result = {
      code: 200,
      message: '获取成功',
      list,
    };

    // 只有第一页缓存，翻页数据不缓存
    if (pageStart === 0) {
      writeCache(cacheKey, result);
    }

    return result;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
    addGlobalDebugLog(`豆瓣API: ${params.kind}/${params.category}/${params.type} 失败 ${errMsg.substring(0, 80)}`);
    throw new Error(`获取豆瓣分类数据失败: ${errMsg}`);
  }
}