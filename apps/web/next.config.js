/** @type {import('next').NextConfig} */
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig = {
  output: "standalone",
  async redirects() {
    return [
      { source: "/user", destination: "/", permanent: true },
      { source: "/user/:path*", destination: "/:path*", permanent: true },
    ];
  },
};

module.exports = withBundleAnalyzer(nextConfig);
