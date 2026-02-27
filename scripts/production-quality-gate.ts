import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { PrismaClient, ScrapeStatus } from "@prisma/client";
import { Queue } from "bullmq";

type Args = {
  cbtmEventId: number;
  stage3Attempts: number;
  timeoutMs: number;
  skipStage2: boolean;
};

type GateResult = {
  ok: boolean;
  reasons: string[];
  runId: number | null;
  runStatus: ScrapeStatus | null;
  matchCount: number;
  pendingConflicts: number;
  eliminatoriaCount: number;
};

function parseArgs(argv: string[]): Args {
  let cbtmEventId = 0;
  let stage3Attempts = 3;
  let timeoutMs = 20 * 60 * 1000;
  let skipStage2 = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (arg === "--eventId" && argv[i + 1]) {
      cbtmEventId = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--stage3Attempts" && argv[i + 1]) {
      stage3Attempts = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--timeoutMs" && argv[i + 1]) {
      timeoutMs = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--skipStage2") {
      skipStage2 = true;
      continue;
    }
  }

  if (!Number.isFinite(cbtmEventId) || cbtmEventId <= 0) {
    throw new Error("Uso: tsx scripts/production-quality-gate.ts --eventId <cbtmEventId>");
  }

  stage3Attempts = Number.isFinite(stage3Attempts) && stage3Attempts > 0 ? Math.trunc(stage3Attempts) : 3;
  timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 60_000 ? Math.trunc(timeoutMs) : 20 * 60 * 1000;

  return { cbtmEventId, stage3Attempts, timeoutMs, skipStage2 };
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

async function waitForRunCompletion(
  prisma: PrismaClient,
  eventId: number,
  previousRunId: number,
  timeoutMs: number,
): Promise<{ id: number; status: ScrapeStatus; finishedAt: Date | null }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const latest = await prisma.scrapeRun.findFirst({
      where: { eventId },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true, finishedAt: true },
    });
    if (latest && latest.id > previousRunId && latest.finishedAt) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Timeout aguardando scrape_run finalizar para eventId interno ${eventId}.`);
}

async function enqueueStage(queue: Queue, eventInternalId: number, stage: 1 | 2 | 3): Promise<void> {
  const reason = `scrape-now-force:stage-${stage}`;
  const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, "-");
  await queue.add(
    "scrape-event",
    { eventId: eventInternalId, reason },
    {
      jobId: `qg-${eventInternalId}-${safeReason}-${Date.now()}`,
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}

async function enqueuePostReprocess(queue: Queue, eventInternalId: number): Promise<void> {
  const reason = "post-scrape-reprocess";
  const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, "-");
  await queue.add(
    "scrape-event",
    { eventId: eventInternalId, reason },
    {
      jobId: `qg-${eventInternalId}-${safeReason}-${Date.now()}`,
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}

function toWarnings(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item ?? "").trim()).filter(Boolean);
}

async function evaluateGate(prisma: PrismaClient, eventInternalId: number): Promise<GateResult> {
  const [run, pendingConflicts, eliminatoriaCount, matchCount] = await Promise.all([
    prisma.scrapeRun.findFirst({
      where: { eventId: eventInternalId },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        status: true,
        warnings: true,
        extractionStats: true,
      },
    }),
    prisma.athleteMatchConflict.count({
      where: { eventId: eventInternalId, resolvedAthleteId: null },
    }),
    prisma.match.count({
      where: { eventId: eventInternalId, phase: "ELIMINATORIA" },
    }),
    prisma.match.count({
      where: { eventId: eventInternalId, phase: { in: ["GRUPOS", "RESULTADOS"] } },
    }),
  ]);

  const reasons: string[] = [];
  if (!run) {
    reasons.push("nenhum_scrape_run_encontrado");
    return {
      ok: false,
      reasons,
      runId: null,
      runStatus: null,
      matchCount,
      pendingConflicts,
      eliminatoriaCount,
    };
  }

  if (run.status === "ERROR") {
    reasons.push("run_status_error");
  }

  const warnings = toWarnings(run.warnings);
  if (warnings.some((warning) => warning.toLowerCase().includes("scrape_strict_quality_gate_alerta"))) {
    reasons.push("strict_quality_gate_alerta");
  }
  if (warnings.some((warning) => warning.toLowerCase().includes("auditoria_partidas_divergencia"))) {
    reasons.push("auditoria_partidas_divergencia");
  }
  if (warnings.some((warning) => warning.toLowerCase().includes("auditoria_inscricoes_divergencia"))) {
    reasons.push("auditoria_inscricoes_divergencia");
  }
  if (warnings.some((warning) => warning.toLowerCase().includes("auditoria_conflitos_pendentes"))) {
    reasons.push("auditoria_conflitos_pendentes");
  }

  const extractionStats = (run.extractionStats ?? {}) as {
    conformanceAudit?: {
      registrationMismatches?: unknown;
      matchMismatches?: unknown;
      playedMatchMismatches?: unknown;
      pendingConflicts?: unknown;
      eliminatoriaMatchesObserved?: unknown;
    };
  };

  const conformance = extractionStats.conformanceAudit ?? {};
  const registrationMismatches = Number(conformance.registrationMismatches ?? 0);
  const matchMismatches = Number(conformance.matchMismatches ?? 0);
  const playedMatchMismatches = Number(conformance.playedMatchMismatches ?? 0);
  const pendingFromAudit = Number(conformance.pendingConflicts ?? 0);
  const eliminatoriaFromAudit = Number(conformance.eliminatoriaMatchesObserved ?? 0);

  if (registrationMismatches > 0) {
    reasons.push(`registration_mismatches=${registrationMismatches}`);
  }
  if (matchMismatches > 0) {
    reasons.push(`match_mismatches=${matchMismatches}`);
  }
  if (playedMatchMismatches > 0) {
    reasons.push(`played_match_mismatches=${playedMatchMismatches}`);
  }
  if (pendingFromAudit > 0 || pendingConflicts > 0) {
    reasons.push(`pending_conflicts=${Math.max(pendingFromAudit, pendingConflicts)}`);
  }
  if (eliminatoriaFromAudit > 0 || eliminatoriaCount > 0) {
    reasons.push(`eliminatoria_detectada=${Math.max(eliminatoriaFromAudit, eliminatoriaCount)}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    runId: run.id,
    runStatus: run.status,
    matchCount,
    pendingConflicts,
    eliminatoriaCount,
  };
}

