import { NextRequest, NextResponse } from 'next/server';

/**
 * Douban API 代理路由
 * 解决浏览器端 CORS 问题：通过同源服务端代理转发请求到豆瓣 API
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: '缺少 url 参数' }, { status: 400 });
  }

  // 安全检查：只允许代理豆瓣相关域名
  const allowedHosts = ['m.douban.com', 'movie.douban.com'];
  try {
    const targetUrl = new URL(url);
    if (!allowedHosts.some((host) => targetUrl.hostname === host)) {
      return NextResponse.json({ error: '不允许的目标域名' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: '无效的 URL' }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Referer: 'https://movie.douban.com/',
        Accept: 'application/json, text/plain, */*',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `上游请求失败: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: `代理请求失败: ${(error as Error).message}` },
      { status: 502 }
    );
  }
}