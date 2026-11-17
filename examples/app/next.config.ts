import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The SDK is linked from the repository root (`file:../..`), outside of
  // this project. Load it with Node at runtime instead of bundling it.
  serverExternalPackages: ["hydraloop"],
  // Turbopack only resolves files within its root, which needs to include the
  // linked SDK
  turbopack: { root: path.join(__dirname, "../..") },
};

export default nextConfig;
