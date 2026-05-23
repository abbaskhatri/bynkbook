/** @type {import('next').NextConfig} */
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  // Only runs when ANALYZE=1; opening the report is also opt-in (ANALYZE_OPEN=1).
  enabled: process.env.ANALYZE === "1",
  openAnalyzer: process.env.ANALYZE_OPEN === "1",
});

const nextConfig = {
  turbopack: {
    root: __dirname,
  },
};

module.exports = withBundleAnalyzer(nextConfig);
