type CorsEnvironment = {
  FRONTEND_URL?: string;
  FRONTEND_ALLOW_VERCEL_PREVIEWS?: string;
};

const DEFAULT_LOCAL_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

export function isOriginAllowed(
  origin: string,
  env: CorsEnvironment = {
    FRONTEND_URL: process.env.FRONTEND_URL,
    FRONTEND_ALLOW_VERCEL_PREVIEWS: process.env.FRONTEND_ALLOW_VERCEL_PREVIEWS,
  },
): boolean {
  const configuredOrigins = (env.FRONTEND_URL ?? "http://localhost:3000")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const configuredOriginSet = new Set([...configuredOrigins, ...DEFAULT_LOCAL_ORIGINS]);

  if (configuredOriginSet.has(origin)) {
    return true;
  }

  const wildcardAllowed = [...configuredOriginSet]
    .filter((configuredOrigin) => configuredOrigin.includes("*"))
    .some((pattern) => {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`^${escaped}$`, "i").test(origin);
    });
  if (wildcardAllowed) {
    return true;
  }

  return (
    env.FRONTEND_ALLOW_VERCEL_PREVIEWS === "true" &&
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)
  );
}
