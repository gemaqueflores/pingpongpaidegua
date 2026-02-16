/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async redirects() {
    return [
      { source: "/user", destination: "/", permanent: true },
      { source: "/user/:path*", destination: "/:path*", permanent: true },
    ];
  },
};

module.exports = nextConfig;
