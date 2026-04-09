import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { PrismaClient, ScrapeStatus } from "@prisma/client";
import { Queue } from "bullmq";
import {
  buildEventScrapePolicy,
  computeEventRecoveryStaleThresholdMs,
  type EventSituation,
} from "@cbtm/shared";

type Args = {
  apiBase: string;
  maxEvents: number;
  postEventHours: number;
  autoPostReprocess: boolean;
  postReprocessCooldownMs: number;
  json: boolean;
};

type EventSummary = {
  id: number;
  cbtmEventId: number | null;
  nome: string;
  situacaoComputada: EventSituation;
  inicioInscricoes: string | null;
  fimInscricoes: string | null;
  inicioRealizacao: string | null;
  fimRealizacao: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  lastScrapeAt: string | null;
  inscricoesTotaisOficiais: number;
  associacoesAtletaCategoria: number;
  participantesUnicos: number;
  totalCategorias: number;
  totalPartidas: number;
  totalPartidasWo: number;
  totalPartidasJogadas: number;
};

type MedalistsPayload = {
  categories?: Array<{
    categoryId: number;
    playedMatchesCount?: number | null;
    calculatedMatchesCount?: number | null;
    walkoverMatchesCount?: number | null;
    diagnostics?: { status?: string | null } | null;
  }>;
};

type EventWatchResult = {
  eventId: number;
  cbtmEventId: number | null;
  nome: string;
  situation: EventSituation;
  status: "pass" | "warn" | "fail";
  reasons: string[];
  autoAction:
    | "none"
    | "post-reprocess-enqueued"
    | "post-reprocess-skipped"
    | "stage-2-enqueued"
    | "stage-2-skipped";
  metrics: {
    inscricoesTotaisOficiais: number;
    associacoesAtletaCategoria: number;
    totalPartidas: number;
    totalPartidasWo: number;
    totalPartidasJogadas: number;
    categories: number;
    categoriesDiagnosticsNotOk: number;
    playedMatchesSum: number;
    calculatedMatchesSum: number;
    walkoversSum: number;
    staleScrapeMs: number | null;
    staleThresholdMs: number | null;
    scrapeLockedAt: string | null;
    latestRunStatus: ScrapeStatus | null;
    latestRunStartedAt: string | null;
  };
};

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apiBase:
      process.env.EVENT_WATCH_API_BASE_URL ??
      process.env.READ_MODEL_PREWARM_API_BASE_URL ??
      "http://api:4000",
    maxEvents: parsePositiveNumber(process.env.EVENT_WATCH_MAX_EVENTS, 6),
    postEventHours: parsePositiveNumber(process.env.EVENT_WATCH_POST_EVENT_HOURS, 18),
    autoPostReprocess: parseBoolean(process.env.EVENT_WATCH_AUTO_POST_REPROCESS, true),
    postReprocessCooldownMs: parsePositiveNumber(process.env.EVENT_WATCH_POST_REPROCESS_COOLDOWN_MS, 30 * 60 * 1000),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    const next = argv[index + 1];
    if (token === "--apiBase" && next) {
      args.apiBase = next;
      index += 1;
      continue;
    }
    if (token === "--maxEvents" && next) {
      args.maxEvents = parsePositiveNumber(next, args.maxEvents);
      index += 1;
      continue;
    }
    if (token === "--postEventHours" && next) {
      args.postEventHours = parsePositiveNumber(next, args.postEventHours);
      index += 1;
      continue;
    }
    if (token === "--postReprocessCooldownMs" && next) {
      args.postReprocessCooldownMs = parsePositiveNumber(next, args.postReprocessCooldownMs);
      index += 1;
      continue;
    }
    if (token === "--autoPostReprocess") {
      args.autoPostReprocess = true;
      continue;
    }
    if (token === "--no-autoPostReprocess") {
      args.autoPostReprocess = false;
      continue;
    }
    if (token === "--json") {
      args.json = true;
      continue;
    }
  }

  return args;
}

function loadEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "apps/api/.env"),
    path.resolve(process.cwd(), "apps/worker/.env"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      dotenv.config({ path: file, override: false });
    }
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} em ${url}`);
  }
  return (await response.json()) as T;
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shouldWatchEvent(event: EventSummary, now: Date, postEventHours: number): boolean {
  if (
    event.situacaoComputada === "POS_INSCRICOES_PRE_EVENTO" ||
    event.situacaoComputada === "GRADES_PUBLICADAS_PRE_JOGO" ||
    event.situacaoComputada === "EM_ANDAMENTO"
  ) {
    return true;
  }
  if (event.situacaoComputada === "POS_EVENTO") {
    const end = toDate(event.fimRealizacao) ?? toDate(event.dataFim);
    if (!end) return false;
    return now.getTime() - end.getTime() <= postEventHours * 60 * 60 * 1000;
  }
  return false;
}

async function enqueuePostReprocess(queue: Queue, eventInternalId: number): Promise<void> {
  const reason = "post-scrape-reprocess";
  const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, "-");
  await queue.add(
    "scrape-event",
    { eventId: eventInternalId, reason },
    {
      jobId: `watch-${eventInternalId}-${safeReason}-${Date.now()}`,
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}

async function enqueueStage2(queue: Queue, eventInternalId: number): Promise<void> {
  const reason = "scrape-now-force:stage-2";
  const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, "-");
  await queue.add(
    "scrape-event",
    { eventId: eventInternalId, reason },
    {
      jobId: `watch-${eventInternalId}-${safeReason}-${Date.now()}`,
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}

async function evaluateEvent(
  prisma: PrismaClient,
  queue: Queue | null,
  event: EventSummary,
  apiBase: string,
  autoPostReprocess: boolean,
  postReprocessCooldownMs: number,
  now: Date,
): Promise<EventWatchResult> {
  const medalists = await fetchJson<MedalistsPayload>(`${apiBase.replace(/\/$/, "")}/events/${event.id}/medalists`);
  const categories = Array.isArray(medalists.categories) ? medalists.categories : [];
  const playedMatchesSum = categories.reduce((sum, category) => sum + Number(category.playedMatchesCount ?? 0), 0);
  const calculatedMatchesSum = categories.reduce((sum, category) => sum + Number(category.calculatedMatchesCount ?? 0), 0);
  const walkoversSum = categories.reduce((sum, category) => sum + Number(category.walkoverMatchesCount ?? 0), 0);
  const categoriesDiagnosticsNotOk = categories.filter((category) => category.diagnostics?.status && category.diagnostics.status !== "ok").length;

  const [eventState, latestRun] = await Promise.all([
    prisma.event.findUnique({
      where: { id: event.id },
      select: { scrapeLockedAt: true },
    }),
    prisma.scrapeRun.findFirst({
      where: { eventId: event.id },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: { startedAt: true, status: true },
    }),
  ]);

  const reasons: string[] = [];
  const policy = buildEventScrapePolicy({
    inicioInscricoes: event.inicioInscricoes,
    fimInscricoes: event.fimInscricoes,
    inicioRealizacao: event.inicioRealizacao,
    fimRealizacao: event.fimRealizacao,
    dataInicio: event.dataInicio,
    dataFim: event.dataFim,
    hasPublishedMatches: event.totalPartidas > 0,
    hasPublishedResults: event.totalPartidasJogadas > 0,
  }, { now });
  const staleThresholdMs =
    event.situacaoComputada === "GRADES_PUBLICADAS_PRE_JOGO" || event.situacaoComputada === "EM_ANDAMENTO"
      ? computeEventRecoveryStaleThresholdMs(policy)
      : null;
  const lastScrapeAt = toDate(event.lastScrapeAt);
  const staleScrapeMs = lastScrapeAt ? Math.max(0, now.getTime() - lastScrapeAt.getTime()) : null;

  if (event.totalPartidasJogadas !== event.totalPartidas - event.totalPartidasWo) {
    reasons.push("summary_played_inconsistent");
  }
  if (
    event.situacaoComputada === "POS_INSCRICOES_PRE_EVENTO" &&
    event.inscricoesTotaisOficiais > 0 &&
    event.associacoesAtletaCategoria !== event.inscricoesTotaisOficiais
  ) {
    reasons.push("registration_summary_mismatch");
  }
  if (playedMatchesSum !== calculatedMatchesSum - walkoversSum) {
    reasons.push("category_played_inconsistent");
  }
  if (event.totalPartidasJogadas !== playedMatchesSum) {
    reasons.push("summary_vs_categories_played_mismatch");
  }
  if (categoriesDiagnosticsNotOk > 0) {
    reasons.push(`medalists_diagnostics_not_ok=${categoriesDiagnosticsNotOk}`);
  }
  if (latestRun?.status === "ERROR") {
    reasons.push("latest_run_error");
  }
  if (staleThresholdMs && staleScrapeMs !== null && staleScrapeMs > staleThresholdMs) {
    reasons.push(`stale_scrape=${staleScrapeMs}`);
  }

  let status: EventWatchResult["status"] = "pass";
  if (
    reasons.some(
      (reason) =>
        reason.includes("inconsistent") ||
        reason === "registration_summary_mismatch" ||
        reason === "latest_run_error" ||
        reason.startsWith("stale_scrape="),
    )
  ) {
    status = "fail";
  } else if (reasons.length > 0) {
    status = "warn";
  }

  let autoAction: EventWatchResult["autoAction"] = "none";
  const latestRunStartedAt = latestRun?.startedAt ?? null;
  const recentRunMs = latestRunStartedAt ? now.getTime() - latestRunStartedAt.getTime() : null;
  const scrapeLockedAt = eventState?.scrapeLockedAt ?? null;
  const shouldAutoReprocess =
    autoPostReprocess &&
    (reasons.includes("summary_played_inconsistent") ||
      reasons.includes("category_played_inconsistent") ||
      reasons.includes("summary_vs_categories_played_mismatch") ||
      reasons.some((reason) => reason.startsWith("medalists_diagnostics_not_ok=")));
  const shouldAutoStage2Repair =
    autoPostReprocess &&
    event.situacaoComputada === "POS_INSCRICOES_PRE_EVENTO" &&
    reasons.includes("registration_summary_mismatch");

  if (shouldAutoStage2Repair) {
    if (scrapeLockedAt || (recentRunMs !== null && recentRunMs < postReprocessCooldownMs)) {
      autoAction = "stage-2-skipped";
    } else {
      if (queue) {
        await enqueueStage2(queue, event.id);
        autoAction = "stage-2-enqueued";
      } else {
        autoAction = "stage-2-skipped";
      }
    }
  } else if (shouldAutoReprocess) {
    if (scrapeLockedAt || (recentRunMs !== null && recentRunMs < postReprocessCooldownMs)) {
      autoAction = "post-reprocess-skipped";
    } else {
      if (queue) {
        await enqueuePostReprocess(queue, event.id);
        autoAction = "post-reprocess-enqueued";
      } else {
        autoAction = "post-reprocess-skipped";
      }
    }
  }

  return {
    eventId: event.id,
    cbtmEventId: event.cbtmEventId,
    nome: event.nome,
    situation: event.situacaoComputada,
    status,
    reasons,
    autoAction,
    metrics: {
      inscricoesTotaisOficiais: event.inscricoesTotaisOficiais,
      associacoesAtletaCategoria: event.associacoesAtletaCategoria,
      totalPartidas: event.totalPartidas,
      totalPartidasWo: event.totalPartidasWo,
      totalPartidasJogadas: event.totalPartidasJogadas,
      categories: categories.length,
      categoriesDiagnosticsNotOk,
      playedMatchesSum,
      calculatedMatchesSum,
      walkoversSum,
      staleScrapeMs,
      staleThresholdMs,
      scrapeLockedAt: scrapeLockedAt?.toISOString() ?? null,
      latestRunStatus: latestRun?.status ?? null,
      latestRunStartedAt: latestRunStartedAt?.toISOString() ?? null,
    },
  };
}

async function main(): Promise<void> {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  let queue: Queue | null = null;

  try {
    const now = new Date();
    const events = await fetchJson<EventSummary[]>(`${args.apiBase.replace(/\/$/, "")}/events`);
    const watchedEvents = events
      .filter((event) => shouldWatchEvent(event, now, args.postEventHours))
      .sort((left, right) => {
        const leftPriority = left.situacaoComputada === "EM_ANDAMENTO" ? 0 : left.situacaoComputada === "GRADES_PUBLICADAS_PRE_JOGO" ? 1 : 2;
        const rightPriority = right.situacaoComputada === "EM_ANDAMENTO" ? 0 : right.situacaoComputada === "GRADES_PUBLICADAS_PRE_JOGO" ? 1 : 2;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return (toDate(right.lastScrapeAt)?.getTime() ?? 0) - (toDate(left.lastScrapeAt)?.getTime() ?? 0);
      })
      .slice(0, args.maxEvents);

    const results: EventWatchResult[] = [];
    for (const event of watchedEvents) {
      if (args.autoPostReprocess && !queue) {
        queue = new Queue("scrape-event", {
          connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" },
        });
      }
      results.push(await evaluateEvent(prisma, queue, event, args.apiBase, args.autoPostReprocess, args.postReprocessCooldownMs, now));
    }

    const worstStatus =
      results.some((item) => item.status === "fail") ? "fail" : results.some((item) => item.status === "warn") ? "warn" : "pass";

    const report = {
      timestamp: now.toISOString(),
      watchedEvents: watchedEvents.length,
      status: worstStatus,
      results,
    };

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`event_watch status=${worstStatus} watched=${watchedEvents.length}`);
      for (const result of results) {
        console.log(
          `${result.status.toUpperCase()} cbtm=${result.cbtmEventId ?? "?"} event=${result.nome} situation=${result.situation} reasons=${
            result.reasons.length > 0 ? result.reasons.join(",") : "ok"
          } action=${result.autoAction}`,
        );
      }
    }

    if (worstStatus === "fail") process.exit(2);
    if (worstStatus === "warn") process.exit(1);
    process.exit(0);
  } finally {
    if (queue) {
      await queue.close();
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(String(error?.stack ?? error?.message ?? error));
  process.exit(1);
});
