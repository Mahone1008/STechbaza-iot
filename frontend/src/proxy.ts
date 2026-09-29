import { NextResponse, type NextRequest } from "next/server";

import { apiConfig } from "@/lib/api/config";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const development = process.env.NODE_ENV === "development";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    // React uses inline grid widths and SVG styles. Script permissions remain strict.
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${apiConfig.baseUrl}${development ? ` ${request.nextUrl.origin.replace(/^http/u, "ws")}` : ""}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  // Overwrite caller-supplied values; Next extracts the nonce from this header.
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

export const config = {
  // RSC/prefetch also receives private cache headers; immutable assets stay cacheable.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
