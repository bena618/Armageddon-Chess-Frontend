/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true, // Helps with static routing
  images: {
    unoptimized: true, // Required for static export
  },
};

module.exports = nextConfig;