import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

const fixtureFallback = path.resolve(process.cwd(), "fixtures/results.txt");
const fixturePathsEnv = process.env.SCRAPER_FIXTURE_PATHS
  ? process.env.SCRAPER_FIXTURE_PATHS
  : process.env.SCRAPER_FIXTURE_PATH ?? fixtureFallback;

const scraperFixturePaths = fixturePathsEnv
  .split(/[;,]/g)
  .map((value) => value.trim())
  .filter(Boolean);

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/cbtm",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  scraperMode: (process.env.SCRAPER_MODE ?? "live") as "fixture" | "live",
  scraperEventUrl:
    process.env.SCRAPER_EVENT_URL ?? "https://app.cbtm.org.br/IUI/App/Evento?EVE_Evento_ID={EVENT_ID}",
  scraperFixturePath: process.env.SCRAPER_FIXTURE_PATH ?? fixtureFallback,
  scraperFixturePaths,
  scraperHeadless: process.env.SCRAPER_HEADLESS !== "false",
  scraperExcludedCategoryIds: (process.env.SCRAPER_EXCLUDED_CATEGORY_IDS ?? "88888888,99999999")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  scrapeCaptureTimeoutMs: Number(process.env.SCRAPE_CAPTURE_TIMEOUT_MS ?? "900000"),
  scrapeLockStaleMs: Number(process.env.SCRAPE_LOCK_STALE_MS ?? "900000"),
  refreshMs: Number(process.env.SCRAPER_REFRESH_CRON_MS ?? "7200000"),
  postEventGraceHours: Number(process.env.SCRAPER_POST_EVENT_GRACE_HOURS ?? "48"),
};
