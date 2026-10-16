import { NextRequest, NextResponse } from "next/server";

const apiOrigin = new URL(
  process.env.NEXT_PUBLIC_API_URL ?? "https://api-pingpongpaidegua.duckdns.org",
).origin;

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${apiOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  // Next.js reads the request CSP to nonce its framework/bootstrap scripts.
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: ["/((?!api/pix-qrcode(?:/|$)|_next/static|_next/image|favicon.ico).*)"],
};