async function main(): Promise<void> {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const queue = new Queue("scrape-event", {
    connection: {
      url: process.env.REDIS_URL ?? "redis://localhost:6379",
    },
  });

  try {
    const event = await prisma.event.findUnique({
      where: { cbtmEventId: args.cbtmEventId },
      select: { id: true, nome: true },
    });
    if (!event) {
      throw new Error(`Evento cbtmEventId=${args.cbtmEventId} nao encontrado.`);
    }

    console.log(`Quality gate: evento ${event.nome} (cbtm=${args.cbtmEventId}, id=${event.id})`);

    if (!args.skipStage2) {
      const before = await prisma.scrapeRun.findFirst({
        where: { eventId: event.id },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      await enqueueStage(queue, event.id, 2);
      const stage2Run = await waitForRunCompletion(prisma, event.id, before?.id ?? 0, args.timeoutMs);
      console.log(`Stage 2 concluido: run #${stage2Run.id} (${stage2Run.status})`);
    }

    let finalGate: GateResult | null = null;
    for (let attempt = 1; attempt <= args.stage3Attempts; attempt += 1) {
      const before = await prisma.scrapeRun.findFirst({
        where: { eventId: event.id },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      await enqueueStage(queue, event.id, 3);
      const stage3Run = await waitForRunCompletion(prisma, event.id, before?.id ?? 0, args.timeoutMs);
      console.log(`Stage 3 tentativa ${attempt}/${args.stage3Attempts}: run #${stage3Run.id} (${stage3Run.status})`);

      const gate = await evaluateGate(prisma, event.id);
      finalGate = gate;
      if (gate.ok) {
        console.log(`Quality gate aprovado. Partidas GRUPOS+RESULTADOS=${gate.matchCount}`);
        process.exit(0);
      }

      console.log(`Quality gate reprovado: ${gate.reasons.join(", ")}`);
      if (attempt < args.stage3Attempts) {
        const beforePost = await prisma.scrapeRun.findFirst({
          where: { eventId: event.id },
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
        await enqueuePostReprocess(queue, event.id);
        const postRun = await waitForRunCompletion(prisma, event.id, beforePost?.id ?? 0, args.timeoutMs);
        console.log(`Post-scrape reprocess: run #${postRun.id} (${postRun.status})`);
      }
    }

    console.error(
      `Quality gate falhou apos ${args.stage3Attempts} tentativa(s): ${
        finalGate?.reasons.join(", ") ?? "sem detalhes"
      }`,
    );
    process.exit(2);
  } finally {
    await queue.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(String(error?.stack ?? error?.message ?? error));
  process.exit(1);
});
