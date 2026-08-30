import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
    // 生产镜像用 standalone 输出（只打包用到的依赖，跑 node server.js），
    // 小内存服务器上镜像体积和运行时占用都小得多；dev 模式不受影响
    output: 'standalone',
    // Lets verification builds write elsewhere (NEXT_DIST_DIR=.next-verify) so
    // they don't clobber the .next dir a running dev server depends on
    distDir: process.env.NEXT_DIST_DIR || '.next',
    devIndicators: false,
    turbopack: {
        root: process.cwd(),
    },
    /* config options here */
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'i.ibb.co',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'static2.finnhub.io',
                port: '',
                pathname: '/**',
            },
        ],
    },
    eslint: {
        ignoreDuringBuilds: true,
    },
    typescript: {
        ignoreBuildErrors: true,
    }
};

export default withNextIntl(nextConfig);
