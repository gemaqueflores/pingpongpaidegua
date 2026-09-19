import { Prisma, PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

import { normalizeClubName } from "../packages/shared/src/index";

/**
 * PP-062 — backfill da normalização de clubes legados.
 *
 * Uso autorizado nesta rodada:
 *   npx tsx scripts/pp-062-backfill-normalizacao-clubes.ts --dry-run
 *
 * O modo padrão é dry-run. O caminho de escrita só é selecionado pela flag literal --execute e não
 * deve ser executado somente após homologação explícita do relatório de produção.
 */

export type CleanupDatabase = PrismaClient;
type ReadDatabase = PrismaClient | Prisma.TransactionClient;

export type ClubPair = {
  label: string;
  normalizedName: string;
  winnerClubId: number;
  duplicateClubId: number;
};

export type ClubSnapshot = {
  id: number;
  name: string;
  normalizedName: string;
  createdAt: Date;
};

type NormalizationUpdate = {
  clubId: number;
  clubName: string;
  normalizedNameBefore: string;
  normalizedNameAfter: string;
};

type CleanupPlan = {
  pairs: ClubPair[];
  normalizationUpdates: NormalizationUpdate[];
};

function discoverCleanupPlan(clubs: ClubSnapshot[]): CleanupPlan {
  const groups = new Map<string, ClubSnapshot[]>();
  for (const club of clubs) {
    const recalculated = normalizeClubName(club.name);
    const group = groups.get(recalculated) ?? [];
    group.push(club);
    groups.set(recalculated, group);
  }

  const pairs: ClubPair[] = [];
  const normalizationUpdates: NormalizationUpdate[] = [];
  for (const [normalizedName, group] of groups) {
    const ordered = [...group].sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id - right.id,
    );
    const winner = ordered[0];
    if (winner.normalizedName !== normalizedName) {
      normalizationUpdates.push({
        clubId: winner.id,
        clubName: winner.name,
        normalizedNameBefore: winner.normalizedName,
        normalizedNameAfter: normalizedName,
      });
    }
    for (const duplicate of ordered.slice(1)) {
      pairs.push({
        label: winner.name,
        normalizedName,
        winnerClubId: winner.id,
        duplicateClubId: duplicate.id,
      });
    }
  }

  return {
    pairs: pairs.sort(
      (left, right) => left.winnerClubId - right.winnerClubId || left.duplicateClubId - right.duplicateClubId,
    ),
    normalizationUpdates: normalizationUpdates.sort((left, right) => left.clubId - right.clubId),
  };
}

export function discoverClubPairs(clubs: ClubSnapshot[]): ClubPair[] {
  return discoverCleanupPlan(clubs).pairs;
}

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
  normalizedNameAfter: string;
  winnerClubId: number;
  winnerClubName: string | null;
  winnerNormalizedNameBefore: string | null;
  duplicateClubId: number;
  duplicateClubName: string | null;
  duplicateNormalizedNameBefore: string | null;
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
  spec: "PP-062";
  mode: "dry-run" | "execute";
  writesPerformed: boolean;
  discoveredPairCount: number;
  normalizationUpdates: NormalizationUpdate[];
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
    normalizedClubs: number;
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
    database.club.findUnique({
      where: { id: pair.winnerClubId },
      select: { id: true, name: true, normalizedName: true },
    }),
    database.club.findUnique({
      where: { id: pair.duplicateClubId },
      select: { id: true, name: true, normalizedName: true },
    }),
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
      normalizedNameAfter: pair.normalizedName,
      winnerClubId: pair.winnerClubId,
      winnerClubName: winnerClub?.name ?? null,
      winnerNormalizedNameBefore: winnerClub?.normalizedName ?? null,
      duplicateClubId: pair.duplicateClubId,
      duplicateClubName: duplicateClub?.name ?? null,
      duplicateNormalizedNameBefore: duplicateClub?.normalizedName ?? null,
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

async function inspectAllPairs(database: ReadDatabase, pairs: ClubPair[]): Promise<PairInspection[]> {
  const inspections: PairInspection[] = [];
  for (const pair of pairs) {
    inspections.push(await inspectPair(database, pair));
  }
  return inspections;
}

async function buildCleanupPlan(database: ReadDatabase): Promise<CleanupPlan> {
  const clubs = await database.club.findMany({
    select: { id: true, name: true, normalizedName: true, createdAt: true },
  });
  return discoverCleanupPlan(clubs);
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
    const plan = await buildCleanupPlan(transaction);

    let removedDuplicateAthletes = 0;
    let reassignedSimpleAthletes = 0;
    const affectedEventIds = new Set<number>();

    for (const pair of plan.pairs) {
      // Reinspeciona dentro da transação a cada fusão. Isso mantém grupos com 3+ clubes corretos:
      // atletas movidos por uma fusão anterior já participam da detecção de colisão da próxima.
      const inspection = await inspectPair(transaction, pair);
      if (!inspection.report.ready) {
        throw new Error(
          `Execução abortada: par incompleto no banco (vencedor ${pair.winnerClubId}, duplicado ${pair.duplicateClubId}).`,
        );
      }
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

    for (const update of plan.normalizationUpdates) {
      await transaction.club.update({
        where: { id: update.clubId },
        data: { normalizedName: update.normalizedNameAfter },
      });
    }

    const eventIds = Array.from(affectedEventIds);
    const invalidated = eventIds.length > 0
      ? await transaction.readModelCache.deleteMany({ where: { eventId: { in: eventIds } } })
      : { count: 0 };
    return {
      removedClubs: plan.pairs.length,
      removedDuplicateAthletes,
      reassignedSimpleAthletes,
      normalizedClubs: plan.normalizationUpdates.length,
      invalidatedReadModelCaches: invalidated.count,
    };
  }, { maxWait: 10_000, timeout: 120_000 });
}

export async function runClubCleanup(database: PrismaClient, argv: string[]): Promise<CleanupReport> {
  const { execute } = parseArgs(argv);
  const [clubsBefore, athletesBefore, plan] = await Promise.all([
    database.club.count(),
    database.athlete.count(),
    buildCleanupPlan(database),
  ]);
  const inspections = await inspectAllPairs(database, plan.pairs);
  const affectedEventIds = Array.from(
    new Set(inspections.flatMap((inspection) => inspection.report.affectedEventIds)),
  ).sort((left, right) => left - right);

  if (!execute) {
    return {
      spec: "PP-062",
      mode: "dry-run",
      writesPerformed: false,
      discoveredPairCount: plan.pairs.length,
      normalizationUpdates: plan.normalizationUpdates,
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
    spec: "PP-062",
    mode: "execute",
    writesPerformed: true,
    discoveredPairCount: plan.pairs.length,
    normalizationUpdates: plan.normalizationUpdates,
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
      "DATABASE_URL não definido. Use o DATABASE_URL nativo do ambiente alvo e rode primeiro em --dry-run.",
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
