/**
 * 视频源健康度状态机 —— 从 MoonTV Web 版 (src/lib/sources.ts) 移植到 App 客户端。
 *
 * Web 版的请求由服务端 /api/* 代理发出，健康度记在服务端内存；
 * App 版是客户端直连资源站，因此状态保存在内存 + localStorage，冷启动后仍然有效。
 *
 * 优化点（相对旧版固定 10 分钟熔断）：
 * 1. 指数退避：连续失败 3 次 → 5min → 15min → 60min
 * 2. 半开探测：熔断到期只放行 1 个请求试探，成功即恢复，失败立刻升级退避
 * 3. 按最近响应耗时排序，未测过的源给中性初值，避免新源永远排在最后
 * 4. 最近 20 次请求的成功率滑动窗口
 */

export interface HealthSite {
  key: string;
  name: string;
  disabled?: boolean;
}

interface HealthState {
  fails: number;
  lastOk: number;
  /** 熔断结束时间戳（0 = 未熔断） */
  openUntil: number;
  /** 熔断次数，用于指数退避 */
  tripCount: number;
  lastMs: number;
  recentOk: number;
  recentTotal: number;
  /** 熔断到期后已放行探测请求 */
  halfOpen: boolean;
}

const FAIL_THRESHOLD = 3;
/** 5 分钟 → 15 分钟 → 60 分钟 */
const BACKOFF_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000];
/** 没有历史数据时的中性耗时，让新源也能公平参与排序 */
const NEUTRAL_MS = 1500;
const STORAGE_KEY = 'sourceHealth';

const health = new Map<string, HealthState>();
let restored = false;

function newState(): HealthState {
  return {
    fails: 0,
    lastOk: 0,
    openUntil: 0,
    tripCount: 0,
    lastMs: 0,
    recentOk: 0,
    recentTotal: 0,
    halfOpen: false,
  };
}

function stateOf(key: string): HealthState {
  let s = health.get(key);
  if (!s) {
    s = newState();
    health.set(key, s);
  }
  return s;
}

/** 冷启动恢复；SSR 阶段直接跳过 */
function restore(): void {
  if (restored || typeof window === 'undefined') return;
  restored = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    Object.entries(saved).forEach(([key, v]) => {
      if (!v || typeof v !== 'object') return;
      const s = stateOf(key);
      const numeric = s as unknown as Record<string, number>;
      (
        [
          'fails',
          'lastOk',
          'openUntil',
          'tripCount',
          'lastMs',
          'recentOk',
          'recentTotal',
        ] as const
      ).forEach((field) => {
        const n = v[field];
        if (typeof n === 'number' && Number.isFinite(n)) numeric[field] = n;
      });
    });
  } catch {
    /* 本地数据损坏时忽略 */
  }
}

function persist(): void {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, HealthState> = {};
    health.forEach((v, k) => {
      obj[k] = v;
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* 隐私模式等场景下内存状态仍然有效 */
  }
}

/** 超过 20 次就衰减一半，保持滑动窗口轻量 */
function slide(s: HealthState): void {
  if (s.recentTotal > 20) {
    s.recentOk = Math.round(s.recentOk / 2);
    s.recentTotal = Math.round(s.recentTotal / 2);
  }
}

export function recordOk(key: string, ms: number): void {
  restore();
  const s = stateOf(key);
  s.fails = 0;
  s.openUntil = 0;
  s.tripCount = 0;
  s.halfOpen = false;
  s.lastOk = Date.now();
  s.lastMs = Math.max(0, ms);
  s.recentOk += 1;
  s.recentTotal += 1;
  slide(s);
  persist();
}

export function recordFail(key: string): void {
  restore();
  const s = stateOf(key);
  // 已在熔断期且不是半开探测：不重复延长熔断
  if (s.openUntil > Date.now() && !s.halfOpen) return;
  s.recentTotal += 1;
  slide(s);

  if (s.halfOpen) {
    // 半开探测失败 → 立刻重新熔断，并升级退避
    s.halfOpen = false;
    s.fails = 0;
    const step = Math.min(s.tripCount, BACKOFF_MS.length - 1);
    s.openUntil = Date.now() + BACKOFF_MS[step];
    s.tripCount += 1;
    persist();
    return;
  }

  s.fails += 1;
  if (s.fails >= FAIL_THRESHOLD) {
    const step = Math.min(s.tripCount, BACKOFF_MS.length - 1);
    s.openUntil = Date.now() + BACKOFF_MS[step];
    s.tripCount += 1;
    s.fails = 0;
  }
  persist();
}

/**
 * 本次请求是否允许访问该源。
 * 熔断到期时进入「半开」：只放行第一个探测请求，其余继续挡住。
 */
export function isHealthy(key: string): boolean {
  restore();
  const s = stateOf(key);
  if (s.openUntil === 0) return true;
  if (Date.now() < s.openUntil) return false;
  if (s.halfOpen) return false;
  s.halfOpen = true;
  return true;
}

function effectiveMs(s: HealthState): number {
  return s.lastOk ? s.lastMs : NEUTRAL_MS;
}

/** 过滤禁用 / 熔断中的源并按有效耗时升序；全部熔断时退回全部启用源（宁可慢也不无结果） */
export function orderSites<T extends HealthSite>(sites: T[]): T[] {
  restore();
  const enabled = sites.filter((s) => !s.disabled);
  const healthy = enabled.filter((s) => isHealthy(s.key));
  const pool = healthy.length > 0 ? healthy : enabled;
  return [...pool].sort(
    (a, b) => effectiveMs(stateOf(a.key)) - effectiveMs(stateOf(b.key))
  );
}

export function healthSnapshot<T extends HealthSite>(sites: T[]) {
  restore();
  return sites.map((s) => {
    const st = stateOf(s.key);
    return {
      key: s.key,
      name: s.name,
      disabled: Boolean(s.disabled),
      healthy: st.openUntil === 0 || st.openUntil < Date.now(),
      lastMs: st.lastMs || null,
      lastOk: st.lastOk || null,
      successRate:
        st.recentTotal > 0
          ? Math.round((st.recentOk / st.recentTotal) * 100)
          : null,
    };
  });
}
