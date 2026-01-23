/** @type {import('next').NextConfig} */
const nextConfig = {
  // Uncomment for deployment
  output: 'export',
  trailingSlash: false, 
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;