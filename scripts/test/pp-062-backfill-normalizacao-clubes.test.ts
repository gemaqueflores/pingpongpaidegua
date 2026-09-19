import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverClubPairs,
  parseArgs,
  runClubCleanup,
  type CleanupDatabase,
  type ClubSnapshot,
} from "../pp-062-backfill-normalizacao-clubes";

const KNOWN_CLUBS: ClubSnapshot[] = [
  [132, "PARÁ CLUBE - PA", "para clube - pa", "2026-02-01"],
  [211, "PARÁ CLUBE - PA", "para clube", "2026-09-19"],
  [133, "GRÊMIO LITERÁRIO E RECREATIVO PORTUGUÊS - PA", "gremio literario e recreativo portugues - pa", "2026-02-01"],
  [214, "GRÊMIO LITERÁRIO E RECREATIVO PORTUGUÊS - PA", "gremio literario e recreativo portugues", "2026-09-19"],
  [134, "ASSEMBLÉIA PARAENSE - PA", "assembleia paraense - pa", "2026-02-01"],
  [212, "ASSEMBLÉIA PARAENSE - PA", "assembleia paraense", "2026-09-19"],
  [137, "CABANA CLUBE - PA", "cabana clube - pa", "2026-02-01"],
  [216, "CABANA CLUBE - PA", "cabana clube", "2026-09-19"],
  [138, "PAYSANDU SPORT CLUB - PA", "paysandu sport club - pa", "2026-02-01"],
  [215, "PAYSANDU SPORT CLUB - PA", "paysandu sport club", "2026-09-19"],
  [139, "BEL.TT/CAMINHO DO BEM-PA", "bel.tt/caminho do bem-pa", "2026-02-01"],
  [210, "BEL.TT/CAMINHO DO BEM-PA", "bel.tt/caminho do bem", "2026-09-19"],
  [144, "ASSOCIAÇÃO DE MESATENISTAS DE MARABÁ - PA", "associacao de mesatenistas de maraba - pa", "2026-02-01"],
  [219, "ASSOCIAÇÃO DE MESATENISTAS DE MARABÁ - PA", "associacao de mesatenistas de maraba", "2026-09-19"],
  [146, "ASSOCIAÇAO DE MESATENISTAS DE PARAUAPEBAS-PA", "associacao de mesatenistas de parauapebas-pa", "2026-02-01"],
  [218, "ASSOCIAÇAO DE MESATENISTAS DE PARAUAPEBAS-PA", "associacao de mesatenistas de parauapebas", "2026-09-19"],
  [170, "YOSHIDA TT - IGREJA CRISTÃ EVANGÉLICA DA AMAZONIA (PA)", "yoshida tt - igreja crista evangelica da amazonia (pa)", "2026-02-01"],
  [213, "YOSHIDA TT - IGREJA CRISTÃ EVANGÉLICA DA AMAZONIA (PA)", "yoshida tt - igreja crista evangelica da amazonia", "2026-09-19"],
  [204, "MARDEY TT / APANB - PA", "mardey tt / apanb - pa", "2026-02-01"],
  [217, "MARDEY TT / APANB - PA", "mardey tt / apanb", "2026-09-19"],
].map(([id, name, normalizedName, createdAt]) => ({
  id: id as number,
  name: name as string,
  normalizedName: normalizedName as string,
  createdAt: new Date(createdAt as string),
}));

function createReadOnlyDatabase(clubs: ClubSnapshot[]): CleanupDatabase {
  const forbiddenWrite = async (): Promise<never> => {
    throw new Error("dry-run tentou executar escrita");
  };

  return {
    club: {
      count: async () => clubs.length,
      findMany: async () => clubs,
      findUnique: async ({ where }: { where: { id: number } }) =>
        clubs.find((club) => club.id === where.id) ?? null,
      update: forbiddenWrite,
      delete: forbiddenWrite,
    },
    athlete: {
      count: async () => 2569,
      findMany: async () => [],
      updateMany: forbiddenWrite,
      delete: forbiddenWrite,
    },
    matchParticipant: { findMany: async () => [], deleteMany: forbiddenWrite, updateMany: forbiddenWrite },
    athleteAlias: { findMany: async () => [], delete: forbiddenWrite, update: forbiddenWrite },
    athleteCategory: { findMany: async () => [], delete: forbiddenWrite, update: forbiddenWrite },
    eventAthleteLink: { findMany: async () => [], delete: forbiddenWrite, update: forbiddenWrite },
    athleteMatchConflict: { count: async () => 0, updateMany: forbiddenWrite },
    readModelCache: { deleteMany: forbiddenWrite },
    $transaction: forbiddenWrite,
  } as unknown as CleanupDatabase;
}

test("T-U-01: descoberta dinâmica encontra os 10 pares conhecidos", () => {
  const pairs = discoverClubPairs(KNOWN_CLUBS);

  assert.equal(pairs.length, 10);
  assert.deepEqual(
    pairs.map(({ winnerClubId, duplicateClubId }) => [winnerClubId, duplicateClubId]),
    [[132, 211], [133, 214], [134, 212], [137, 216], [138, 215], [139, 210], [144, 219], [146, 218], [170, 213], [204, 217]],
  );
});

test("T-U-02: descoberta inclui par sintético sem lista fixa", () => {
  const synthetic: ClubSnapshot[] = [
    { id: 900, name: "CLUBE NOVO - PA", normalizedName: "clube novo - pa", createdAt: new Date("2026-01-01") },
    { id: 901, name: "CLUBE NOVO - PA", normalizedName: "clube novo", createdAt: new Date("2026-09-19") },
  ];

  const pairs = discoverClubPairs([...KNOWN_CLUBS, ...synthetic]);

  assert.ok(pairs.some((pair) => pair.winnerClubId === 900 && pair.duplicateClubId === 901));
});

test("T-I-01: dry-run preserva contagens e não executa escrita", async () => {
  const report = await runClubCleanup(createReadOnlyDatabase(KNOWN_CLUBS), ["--dry-run"]);

  assert.equal(report.mode, "dry-run");
  assert.equal(report.writesPerformed, false);
  assert.deepEqual(report.totals.after, report.totals.before);
  assert.equal(report.discoveredPairCount, 10);
});

test("T-I-02: clube correto e sem colisão não aparece no relatório", async () => {
  const cleanClub: ClubSnapshot = {
    id: 999,
    name: "CLUBE SEM DUPLICATA - PA",
    normalizedName: "clube sem duplicata",
    createdAt: new Date("2026-09-19"),
  };
  const report = await runClubCleanup(createReadOnlyDatabase([...KNOWN_CLUBS, cleanClub]), []);

  assert.equal(report.pairs.some((pair) => pair.winnerClubId === cleanClub.id || pair.duplicateClubId === cleanClub.id), false);
});

test("--execute precisa ser explícito e não combina com --dry-run", () => {
  assert.deepEqual(parseArgs([]), { execute: false });
  assert.deepEqual(parseArgs(["--dry-run"]), { execute: false });
  assert.deepEqual(parseArgs(["--execute"]), { execute: true });
  assert.throws(() => parseArgs(["--dry-run", "--execute"]), /mutuamente exclusivas/);
  assert.throws(() => parseArgs(["--unknown"]), /Argumento desconhecido/);
});
