import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/**
 * PP-053 — Item 2: consolidação dos 4 pares de clube duplicado em cbtm_homolog / producao.
 *
 * Referência: docs/specs/PP-053-deduplicacao-clubes.md — ## SPEC ATIVA v2, Cenarios 2/3/4/4b, secao
 * "Impacto tecnico" (mapeamento completo de tabelas).
 *
 * Uso:
 *   DATABASE_URL=postgresql://postgres:<senha>@localhost:5432/cbtm_homolog npx tsx scripts/pp-053-merge-clubs.ts --dry-run
 *   DATABASE_URL=postgresql://postgres:<senha>@localhost:5432/cbtm_homolog npx tsx scripts/pp-053-merge-clubs.ts --execute
 *
 * --dry-run (default): só relata contagens/pre-checagem, nenhuma escrita.
 * --execute: roda a migracao dentro de uma unica transacao (BEGIN/COMMIT via $transaction).
 */

type ClubPair = {
  label: string;
  winnerClubId: number;
  loserClubId: number;
};

// Pares confirmados por query real contra cbtm_homolog nesta sessao (ids/nomes batendo com a Spec v2).
const CLUB_PAIRS: ClubPair[] = [
  { label: "ACADEMIA PING DRIVE LTDA", winnerClubId: 136, loserClubId: 205 },
  { label: "MARDEY TT / APANB", winnerClubId: 204, loserClubId: 187 },
  { label: "TENIS DE MESA SALINAS -TDMS", winnerClubId: 171, loserClubId: 198 },
  { label: "YOSHIDA TT - IGREJA CRISTA EVANGELICA DA AMAZONIA", winnerClubId: 170, loserClubId: 206 },
];

type AthletePairRow = {
  loserAthleteId: number;
  winnerAthleteId: number;
  eventId: number;
};

type Report = {
  dryRun: boolean;
  clubsBefore: number;
  athletesBefore: number;
  clubsAfter: number | null;
  athletesAfter: number | null;
  perPair: Array<{
    label: string;
    winnerClubId: number;
    loserClubId: number;
    winnerAthletesBefore: number;
    loserAthletesBefore: number;
    duplicateAthletePairs: number;
    simpleReassignAthletes: number;
  }>;
  matchParticipants: {
    totalRowsForLosers: number;
    collisionsDetected: number;
    reassigned: number | null;
  };
  athleteAliases: {
    totalRowsOnMergeLosers: number;
    discardedAlreadyCovered: number;
    reassignedNewAlias: number | null;
    caseByCaseNewAliasFound: Array<{ athleteId: number; aliasNormalized: string; winnerAthleteId: number }>;
  };
  athleteCategories: {
    totalRowsOnMergeLosers: number;
    collisionsDropped: number;
    reassignedNoCollision: number | null;
  };
  eventAthleteLinks: {
    note: string;
  };
  athleteMatchConflicts: {
    note: string;
    rowsReferencingDiscontinuedAthletes: number;
  };
  readModelCaches: {
    affectedEventIds: number[];
    deletedRows: number | null;
  };
  devDbUntouched: {
    checked: boolean;
    note: string;
  };
};

function parseArgs(argv: string[]): { execute: boolean } {
  return { execute: argv.includes("--execute") };
}

function loadEnv(): void {
  const rootEnv = path.resolve(process.cwd(), ".env");
  const apiEnv = path.resolve(process.cwd(), "apps/api/.env");
  const workerEnv = path.resolve(process.cwd(), "apps/worker/.env");
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv, override: false });
  if (fs.existsSync(apiEnv)) dotenv.config({ path: apiEnv, override: false });
  if (fs.existsSync(workerEnv)) dotenv.config({ path: workerEnv, override: false });
}

async function findDuplicateAthletePairs(
  prisma: PrismaClient,
  pair: ClubPair,
): Promise<AthletePairRow[]> {
  const rows = await prisma.$queryRawUnsafe<AthletePairRow[]>(
    `
    SELECT al.id AS "loserAthleteId", aw.id AS "winnerAthleteId", al.event_id AS "eventId"
    FROM athletes aw
    JOIN athletes al
      ON al.club_id = $2
     AND al.event_id = aw.event_id
     AND al.name_normalized = aw.name_normalized
    WHERE aw.club_id = $1
    `,
    pair.winnerClubId,
    pair.loserClubId,
  );
  return rows;
}

