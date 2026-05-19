/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        // Proxy /api/backend/* → http://localhost:8000/*
        // Lets the browser call a same-origin URL while avoiding CORS issues with
        // the FastAPI backend that has no CORSMiddleware configured.
        source: "/api/backend/:path*",
        destination: "http://localhost:8000/:path*",
      },
    ];
  },
};

export default nextConfig;
