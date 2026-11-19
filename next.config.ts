import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 测试构建（NEXT_TEST_BUILD=1）产出常规 .next 以便 `next start` 直接运行；
  // 生产/Docker 构建不受影响，仍输出 standalone
  output: process.env.NEXT_TEST_BUILD === '1' ? undefined : 'standalone',
  allowedDevOrigins: ['localhost'],
};

export default nextConfig;
