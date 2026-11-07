/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 视频源配置 —— 数据来源改为 config.json 生成的 runtime.ts（与 Web 版一致）。
 * 旧版把 20 个源硬编码在这里，和 config.json 容易不同步；现在单一数据源。
 */

import type { ApiSite } from './downstream';
import { healthSnapshot, orderSites } from './source-health';
import config from './runtime';

const rawSites = ((config as any).api_site || {}) as Record<
  string,
  { api?: string; name?: string; detail?: string; disabled?: boolean }
>;

const API_SITES: ApiSite[] = Object.entries(rawSites)
  .filter(([, v]) => Boolean(v && v.api))
  .map(([key, v]) => ({
    key,
    api: String(v.api),
    name: String(v.name || key),
    detail: v.detail ? String(v.detail) : undefined,
    disabled: Boolean(v.disabled),
  }));

const defaultEnabled = (): ApiSite[] => API_SITES.filter((s) => !s.disabled);

/**
 * 获取本次请求可用的源（已按健康度排序：快的先发，熔断中的跳过）。
 * localStorage 里的显式选择优先，因此设置页可以手动启用 disabled 的备用源。
 */
export function getAvailableApiSites(): ApiSite[] {
  let base = defaultEnabled();
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem('enabledSources');
      if (raw) {
        const keys = new Set(JSON.parse(raw) as string[]);
        if (keys.size > 0) base = API_SITES.filter((s) => keys.has(s.key));
      }
    } catch {
      /* ignore */
    }
  }
  return orderSites(base);
}

/** 全部源（含默认禁用的备用源），用于设置页源管理 */
export function getAllApiSites(): ApiSite[] {
  return API_SITES;
}

const siteConfig = ((config as any).admin_config?.SiteConfig || {}) as Record<
  string,
  any
>;

export function getSiteName(): string {
  return siteConfig.SiteName || 'MoonTV';
}

export function getAnnouncement(): string {
  return (
    siteConfig.Announcement ||
    '本站仅提供影视信息搜索服务，所有内容均来自第三方网站。'
  );
}

/** 供设置页 / 调试查看各源真实健康度 */
export function getSourceHealth() {
  return healthSnapshot(API_SITES);
}
