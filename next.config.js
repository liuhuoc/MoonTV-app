/** @type {import('next').NextConfig} */
/* eslint-disable @typescript-eslint/no-var-requires */
const isStaticExport =
  process.env.NEXT_OUTPUT === 'export' ||
  process.env.NEXT_PUBLIC_OUTPUT === 'export' ||
  process.env.CAPACITOR === 'true';

const nextConfig = {
  eslint: {
    dirs: ['src'],
  },

  reactStrictMode: false,
  swcMinify: true,
  ...(isStaticExport ? {} : { output: 'standalone' }),
  ...(isStaticExport
    ? {
        output: 'export',
        trailingSlash: true,
      }
    : {}),
  allowedDevOrigins: ['45.142.166.74'],

  // Uncoment to add domain whitelist
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },

  webpack(config) {
    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.('.svg')
    );

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: { not: /\.(css|scss|sass)$/ },
        resourceQuery: { not: /url/ }, // exclude if *.svg?url
        loader: '@svgr/webpack',
        options: {
          dimensions: false,
          titleProp: true,
        },
      }
    );

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i;

    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      tls: false,
      crypto: false,
    };

    return config;
  },
};

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development' || nextConfig.output === 'export',
  register: true,
  skipWaiting: true,
  runtimeCaching: [
    {
      // 缓存封面图片（doubanio.com、img9.doubanio.com 等外部图片源）
      urlPattern: /\.(?:png|jpg|jpeg|webp|gif|svg)(\?.*)?$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'image-cache',
        expiration: {
          maxEntries: 500,
          maxAgeSeconds: 30 * 24 * 60 * 60, // 30 天
        },
        matchOptions: {
          ignoreVary: true,
        },
      },
    },
    {
      // 缓存视频封面图（匹配常见的图片 CDN 域名）
      urlPattern: ({ url }) => {
        const imageDomains = [
          'doubanio.com',
          'img9.doubanio.com',
          'img1.doubanio.com',
          'img2.doubanio.com',
          'img3.doubanio.com',
          'pic2.iqiyipic.com',
          'pic2.qiyipic.com',
          'pic3.iqiyipic.com',
        ];
        return imageDomains.some(domain => url.hostname.includes(domain));
      },
      handler: 'CacheFirst',
      options: {
        cacheName: 'poster-image-cache',
        expiration: {
          maxEntries: 500,
          maxAgeSeconds: 30 * 24 * 60 * 60,
        },
      },
    },
  ],
});

module.exports = withPWA(nextConfig);
