import { Prisma, PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

/**
 * PP-060 — saneamento do resíduo de clubes duplicados.
 *
 * Uso autorizado nesta rodada:
 *   DATABASE_URL=<cbtm_homolog> npx tsx scripts/pp-060-saneamento-clubes-residuo.ts --dry-run
 *
 * O modo padrão é dry-run. O caminho de escrita só é selecionado pela flag literal --execute e não
 * deve ser executado até existir autorização explícita posterior ao evento 4TMB26.
 */

export type CleanupDatabase = PrismaClient;
type ReadDatabase = PrismaClient | Prisma.TransactionClient;

export type ClubPair = {
  label: string;
  winnerClubId: number;
  duplicateClubId: number;
};

export const CLUB_PAIRS: readonly ClubPair[] = [
  { label: "PARÁ CLUBE - PA", winnerClubId: 132, duplicateClubId: 211 },
  { label: "GRÊMIO LITERÁRIO E RECREATIVO PORTUGUÊS - PA", winnerClubId: 133, duplicateClubId: 214 },
  { label: "ASSEMBLÉIA PARAENSE - PA", winnerClubId: 134, duplicateClubId: 212 },
  { label: "CABANA CLUBE - PA", winnerClubId: 137, duplicateClubId: 216 },
  { label: "PAYSANDU SPORT CLUB - PA", winnerClubId: 138, duplicateClubId: 215 },
  { label: "BEL.TT/CAMINHO DO BEM-PA", winnerClubId: 139, duplicateClubId: 210 },
  { label: "ASSOCIAÇÃO DE MESATENISTAS DE MARABÁ - PA", winnerClubId: 144, duplicateClubId: 219 },
  { label: "ASSOCIAÇAO DE MESATENISTAS DE PARAUAPEBAS-PA", winnerClubId: 146, duplicateClubId: 218 },
  {
    label: "YOSHIDA TT - IGREJA CRISTÃ EVANGÉLICA DA AMAZONIA (PA)",
    winnerClubId: 170,
    duplicateClubId: 213,
  },
  { label: "MARDEY TT / APANB - PA", winnerClubId: 204, duplicateClubId: 217 },
] as const;

type AthleteSnapshot = {
  id: number;
  eventId: number;
  nameNormalized: string;
  nameDisplay: string;
};

type AthleteMerge = {
  eventId: number;
  nameNormalized: string;
  winnerAthleteId: number;
  duplicateAthleteId: number;
};

type RelationSummary = {
  duplicateRows: number;
  collisions: number;
  wouldReassign: number;
  wouldDiscardCollision: number;
};

export type PairReport = {
  label: string;
  winnerClubId: number;
  winnerClubName: string | null;
  duplicateClubId: number;
  duplicateClubName: string | null;
  ready: boolean;
  athletesBefore: { winner: number; duplicate: number };
  athletesAfter: { winner: number; duplicate: number };
  duplicateAthletePairs: AthleteMerge[];
  simpleAthleteReassignments: number;
  affectedEventIds: number[];
  relations: {
    matchParticipants: RelationSummary;
    athleteAliases: RelationSummary;
    athleteCategories: RelationSummary;
    eventAthleteLinks: RelationSummary;
    athleteMatchConflicts: { wouldReassign: number };
  };
};

export type CleanupReport = {
  spec: "PP-060";
  mode: "dry-run" | "execute";
  writesPerformed: boolean;
  fixedPairCount: number;
  totals: {
    before: { clubs: number; athletes: number };
    after: { clubs: number; athletes: number };
  };
  affectedEventIds: number[];
  pairs: PairReport[];
  execution?: {
    removedClubs: number;
    removedDuplicateAthletes: number;
    reassignedSimpleAthletes: number;
    invalidatedReadModelCaches: number;
  };
};

type PairInspection = {
  report: PairReport;
  duplicateAthletes: AthleteMerge[];
};

export function parseArgs(argv: string[]): { execute: boolean } {
  const allowed = new Set(["--dry-run", "--execute"]);
  const unknown = argv.find((argument) => !allowed.has(argument));
  if (unknown) {
    throw new Error(`Argumento desconhecido: ${unknown}. Use --dry-run ou --execute.`);
  }
  if (argv.includes("--dry-run") && argv.includes("--execute")) {
    throw new Error("As flags --dry-run e --execute são mutuamente exclusivas.");
  }
  return { execute: argv.includes("--execute") };
}

function emptyRelationSummary(): RelationSummary {
  return { duplicateRows: 0, collisions: 0, wouldReassign: 0, wouldDiscardCollision: 0 };
}

function summarizeCollisions<T>(duplicateValues: T[], winnerValues: T[]): RelationSummary {
  const winnerSet = new Set(winnerValues);
  const collisions = duplicateValues.filter((value) => winnerSet.has(value)).length;
  return {
    duplicateRows: duplicateValues.length,
    collisions,
    wouldReassign: duplicateValues.length - collisions,
    wouldDiscardCollision: collisions,
  };
}

async function inspectAthleteRelations(
  database: ReadDatabase,
  merge: AthleteMerge,
): Promise<PairReport["relations"]> {
  const [duplicateMatches, winnerMatches, duplicateAliases, winnerAliases, duplicateCategories, winnerCategories,
    duplicateLinks, winnerLinks, conflicts] = await Promise.all([
    database.matchParticipant.findMany({
      where: { athleteId: merge.duplicateAthleteId },
      select: { matchId: true },
    }),
    database.matchParticipant.findMany({
      where: { athleteId: merge.winnerAthleteId },
      select: { matchId: true },
    }),
    database.athleteAlias.findMany({
      where: { athleteId: merge.duplicateAthleteId },
      select: { aliasNormalized: true },
    }),
    database.athleteAlias.findMany({
      where: { athleteId: merge.winnerAthleteId },
      select: { aliasNormalized: true },
    }),
    database.athleteCategory.findMany({
      where: { athleteId: merge.duplicateAthleteId },
      select: { categoryId: true },
    }),
    database.athleteCategory.findMany({
      where: { athleteId: merge.winnerAthleteId },
      select: { categoryId: true },
    }),
    database.eventAthleteLink.findMany({
      where: { athleteId: merge.duplicateAthleteId },
      select: { eventId: true },
    }),
    database.eventAthleteLink.findMany({
      where: { athleteId: merge.winnerAthleteId },
      select: { eventId: true },
    }),
    database.athleteMatchConflict.count({ where: { resolvedAthleteId: merge.duplicateAthleteId } }),
  ]);

  return {
    matchParticipants: summarizeCollisions(
      duplicateMatches.map((row) => row.matchId),
      winnerMatches.map((row) => row.matchId),
    ),
    athleteAliases: summarizeCollisions(
      duplicateAliases.map((row) => row.aliasNormalized),
      winnerAliases.map((row) => row.aliasNormalized),
    ),
    athleteCategories: summarizeCollisions(
      duplicateCategories.map((row) => row.categoryId),
      winnerCategories.map((row) => row.categoryId),
    ),
    eventAthleteLinks: summarizeCollisions(
      duplicateLinks.map((row) => row.eventId),
      winnerLinks.map((row) => row.eventId),
    ),
    athleteMatchConflicts: { wouldReassign: conflicts },
  };
}

function addRelationSummary(target: RelationSummary, source: RelationSummary): void {
  target.duplicateRows += source.duplicateRows;
  target.collisions += source.collisions;
  target.wouldReassign += source.wouldReassign;
  target.wouldDiscardCollision += source.wouldDiscardCollision;
}

function indexAthletes(athletes: AthleteSnapshot[]): Map<string, AthleteSnapshot> {
  return new Map(athletes.map((athlete) => [`${athlete.eventId}\u0000${athlete.nameNormalized}`, athlete]));
}

async function inspectPair(database: ReadDatabase, pair: ClubPair): Promise<PairInspection> {
  const [winnerClub, duplicateClub, winnerAthletes, duplicateAthletes] = await Promise.all([
    database.club.findUnique({ where: { id: pair.winnerClubId }, select: { id: true, name: true } }),
    database.club.findUnique({ where: { id: pair.duplicateClubId }, select: { id: true, name: true } }),
    database.athlete.findMany({
      where: { clubId: pair.winnerClubId },
      select: { id: true, eventId: true, nameNormalized: true, nameDisplay: true },
    }),
    database.athlete.findMany({
      where: { clubId: pair.duplicateClubId },
      select: { id: true, eventId: true, nameNormalized: true, nameDisplay: true },
    }),
  ]);

  const winnerIndex = indexAthletes(winnerAthletes);
  const duplicateMerges: AthleteMerge[] = [];
  for (const duplicate of duplicateAthletes) {
    const winner = winnerIndex.get(`${duplicate.eventId}\u0000${duplicate.nameNormalized}`);
    if (winner) {
      duplicateMerges.push({
        eventId: duplicate.eventId,
        nameNormalized: duplicate.nameNormalized,
        winnerAthleteId: winner.id,
        duplicateAthleteId: duplicate.id,
      });
    }
  }

  const relations: PairReport["relations"] = {
    matchParticipants: emptyRelationSummary(),
    athleteAliases: emptyRelationSummary(),
    athleteCategories: emptyRelationSummary(),
    eventAthleteLinks: emptyRelationSummary(),
    athleteMatchConflicts: { wouldReassign: 0 },
  };

  for (const merge of duplicateMerges) {
    const mergeRelations = await inspectAthleteRelations(database, merge);
    addRelationSummary(relations.matchParticipants, mergeRelations.matchParticipants);
    addRelationSummary(relations.athleteAliases, mergeRelations.athleteAliases);
    addRelationSummary(relations.athleteCategories, mergeRelations.athleteCategories);
    addRelationSummary(relations.eventAthleteLinks, mergeRelations.eventAthleteLinks);
    relations.athleteMatchConflicts.wouldReassign += mergeRelations.athleteMatchConflicts.wouldReassign;
  }

  const affectedEventIds = Array.from(
    new Set([...winnerAthletes, ...duplicateAthletes].map((athlete) => athlete.eventId)),
  ).sort((left, right) => left - right);
  const simpleAthleteReassignments = duplicateAthletes.length - duplicateMerges.length;

  return {
    duplicateAthletes: duplicateMerges,
    report: {
      label: pair.label,
      winnerClubId: pair.winnerClubId,
      winnerClubName: winnerClub?.name ?? null,
      duplicateClubId: pair.duplicateClubId,
      duplicateClubName: duplicateClub?.name ?? null,
      ready: Boolean(winnerClub && duplicateClub),
      athletesBefore: { winner: winnerAthletes.length, duplicate: duplicateAthletes.length },
      athletesAfter: {
        winner: winnerAthletes.length + simpleAthleteReassignments,
        duplicate: 0,
      },
      duplicateAthletePairs: duplicateMerges,
      simpleAthleteReassignments,
      affectedEventIds,
      relations,
    },
  };
}

async function inspectAllPairs(database: ReadDatabase): Promise<PairInspection[]> {
  const inspections: PairInspection[] = [];
  for (const pair of CLUB_PAIRS) {
    inspections.push(await inspectPair(database, pair));
  }
  return inspections;
}

async function mergeDuplicateAthlete(
  database: Prisma.TransactionClient,
  merge: AthleteMerge,
): Promise<void> {
  const duplicateMatches = await database.matchParticipant.findMany({
    where: { athleteId: merge.duplicateAthleteId },
    select: { matchId: true },
  });
  const winnerMatches = new Set(
    (await database.matchParticipant.findMany({
      where: { athleteId: merge.winnerAthleteId },
      select: { matchId: true },
    })).map((row) => row.matchId),
  );
  const collidingMatchIds = duplicateMatches.filter((row) => winnerMatches.has(row.matchId)).map((row) => row.matchId);
  if (collidingMatchIds.length > 0) {
    await database.matchParticipant.deleteMany({
      where: { athleteId: merge.duplicateAthleteId, matchId: { in: collidingMatchIds } },
    });
  }
  await database.matchParticipant.updateMany({
    where: { athleteId: merge.duplicateAthleteId },
    data: { athleteId: merge.winnerAthleteId },
  });

  const duplicateAliases = await database.athleteAlias.findMany({ where: { athleteId: merge.duplicateAthleteId } });
  const winnerAliases = new Set(
    (await database.athleteAlias.findMany({
      where: { athleteId: merge.winnerAthleteId },
      select: { aliasNormalized: true },
    })).map((row) => row.aliasNormalized),
  );
  for (const alias of duplicateAliases) {
    if (winnerAliases.has(alias.aliasNormalized)) {
      await database.athleteAlias.delete({ where: { id: alias.id } });
    } else {
      await database.athleteAlias.update({ where: { id: alias.id }, data: { athleteId: merge.winnerAthleteId } });
      winnerAliases.add(alias.aliasNormalized);
    }
  }

  const duplicateCategories = await database.athleteCategory.findMany({ where: { athleteId: merge.duplicateAthleteId } });
  const winnerCategories = new Set(
    (await database.athleteCategory.findMany({
      where: { athleteId: merge.winnerAthleteId },
      select: { categoryId: true },
    })).map((row) => row.categoryId),
  );
  for (const category of duplicateCategories) {
    const key = { athleteId_categoryId: { athleteId: merge.duplicateAthleteId, categoryId: category.categoryId } };
    if (winnerCategories.has(category.categoryId)) {
      await database.athleteCategory.delete({ where: key });
    } else {
      await database.athleteCategory.update({ where: key, data: { athleteId: merge.winnerAthleteId } });
      winnerCategories.add(category.categoryId);
    }
  }

  const duplicateLinks = await database.eventAthleteLink.findMany({ where: { athleteId: merge.duplicateAthleteId } });
  const winnerLinkEvents = new Set(
    (await database.eventAthleteLink.findMany({
      where: { athleteId: merge.winnerAthleteId },
      select: { eventId: true },
    })).map((row) => row.eventId),
  );
  for (const link of duplicateLinks) {
    if (winnerLinkEvents.has(link.eventId)) {
      await database.eventAthleteLink.delete({ where: { id: link.id } });
    } else {
      await database.eventAthleteLink.update({ where: { id: link.id }, data: { athleteId: merge.winnerAthleteId } });
      winnerLinkEvents.add(link.eventId);
    }
  }

  await database.athleteMatchConflict.updateMany({
    where: { resolvedAthleteId: merge.duplicateAthleteId },
    data: { resolvedAthleteId: merge.winnerAthleteId },
  });
  await database.athlete.delete({ where: { id: merge.duplicateAthleteId } });
}

async function executeCleanup(database: PrismaClient): Promise<CleanupReport["execution"]> {
  return database.$transaction(async (transaction) => {
    const inspections = await inspectAllPairs(transaction);
    const notReady = inspections.filter((inspection) => !inspection.report.ready);
    if (notReady.length > 0) {
      const ids = notReady.map((inspection) => inspection.report.duplicateClubId).join(", ");
      throw new Error(`Execução abortada: pares incompletos no banco (IDs duplicados: ${ids}).`);
    }

    let removedDuplicateAthletes = 0;
    let reassignedSimpleAthletes = 0;
    const affectedEventIds = new Set<number>();

    for (const [index, inspection] of inspections.entries()) {
      const pair = CLUB_PAIRS[index];
      inspection.report.affectedEventIds.forEach((eventId) => affectedEventIds.add(eventId));
      for (const merge of inspection.duplicateAthletes) {
        await mergeDuplicateAthlete(transaction, merge);
        removedDuplicateAthletes += 1;
      }
      const reassigned = await transaction.athlete.updateMany({
        where: { clubId: pair.duplicateClubId },
        data: { clubId: pair.winnerClubId },
      });
      reassignedSimpleAthletes += reassigned.count;
      const remaining = await transaction.athlete.count({ where: { clubId: pair.duplicateClubId } });
      if (remaining !== 0) {
        throw new Error(`Execução abortada: clube ${pair.duplicateClubId} ainda possui ${remaining} atletas.`);
      }
      await transaction.club.delete({ where: { id: pair.duplicateClubId } });
    }

    const invalidated = await transaction.readModelCache.deleteMany({
      where: { eventId: { in: Array.from(affectedEventIds) } },
    });
    return {
      removedClubs: CLUB_PAIRS.length,
      removedDuplicateAthletes,
      reassignedSimpleAthletes,
      invalidatedReadModelCaches: invalidated.count,
    };
  });
}

export async function runClubCleanup(database: PrismaClient, argv: string[]): Promise<CleanupReport> {
  const { execute } = parseArgs(argv);
  const [clubsBefore, athletesBefore, inspections] = await Promise.all([
    database.club.count(),
    database.athlete.count(),
    inspectAllPairs(database),
  ]);
  const affectedEventIds = Array.from(
    new Set(inspections.flatMap((inspection) => inspection.report.affectedEventIds)),
  ).sort((left, right) => left - right);

  if (!execute) {
    return {
      spec: "PP-060",
      mode: "dry-run",
      writesPerformed: false,
      fixedPairCount: CLUB_PAIRS.length,
      totals: {
        before: { clubs: clubsBefore, athletes: athletesBefore },
        after: { clubs: clubsBefore, athletes: athletesBefore },
      },
      affectedEventIds,
      pairs: inspections.map((inspection) => inspection.report),
    };
  }

  const execution = await executeCleanup(database);
  const [clubsAfter, athletesAfter] = await Promise.all([database.club.count(), database.athlete.count()]);
  return {
    spec: "PP-060",
    mode: "execute",
    writesPerformed: true,
    fixedPairCount: CLUB_PAIRS.length,
    totals: {
      before: { clubs: clubsBefore, athletes: athletesBefore },
      after: { clubs: clubsAfter, athletes: athletesAfter },
    },
    affectedEventIds,
    pairs: inspections.map((inspection) => inspection.report),
    execution,
  };
}

function loadEnvironment(): void {
  for (const candidate of [".env", "apps/api/.env", "apps/worker/.env"]) {
    const envPath = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
  }
}

async function main(): Promise<void> {
  loadEnvironment();
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL não definido. Aponte explicitamente para cbtm_homolog e use --dry-run nesta rodada.",
    );
  }
  const database = new PrismaClient();
  try {
    const report = await runClubCleanup(database, process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await database.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
