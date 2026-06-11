import { getAvailableApiSites } from '@/lib/config';
import { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';
import { nativeFetch } from '@/lib/capacitor-http';

interface ApiSearchItem {
  vod_id: string;
  vod_name: string;
  vod_pic: string;
  vod_remarks?: string;
  vod_play_url?: string;
  vod_class?: string;
  vod_year?: string;
  vod_content?: string;
  vod_douban_id?: number;
  type_name?: string;
}

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

export const API_CONFIG = {
  search: {
    path: '?ac=videolist&wd=',
    pagePath: '?ac=videolist&wd={query}&pg={page}',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
  detail: {
    path: '?ac=videolist&ids=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
};

export async function searchFromApi(
  apiSite: ApiSite,
  query: string
): Promise<SearchResult[]> {
  try {
    const apiBaseUrl = apiSite.api;
    const apiUrl =
      apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(query);
    const apiName = apiSite.name;

    const response = await nativeFetch(apiUrl, {
      headers: API_CONFIG.search.headers,
      timeout: 8000,
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    if (
      !data ||
      !data.list ||
      !Array.isArray(data.list) ||
      data.list.length === 0
    ) {
      return [];
    }

    const results = data.list.map((item: ApiSearchItem) => {
      let episodes: string[] = [];

      if (item.vod_play_url) {
        const m3u8Regex = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
        const vod_play_url_array = item.vod_play_url.split('$$$');
        vod_play_url_array.forEach((url: string) => {
          const matches = url.match(m3u8Regex) || [];
          if (matches.length > episodes.length) {
            episodes = matches;
          }
        });
      }

      episodes = Array.from(new Set(episodes)).map((link: string) => {
        link = link.substring(1);
        const parenIndex = link.indexOf('(');
        return parenIndex > 0 ? link.substring(0, parenIndex) : link;
      });

      return {
        id: item.vod_id.toString(),
        title: item.vod_name.trim().replace(/\s+/g, ' '),
        poster: item.vod_pic,
        episodes,
        source: apiSite.key,
        source_name: apiName,
        class: item.vod_class,
        year: item.vod_year
          ? item.vod_year.match(/\d{4}/)?.[0] || ''
          : 'unknown',
        desc: cleanHtmlTags(item.vod_content || ''),
        type_name: item.type_name,
        douban_id: item.vod_douban_id,
      };
    });

    const MAX_SEARCH_PAGES = 5;
    const pageCount = data.pagecount || 1;
    const pagesToFetch = Math.min(pageCount - 1, MAX_SEARCH_PAGES - 1);

    if (pagesToFetch > 0) {
      const additionalPagePromises = [];

      for (let page = 2; page <= pagesToFetch + 1; page++) {
        const pageUrl =
          apiBaseUrl +
          API_CONFIG.search.pagePath
            .replace('{query}', encodeURIComponent(query))
            .replace('{page}', page.toString());

        const pagePromise = (async () => {
          try {
            const pageResponse = await nativeFetch(pageUrl, {
              headers: API_CONFIG.search.headers,
              timeout: 8000,
            });

            if (!pageResponse.ok) return [];

            const pageData = await pageResponse.json();

            if (!pageData || !pageData.list || !Array.isArray(pageData.list))
              return [];

            return pageData.list.map((item: ApiSearchItem) => {
              let episodes: string[] = [];

              if (item.vod_play_url) {
                const m3u8Regex = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
                episodes = item.vod_play_url.match(m3u8Regex) || [];
              }

              episodes = Array.from(new Set(episodes)).map((link: string) => {
                link = link.substring(1);
                const parenIndex = link.indexOf('(');
                return parenIndex > 0 ? link.substring(0, parenIndex) : link;
              });

              return {
                id: item.vod_id.toString(),
                title: item.vod_name.trim().replace(/\s+/g, ' '),
                poster: item.vod_pic,
                episodes,
                source: apiSite.key,
                source_name: apiName,
                class: item.vod_class,
                year: item.vod_year
                  ? item.vod_year.match(/\d{4}/)?.[0] || ''
                  : 'unknown',
                desc: cleanHtmlTags(item.vod_content || ''),
                type_name: item.type_name,
                douban_id: item.vod_douban_id,
              };
            });
          } catch (error) {
            return [];
          }
        })();

        additionalPagePromises.push(pagePromise);
      }

      const additionalResults = await Promise.all(additionalPagePromises);

      additionalResults.forEach((pageResults) => {
        if (pageResults.length > 0) {
          results.push(...pageResults);
        }
      });
    }

    return results;
  } catch (error) {
    return [];
  }
}

const M3U8_PATTERN = /(https?:\/\/[^"'\s]+?\.m3u8)/g;
const M3U8_WITH_DOLLAR_PATTERN = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;

function normalizeEpisodeLinks(links: string[]): string[] {
  return Array.from(new Set(links))
    .map((link: string) => {
      if (link.startsWith('$')) link = link.substring(1);
      const parenIndex = link.indexOf('(');
      return parenIndex > 0 ? link.substring(0, parenIndex) : link;
    })
    .filter(
      (url: string) =>
        url && (url.startsWith('http://') || url.startsWith('https://'))
    );
}

export async function getDetailFromApi(
  apiSite: ApiSite,
  id: string
): Promise<SearchResult> {
  const detailUrl = `${apiSite.api}${API_CONFIG.detail.path}${id}`;
  const altDetailUrl = `${apiSite.api}?ac=detail&ids=${encodeURIComponent(id)}`;

  try {
    const fetchDetailJson = async (url: string): Promise<any> => {
      const response = await nativeFetch(url, {
        headers: API_CONFIG.detail.headers,
        timeout: 10000,
      });

      if (!response.ok) {
        throw new Error(`详情请求失败: ${response.status}`);
      }

      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error('详情响应解析失败');
      }
    };

    let data: any;
    try {
      data = await fetchDetailJson(detailUrl);
    } catch {
      data = await fetchDetailJson(altDetailUrl);
    }

    if (
      !data ||
      !data.list ||
      !Array.isArray(data.list) ||
      data.list.length === 0
    ) {
      throw new Error('获取到的详情内容无效');
    }

    const videoDetail = data.list[0];
    let episodes: string[] = [];

    if (videoDetail.vod_play_url) {
      const parts = String(videoDetail.vod_play_url).split('$$$');
      let bestMatches: string[] = [];
      parts.forEach((part: string) => {
        const matches = part.match(M3U8_WITH_DOLLAR_PATTERN) || [];
        if (matches.length > bestMatches.length) {
          bestMatches = matches;
        }
      });
      episodes = normalizeEpisodeLinks(bestMatches);
    }

    if (episodes.length === 0 && videoDetail.vod_content) {
      const matches = String(videoDetail.vod_content).match(M3U8_PATTERN) || [];
      episodes = normalizeEpisodeLinks(matches);
    }

    return {
      id: id.toString(),
      title: videoDetail.vod_name,
      poster: videoDetail.vod_pic,
      episodes,
      source: apiSite.key,
      source_name: apiSite.name,
      class: videoDetail.vod_class,
      year: videoDetail.vod_year
        ? videoDetail.vod_year.match(/\d{4}/)?.[0] || ''
        : 'unknown',
      desc: cleanHtmlTags(videoDetail.vod_content),
      type_name: videoDetail.type_name,
      douban_id: videoDetail.vod_douban_id,
    };
  } catch (error) {
    if (apiSite.detail) {
      try {
        return await handleSpecialSourceDetail(id, apiSite);
      } catch (fallbackError) {
        const primaryMsg =
          error instanceof Error ? error.message : String(error);
        const fallbackMsg =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        throw new Error(`${primaryMsg}; ${fallbackMsg}`);
      }
    }
    throw error;
  }
}

async function handleSpecialSourceDetail(
  id: string,
  apiSite: ApiSite
): Promise<SearchResult> {
  const detailUrl = `${apiSite.detail}/index.php/vod/detail/id/${id}.html`;

  const response = await nativeFetch(detailUrl, {
    headers: {
      ...API_CONFIG.detail.headers,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    timeout: 10000,
  });

  if (!response.ok) {
    throw new Error(`详情页请求失败: ${response.status}`);
  }

  const html = await response.text();
  let matches: string[] = [];

  if (apiSite.key === 'ffzy') {
    const ffzyPattern =
      /\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g;
    matches = html.match(ffzyPattern) || [];
  }

  if (matches.length === 0) {
    const generalPattern = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
    matches = html.match(generalPattern) || [];
  }

  matches = Array.from(new Set(matches)).map((link: string) => {
    link = link.substring(1);
    const parenIndex = link.indexOf('(');
    return parenIndex > 0 ? link.substring(0, parenIndex) : link;
  });

  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const titleText = titleMatch ? titleMatch[1].trim() : '';

  const descMatch = html.match(
    /<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/
  );
  const descText = descMatch ? cleanHtmlTags(descMatch[1]) : '';

  const coverMatch = html.match(/(https?:\/\/[^"'\s]+?\.jpg)/g);
  const coverUrl = coverMatch ? coverMatch[0].trim() : '';

  const yearMatch = html.match(/>(\d{4})</);
  const yearText = yearMatch ? yearMatch[1] : 'unknown';

  return {
    id,
    title: titleText,
    poster: coverUrl,
    episodes: matches,
    source: apiSite.key,
    source_name: apiSite.name,
    class: '',
    year: yearText,
    desc: descText,
    type_name: '',
    douban_id: 0,
  };
}

/**
 * 聚合搜索：从所有可用源并发搜索
 */
export async function downstreamSearch(
  query: string,
  /** 可选：限制搜索的源数量（前 N 个），用于快速返回首屏 */
  limitSources?: number
): Promise<SearchResult[]> {
  const apiSites = await getAvailableApiSites();
  const targetSites = limitSources ? apiSites.slice(0, limitSources) : apiSites;
  const results: SearchResult[] = [];

  const siteResults = await Promise.all(
    targetSites.map(async (site) => {
      try {
        return await searchFromApi(site, query);
      } catch {
        return [];
      }
    })
  );

  siteResults.forEach((r) => results.push(...r));
  return results;
}

/**
 * 增量搜索：先返回前 N 个源的结果，剩余源继续后台搜索
 * 返回 [fastResults, remainingPromise]
 */
export async function downstreamSearchFast(
  query: string,
  fastCount = 6
): Promise<[SearchResult[], () => Promise<SearchResult[]>]> {
  const apiSites = await getAvailableApiSites();
  const fastSites = apiSites.slice(0, fastCount);
  const remainingSites = apiSites.slice(fastCount);

  const fastResults: SearchResult[] = [];
  const fastSiteResults = await Promise.all(
    fastSites.map(async (site) => {
      try {
        return await searchFromApi(site, query);
      } catch {
        return [];
      }
    })
  );
  fastSiteResults.forEach((r) => fastResults.push(...r));

  const remainingPromise = async (): Promise<SearchResult[]> => {
    const remainingResults: SearchResult[] = [];
    const remainingSiteResults = await Promise.all(
      remainingSites.map(async (site) => {
        try {
          return await searchFromApi(site, query);
        } catch {
          return [];
        }
      })
    );
    remainingSiteResults.forEach((r) => remainingResults.push(...r));
    return remainingResults;
  };

  return [fastResults, remainingPromise];
}

/**
 * 获取视频详情
 */
export async function fetchVideoDetail({
  source,
  id,
  fallbackTitle = '',
}: {
  source: string;
  id: string;
  fallbackTitle?: string;
}): Promise<SearchResult> {
  const apiSites = await getAvailableApiSites();
  const apiSite = apiSites.find((site) => site.key === source);
  if (!apiSite) {
    throw new Error('无效的API来源');
  }

  if (fallbackTitle) {
    try {
      const searchData = await searchFromApi(apiSite, fallbackTitle.trim());
      const exactMatch = searchData.find(
        (item: SearchResult) =>
          item.source.toString() === source.toString() &&
          item.id.toString() === id.toString()
      );
      if (exactMatch) {
        return exactMatch;
      }
    } catch (error) {
      // do nothing
    }
  }

  const detail = await getDetailFromApi(apiSite, id);
  if (!detail) {
    throw new Error('获取视频详情失败');
  }

  return detail;
}