import type { ApiSite } from './downstream';

// 视频源列表 - 编译时内嵌
const API_SITES: ApiSite[] = [
  { key: 'dyttzy', api: 'http://caiji.dyttzyapi.com/api.php/provide/vod', name: '电影天堂资源', detail: 'http://caiji.dyttzyapi.com' },
  { key: 'heimuer', api: 'https://json.heimuer.xyz/api.php/provide/vod', name: '黑木耳', detail: 'https://heimuer.tv' },
  { key: 'ruyi', api: 'https://cj.rycjapi.com/api.php/provide/vod', name: '如意资源' },
  { key: 'bfzy', api: 'https://bfzyapi.com/api.php/provide/vod', name: '暴风资源' },
  { key: 'tyyszy', api: 'https://tyyszy.com/api.php/provide/vod', name: '天涯资源' },
  { key: 'ffzy', api: 'http://ffzy5.tv/api.php/provide/vod', name: '非凡影视', detail: 'http://ffzy5.tv' },
  { key: 'zy360', api: 'https://360zy.com/api.php/provide/vod', name: '360资源' },
  { key: 'maotaizy', api: 'https://caiji.maotaizy.cc/api.php/provide/vod', name: '茅台资源' },
  { key: 'wolong', api: 'https://wolongzyw.com/api.php/provide/vod', name: '卧龙资源' },
  { key: 'jisu', api: 'https://jszyapi.com/api.php/provide/vod', name: '极速资源', detail: 'https://jszyapi.com' },
  { key: 'dbzy', api: 'https://dbzy.tv/api.php/provide/vod', name: '豆瓣资源' },
  { key: 'mozhua', api: 'https://mozhuazy.com/api.php/provide/vod', name: '魔爪资源' },
  { key: 'mdzy', api: 'https://www.mdzyapi.com/api.php/provide/vod', name: '魔都资源' },
  { key: 'zuid', api: 'https://api.zuidapi.com/api.php/provide/vod', name: '最大资源' },
  { key: 'yinghua', api: 'https://m3u8.apiyhzy.com/api.php/provide/vod', name: '樱花资源' },
  { key: 'wujin', api: 'https://api.wujinapi.me/api.php/provide/vod', name: '无尽资源' },
  { key: 'wwzy', api: 'https://wwzy.tv/api.php/provide/vod', name: '旺旺短剧' },
  { key: 'ikun', api: 'https://ikunzyapi.com/api.php/provide/vod', name: 'iKun资源' },
  { key: 'lzi', api: 'https://cj.lziapi.com/api.php/provide/vod', name: '量子资源站' },
  { key: 'xiaomaomi', api: 'https://zy.xmm.hk/api.php/provide/vod', name: '小猫咪资源' },
];

/**
 * 获取所有可用视频源（纯客户端，同步）
 * 会根据 localStorage 中的 enabledSources 过滤禁用的源
 */
export function getAvailableApiSites(): ApiSite[] {
  if (typeof window === 'undefined') return API_SITES;
  try {
    const raw = localStorage.getItem('enabledSources');
    if (raw) {
      const enabledKeys = new Set(JSON.parse(raw) as string[]);
      if (enabledKeys.size > 0) {
        return API_SITES.filter(s => enabledKeys.has(s.key));
      }
    }
  } catch { /* ignore */ }
  return API_SITES;
}

/**
 * 获取全部视频源（不过滤，用于设置页面源管理）
 */
export function getAllApiSites(): ApiSite[] {
  return API_SITES;
}

/**
 * 获取站点名称
 */
export function getSiteName(): string {
  return 'MoonTV';
}

/**
 * 获取站点公告
 */
export function getAnnouncement(): string {
  return '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。';
}