async function main(): Promise<void> {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !args.execute;

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL nao definido. Exemplo: DATABASE_URL=postgresql://... npx tsx scripts/pp-053-merge-clubs.ts");
  }

  const prisma = new PrismaClient();

  try {
    const clubsBefore = await prisma.club.count();
    const athletesBefore = await prisma.athlete.count();

    const report: Report = {
      dryRun,
      clubsBefore,
      athletesBefore,
      clubsAfter: null,
      athletesAfter: null,
      perPair: [],
      matchParticipants: { totalRowsForLosers: 0, collisionsDetected: 0, reassigned: null },
      athleteAliases: {
        totalRowsOnMergeLosers: 0,
        discardedAlreadyCovered: 0,
        reassignedNewAlias: null,
        caseByCaseNewAliasFound: [],
      },
      athleteCategories: { totalRowsOnMergeLosers: 0, collisionsDropped: 0, reassignedNoCollision: null },
      eventAthleteLinks: {
        note: "onDelete: SetNull nativo do schema — nenhuma acao manual necessaria (Cenario 4b).",
      },
      athleteMatchConflicts: {
        note:
          "FK nao mapeada na Spec original (achado desta execucao): athlete_match_conflicts.resolved_athlete_id " +
          "tem onDelete SET NULL (confdeltype='n'), mesmo comportamento de event_athlete_links. Verificado sem " +
          "impacto neste dataset (0 linhas referenciando atletas descontinuados) mas deve ser declarado.",
        rowsReferencingDiscontinuedAthletes: 0,
      },
      readModelCaches: { affectedEventIds: [], deletedRows: null },
      devDbUntouched: {
        checked: false,
        note: "Verificar manualmente fora deste script: cbtm (dev) nao deve ser tocado (T-I-03).",
      },
    };

    // Pre-checagem: mapear pares de atleta duplicado + contagem de reatribuicao simples por par.
    const allDuplicatePairs: Array<AthletePairRow & { clubPair: ClubPair }> = [];
    for (const pair of CLUB_PAIRS) {
      const winnerAthletesBefore = await prisma.athlete.count({ where: { clubId: pair.winnerClubId } });
      const loserAthletesBefore = await prisma.athlete.count({ where: { clubId: pair.loserClubId } });
      const duplicates = await findDuplicateAthletePairs(prisma, pair);
      for (const d of duplicates) {
        allDuplicatePairs.push({ ...d, clubPair: pair });
      }
      report.perPair.push({
        label: pair.label,
        winnerClubId: pair.winnerClubId,
        loserClubId: pair.loserClubId,
        winnerAthletesBefore,
        loserAthletesBefore,
        duplicateAthletePairs: duplicates.length,
        simpleReassignAthletes: loserAthletesBefore - duplicates.length,
      });
    }

    const loserAthleteIdsAllPairs = new Set(allDuplicatePairs.map((d) => d.loserAthleteId));

    // match_participants — colisao (matchId, athleteId) por par especifico loser->winner
    // (nao qualquer winner dos 4 pares — um loser so pode colidir com o SEU proprio winner).
    let mpCollisions = 0;
    let totalMpRows = 0;
    for (const dup of allDuplicatePairs) {
      const loserMatches = await prisma.matchParticipant.findMany({
        where: { athleteId: dup.loserAthleteId },
        select: { matchId: true },
      });
      totalMpRows += loserMatches.length;
      for (const lm of loserMatches) {
        const collides = await prisma.matchParticipant.findUnique({
          where: { matchId_athleteId: { matchId: lm.matchId, athleteId: dup.winnerAthleteId } },
        });
        if (collides) {
          mpCollisions += 1;
        }
      }
    }
    report.matchParticipants.totalRowsForLosers = totalMpRows;
    report.matchParticipants.collisionsDetected = mpCollisions;

    if (report.matchParticipants.collisionsDetected > 0) {
      throw new Error(
        `Colisao de match_participants detectada (${report.matchParticipants.collisionsDetected}) — abortando antes de qualquer escrita. Nao esperado pela pre-checagem da Spec.`,
      );
    }

    // athlete_aliases — caso a caso, apenas para os atletas com duplicata real (merge).
    for (const dup of allDuplicatePairs) {
      const loserAliases = await prisma.athleteAlias.findMany({ where: { athleteId: dup.loserAthleteId } });
      report.athleteAliases.totalRowsOnMergeLosers += loserAliases.length;
      for (const alias of loserAliases) {
        const existsInWinner = await prisma.athleteAlias.findFirst({
          where: { athleteId: dup.winnerAthleteId, aliasNormalized: alias.aliasNormalized },
        });
        if (existsInWinner) {
          report.athleteAliases.discardedAlreadyCovered += 1;
        } else {
          report.athleteAliases.caseByCaseNewAliasFound.push({
            athleteId: dup.loserAthleteId,
            aliasNormalized: alias.aliasNormalized,
            winnerAthleteId: dup.winnerAthleteId,
          });
        }
      }
    }

    // athlete_categories — colisao (athleteId, categoryId) apos merge.
    for (const dup of allDuplicatePairs) {
      const loserCategories = await prisma.athleteCategory.findMany({ where: { athleteId: dup.loserAthleteId } });
      report.athleteCategories.totalRowsOnMergeLosers += loserCategories.length;
      for (const cat of loserCategories) {
        const existsInWinner = await prisma.athleteCategory.findFirst({
          where: { athleteId: dup.winnerAthleteId, categoryId: cat.categoryId },
        });
        if (existsInWinner) {
          report.athleteCategories.collisionsDropped += 1;
        }
      }
    }

    // athlete_match_conflicts — achado adicional, verificar impacto real neste dataset.
    const allLoserAthleteIdsAnyPair = await prisma.athlete.findMany({
      where: { clubId: { in: CLUB_PAIRS.map((p) => p.loserClubId) } },
      select: { id: true },
    });
    const amcRows = await prisma.athleteMatchConflict.count({
      where: { resolvedAthleteId: { in: allLoserAthleteIdsAnyPair.map((a) => a.id) } },
    });
    report.athleteMatchConflicts.rowsReferencingDiscontinuedAthletes = amcRows;

    // read_model_caches — eventos afetados.
    const affectedEvents = await prisma.athlete.findMany({
      where: { clubId: { in: [...CLUB_PAIRS.map((p) => p.winnerClubId), ...CLUB_PAIRS.map((p) => p.loserClubId)] } },
      select: { eventId: true },
      distinct: ["eventId"],
    });
    report.readModelCaches.affectedEventIds = affectedEvents.map((e) => e.eventId).sort((a, b) => a - b);

    if (dryRun) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    // EXECUCAO — transacao unica, ordem UPDATE-antes-de-DELETE.
    await prisma.$transaction(async (tx) => {
      let reassignedMp = 0;
      let reassignedAliases = 0;
      let reassignedCategories = 0;

      // 1) match_participants: reatribuir athlete_id do perdedor para o vencedor (34 pares, 0 colisao).
      for (const dup of allDuplicatePairs) {
        const result = await tx.matchParticipant.updateMany({
          where: { athleteId: dup.loserAthleteId },
          data: { athleteId: dup.winnerAthleteId },
        });
        reassignedMp += result.count;
      }

      // 2) athlete_aliases: descartar se ja existir no vencedor; reatribuir caso a caso se for novo.
      for (const dup of allDuplicatePairs) {
        const loserAliases = await tx.athleteAlias.findMany({ where: { athleteId: dup.loserAthleteId } });
        for (const alias of loserAliases) {
          const existsInWinner = await tx.athleteAlias.findFirst({
            where: { athleteId: dup.winnerAthleteId, aliasNormalized: alias.aliasNormalized },
          });
          if (existsInWinner) {
            await tx.athleteAlias.delete({ where: { id: alias.id } });
          } else {
            await tx.athleteAlias.update({ where: { id: alias.id }, data: { athleteId: dup.winnerAthleteId } });
            reassignedAliases += 1;
          }
        }
      }

      // 3) athlete_categories: descartar colisao (winner ja tem a categoria); reatribuir se nao colidir.
      for (const dup of allDuplicatePairs) {
        const loserCategories = await tx.athleteCategory.findMany({ where: { athleteId: dup.loserAthleteId } });
        for (const cat of loserCategories) {
          const existsInWinner = await tx.athleteCategory.findFirst({
            where: { athleteId: dup.winnerAthleteId, categoryId: cat.categoryId },
          });
          if (existsInWinner) {
            await tx.athleteCategory.delete({
              where: { athleteId_categoryId: { athleteId: dup.loserAthleteId, categoryId: cat.categoryId } },
            });
          } else {
            await tx.athleteCategory.update({
              where: { athleteId_categoryId: { athleteId: dup.loserAthleteId, categoryId: cat.categoryId } },
              data: { athleteId: dup.winnerAthleteId },
            });
            reassignedCategories += 1;
          }
        }
      }

      // 4) Deletar os atletas duplicados (merge) — event_athlete_links/athlete_match_conflicts
      //    tratados nativamente via onDelete: SetNull.
      for (const dup of allDuplicatePairs) {
        await tx.athlete.delete({ where: { id: dup.loserAthleteId } });
      }

      // 5) Reatribuir club_id dos atletas nao-duplicados (simples) do clube perdedor para o vencedor.
      for (const pair of CLUB_PAIRS) {
        await tx.athlete.updateMany({
          where: { clubId: pair.loserClubId },
          data: { clubId: pair.winnerClubId },
        });
      }

      // 6) Deletar os clubes descontinuados (agora sem nenhum atleta vinculado).
      for (const pair of CLUB_PAIRS) {
        await tx.club.delete({ where: { id: pair.loserClubId } });
      }

      // 7) Invalidar read_model_caches dos eventos afetados.
      const deleted = await tx.readModelCache.deleteMany({
        where: { eventId: { in: report.readModelCaches.affectedEventIds } },
      });

      report.matchParticipants.reassigned = reassignedMp;
      report.athleteAliases.reassignedNewAlias = reassignedAliases;
      report.athleteCategories.reassignedNoCollision = reassignedCategories;
      report.readModelCaches.deletedRows = deleted.count;
    });

    report.clubsAfter = await prisma.club.count();
    report.athletesAfter = await prisma.athlete.count();

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
