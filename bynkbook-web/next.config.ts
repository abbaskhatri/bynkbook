import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  // Only runs when ANALYZE=1; opening the report is also opt-in (ANALYZE_OPEN=1).
  enabled: process.env.ANALYZE === "1",
  openAnalyzer: process.env.ANALYZE_OPEN === "1",
});

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
};

export default withBundleAnalyzer(nextConfig);
