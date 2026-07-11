import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  // Only runs when ANALYZE=1; opening the report is also opt-in (ANALYZE_OPEN=1).
  enabled: process.env.ANALYZE === "1",
  openAnalyzer: process.env.ANALYZE_OPEN === "1",
});

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: __dirname,
  },
  async headers() {
    const isDevelopment = process.env.NODE_ENV === "development";
    const contentSecurityPolicy = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""} https://cdn.plaid.com`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "frame-src https://cdn.plaid.com https://*.plaid.com",
      `connect-src 'self'${isDevelopment ? " ws: wss:" : ""} https://*.execute-api.us-east-1.amazonaws.com https://*.amazoncognito.com https://cognito-idp.us-east-1.amazonaws.com https://*.plaid.com`,
      ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
    ].join("; ");

    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    }];
  },
};

export default withBundleAnalyzer(nextConfig);
