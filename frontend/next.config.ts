import type { NextConfig } from "next";

const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // The movable `N` badge is a Next.js development aid, not part of KERUMO.
  // Compile/runtime errors remain visible even when the route indicator is hidden.
  devIndicators: false,
} satisfies NextConfig;

export default nextConfig;
