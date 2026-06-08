/** @type {import('next').NextConfig} */
const backendDestination =
  process.env.INTERNAL_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://caption-api:8000";

const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/backend/:path*',
        destination: `${backendDestination}/:path*`,
      },
    ];
  },
};

export default nextConfig;
