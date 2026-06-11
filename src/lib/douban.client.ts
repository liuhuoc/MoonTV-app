import { DoubanItem, DoubanResult } from './types';
import { nativeFetch } from './capacitor-http';

interface DoubanCategoriesParams {
  kind: 'tv' | 'movie';
  category: string;
  type: string;
  year?: string;
  sort?: string;
  pageLimit?: number;
  pageStart?: number;
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
 * 客户端豆瓣分类数据获取函数（使用 Capacitor HTTP 绕过 CORS）
 */
export async function getDoubanCategories(
  params: DoubanCategoriesParams
): Promise<DoubanResult> {
  const { kind, category, type, year, sort, pageLimit = 20, pageStart = 0 } = params;

  if (!['tv', 'movie'].includes(kind)) {
    throw new Error('kind 参数必须是 tv 或 movie');
  }

  if (!category || !type) {
    throw new Error('category 和 type 参数不能为空');
  }

  const movieGenresFromSelector = new Set([
    '剧情', '喜剧', '爱情', '动作', '惊悚', '犯罪', '悬疑', '恐怖',
    '科幻', '奇幻', '传记', '战争', '家庭', '冒险', '人性', '青春',
  ]);
  const movieRegionsFromSelector = new Set([
    '全部', '大陆', '美国', '香港', '台湾', '日本', '韩国', '英国',
    '法国', '德国', '意大利', '西班牙', '印度', '泰国', '俄罗斯',
  ]);
  const currentYear = new Date().getFullYear();
  const movieYearsFromSelector = new Set(
    Array.from({ length: 10 }, (_, idx) => String(currentYear - idx))
  );

  const isMovieTagsFilter =
    kind === 'movie' &&
    (category === '全部' || movieGenresFromSelector.has(category)) &&
    movieRegionsFromSelector.has(type) &&
    (!year || year === '全部' || movieYearsFromSelector.has(year));

  const isMovieSubjectCollection =
    kind === 'movie' && category.startsWith('movie_');

  const tags = isMovieTagsFilter
    ? [category === '全部' ? null : category, type === '全部' ? null : type].filter(
        (v): v is string => Boolean(v)
      )
    : [];
  const yearRange =
    isMovieTagsFilter && year && year !== '全部' ? `${year},${year}` : null;
  const sortValue =
    sort === '人气' ? 'U'
    : sort === '评分' ? 'S'
    : sort === '时间' ? 'T'
    : sort && ['T', 'U', 'S', 'R'].includes(sort) ? sort : 'T';

  const target = isMovieSubjectCollection
    ? `https://m.douban.com/rexxar/api/v2/subject_collection/${category}/items?start=${pageStart}&count=${pageLimit}`
    : isMovieTagsFilter
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

  try {
    const response = await nativeFetch(target, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Referer: isMovieTagsFilter ? 'https://movie.douban.com/explore' : 'https://movie.douban.com/',
        Accept: 'application/json, text/plain, */*',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      return {
        code: response.status,
        message: `豆瓣API返回错误: ${response.status}`,
        list: [],
      };
    }

    let list: DoubanItem[];
    if (isMovieSubjectCollection) {
      const doubanData = (await response.json()) as DoubanSubjectCollectionApiResponse;
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
    } else if (isMovieTagsFilter) {
      const doubanData = (await response.json()) as {
        data: Array<{
          id: string;
          title: string;
          cover: string;
          rate: string;
        }>;
      };
      list = doubanData.data.slice(0, pageLimit).map((item) => ({
        id: item.id,
        title: item.title,
        poster: item.cover,
        rate: item.rate,
        year: year && year !== '全部' ? year : '',
      }));
    } else {
      const doubanData = (await response.json()) as DoubanCategoryApiResponse;
      list = doubanData.items.map((item) => ({
        id: item.id,
        title: item.title,
        poster: item.pic?.normal || item.pic?.large || '',
        rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
        year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
      }));
    }

    return {
      code: 200,
      message: '获取成功',
      list,
    };
  } catch (error) {
    console.error('豆瓣API请求失败:', error);
    return {
      code: 500,
      message: `请求失败: ${(error as Error).message}`,
      list: [],
    };
  }
}