/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // Force generation of fallback for dynamic routes
  generateBuildId: () => 'static-build',
};

module.exports = nextConfig;