import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Vercel-কে টাইপ এরর ইগনোর করতে নির্দেশ দিচ্ছে
    ignoreBuildErrors: true,
  },
  eslint: {
    // Vercel-কে ESLint এরর ইগনোর করতে নির্দেশ দিচ্ছে
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;