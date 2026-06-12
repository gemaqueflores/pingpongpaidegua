import type { UserEventRow } from "./user-api";

export function resolveEventPublishedAt(event: Pick<UserEventRow, "publishedAt" | "lastScrapeAt" | "_meta"> | null): string | null {
  return event?.publishedAt ?? event?._meta?.publishedAt ?? event?.lastScrapeAt ?? null;
}

export function shouldReloadPublishedTabs(
  previous: Pick<UserEventRow, "publishedAt" | "lastScrapeAt" | "_meta"> | null,
  next: Pick<UserEventRow, "publishedAt" | "lastScrapeAt" | "_meta"> | null,
): boolean {
  return resolveEventPublishedAt(previous) !== resolveEventPublishedAt(next);
}
