/** @type {import('next').NextConfig} */
const nextConfig = {
  // Comment out export for local development
  // output: 'export',
  trailingSlash: false, 
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;