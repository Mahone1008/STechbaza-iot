import type { NextConfig } from "next";

const nextConfig = {
  output: "standalone",
  distDir: process.env.NEXT_DIST_DIR ?? (process.env.NEXT_PUBLIC_PORTAL_MODE === "staff" ? ".next-staff" : ".next"),
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // The movable `N` badge is a Next.js development aid, not part of KERUMO.
  // Compile/runtime errors remain visible even when the route indicator is hidden.
  devIndicators: false,
} satisfies NextConfig;

export default nextConfig;
