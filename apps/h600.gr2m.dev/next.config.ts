import path from "node:path";

import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Pages hold a device token while they show live data (see
 * components/use-live-dataset.tsx). It works as a full HDM user token, so
 * scripts may only connect to this app and to the HDM socket, and injected
 * code could not send the token elsewhere.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  // The local API URL of a device "might change depending on load balancing
  // and or privacy laws of your country", so all HDM hosts are allowed
  "connect-src 'self' wss://*.hydraloop.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
        ],
      },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // The SDK packages are linked from packages/ (`file:../../packages/…`),
    // outside of this project. Turbopack only resolves files within its root,
    // which needs to include them.
    root: path.join(__dirname, "../.."),
    resolveAlias: {
      // hydraloop-internal imports hydraloop. From packages/hydraloop-internal/, that
      // only resolves when the repository root is installed, which it isn't
      // when only this app is installed, e.g. on Vercel. Resolve it from this
      // app's node_modules instead.
      hydraloop: "./node_modules/hydraloop",
    },
  },
};

export default nextConfig;
