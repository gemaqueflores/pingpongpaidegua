import type { Metadata } from "next";

const DEFAULT_SITE_URL = "https://pingpongpaidegua.vercel.app";
const API_BASE_INTERNAL = process.env.API_INTERNAL_URL ?? null;
const API_BASE_PUBLIC = process.env.NEXT_PUBLIC_API_URL ?? null;

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL;
export const SITE_NAME = "PingPong Paid'egua";
const FETCH_TIMEOUT_MS = 4000;
const FETCH_REVALIDATE_SECONDS = 300;
const METADATA_CACHE_TTL_MS = 60_000;
const metadataFetchCache = new Map<string, { expiresAt: number; payload: unknown | null }>();

function normalizePath(path: string): string {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

export function absoluteUrl(path: string): string {
  const base = SITE_URL.endsWith("/") ? SITE_URL.slice(0, -1) : SITE_URL;
  return `${base}${normalizePath(path)}`;
}

export function buildMetadata(input: {
  title: string;
  description?: string;
  path: string;
}): Metadata {
  const title = input.title;
  const description = input.description ?? title;
  const url = absoluteUrl(input.path);
  const image = absoluteUrl("/opengraph-image");

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: "website",
      locale: "pt_BR",
      url,
      title,
      description,
      siteName: SITE_NAME,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: SITE_NAME,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

async function fetchJsonFromBase<T>(base: string, path: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}${path}`, {
      next: { revalidate: FETCH_REVALIDATE_SECONDS },
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson<T>(path: string): Promise<T | null> {
  const now = Date.now();
  const cached = metadataFetchCache.get(path);
  if (cached && cached.expiresAt > now) {
    return cached.payload as T | null;
  }

  const bases = [API_BASE_INTERNAL, API_BASE_PUBLIC, "http://localhost:4000"].filter(
    (base): base is string => Boolean(base),
  );
  const uniqueBases = [...new Set(bases)];
  if (uniqueBases.length === 0) {
    return null;
  }

  const attempts = await Promise.all(uniqueBases.map((base) => fetchJsonFromBase<T>(base, path)));
  const firstSuccess = attempts.find((item) => item !== null) ?? null;
  metadataFetchCache.set(path, {
    expiresAt: now + METADATA_CACHE_TTL_MS,
    payload: firstSuccess,
  });
  return firstSuccess;
}
