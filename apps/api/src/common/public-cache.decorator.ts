import { SetMetadata } from "@nestjs/common";

export const PUBLIC_CACHE_TTL_KEY = "public_cache_ttl_seconds";

export function PublicCacheTtl(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 60;
  return SetMetadata(PUBLIC_CACHE_TTL_KEY, safeSeconds);
}

