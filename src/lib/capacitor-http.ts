/**
 * Capacitor HTTP 客户端工具
 * 在 Capacitor 原生环境中使用 CapacitorHttp（绕过 CORS），
 * 在浏览器开发环境中回退到原生 fetch。
 */
import { CapacitorHttp, type HttpResponse } from '@capacitor/core';

let isCapacitorAvailable: boolean | null = null;

function checkCapacitor(): boolean {
  if (isCapacitorAvailable !== null) return isCapacitorAvailable;
  if (typeof window === 'undefined') { isCapacitorAvailable = false; return false; }
  try {
    const win = window as any;
    // Android: 原生注入 androidBridge / iOS: 原生注入 webkit.messageHandlers.bridge
    isCapacitorAvailable = !!(win.androidBridge || win.webkit?.messageHandlers?.bridge);
  } catch {
    isCapacitorAvailable = false;
  }
  return isCapacitorAvailable;
}

export interface FetchOptions extends RequestInit {
  timeout?: number;
}

export async function nativeFetch(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const timeout = options.timeout || 10000;

  if (checkCapacitor()) {
    try {
      const headers: Record<string, string> = {};
      if (options.headers) {
        if (options.headers instanceof Headers) {
          options.headers.forEach((v, k) => {
            headers[k] = v;
          });
        } else if (Array.isArray(options.headers)) {
          options.headers.forEach(([k, v]) => {
            headers[k] = v;
          });
        } else {
          Object.assign(headers, options.headers);
        }
      }

      const response: HttpResponse = await CapacitorHttp.request({
        url,
        method: (options.method || 'GET') as 'GET' | 'POST',
        headers,
        data: options.body as string | undefined,
        responseType: 'text',
        connectTimeout: timeout,
        readTimeout: timeout,
      });

      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: '',
        json: async () => {
          const data = response.data;
          // CapacitorHttp 返回的 data 可能已经是解析后的对象，而非字符串
          if (typeof data === 'object' && data !== null) return data;
          if (typeof data === 'string') return JSON.parse(data);
          return JSON.parse(data as string);
        },
        text: async () => {
          const data = response.data;
          if (typeof data === 'string') return data;
          if (typeof data === 'object' && data !== null) return JSON.stringify(data);
          return String(data);
        },
        headers: new Headers(response.headers as Record<string, string>),
        redirected: false,
        type: 'basic' as ResponseType,
        url: response.url || url,
        clone() {
          return this;
        },
        body: null,
        bodyUsed: false,
        arrayBuffer: async () => new ArrayBuffer(0),
        blob: async () => new Blob(),
        formData: async () => new FormData(),
      } as Response;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : JSON.stringify(error);
      throw new Error(`CapacitorHttp 请求失败: ${errMsg}`);
    }
  }

  // 浏览器环境：使用原生 fetch
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const signal = controller.signal;

  try {
    const response = await fetch(url, { ...options, signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}