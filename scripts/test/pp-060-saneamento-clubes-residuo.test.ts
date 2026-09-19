import assert from "node:assert/strict";
import test from "node:test";

import {
  CLUB_PAIRS,
  parseArgs,
  runClubCleanup,
  type CleanupDatabase,
} from "../pp-060-saneamento-clubes-residuo";

const EXPECTED_PAIRS = [
  [132, 211],
  [133, 214],
  [134, 212],
  [137, 216],
  [138, 215],
  [139, 210],
  [144, 219],
  [146, 218],
  [170, 213],
  [204, 217],
];

function createReadOnlyDatabase(): CleanupDatabase {
  const forbiddenWrite = async (): Promise<never> => {
    throw new Error("dry-run tentou executar escrita");
  };

  return {
    club: {
      count: async () => 67,
      findUnique: async ({ where }: { where: { id: number } }) => ({
        id: where.id,
        name: `Clube ${where.id}`,
      }),
      delete: forbiddenWrite,
    },
    athlete: {
      count: async () => 2569,
      findMany: async () => [],
      updateMany: forbiddenWrite,
      delete: forbiddenWrite,
    },
    matchParticipant: {
      findMany: async () => [],
      deleteMany: forbiddenWrite,
      updateMany: forbiddenWrite,
    },
    athleteAlias: {
      findMany: async () => [],
      delete: forbiddenWrite,
      update: forbiddenWrite,
    },
    athleteCategory: {
      findMany: async () => [],
      delete: forbiddenWrite,
      update: forbiddenWrite,
    },
    eventAthleteLink: {
      findMany: async () => [],
      delete: forbiddenWrite,
      update: forbiddenWrite,
    },
    athleteMatchConflict: {
      count: async () => 0,
      updateMany: forbiddenWrite,
    },
    readModelCache: {
      deleteMany: forbiddenWrite,
    },
    $transaction: forbiddenWrite,
  } as unknown as CleanupDatabase;
}

test("T-U-01: dry-run mantém contagens e nunca abre transação de escrita", async () => {
  const database = createReadOnlyDatabase();

  const report = await runClubCleanup(database, ["--dry-run"]);

  assert.equal(report.mode, "dry-run");
  assert.equal(report.writesPerformed, false);
  assert.deepEqual(report.totals.after, report.totals.before);
  assert.deepEqual(
    report.pairs.map((pair) => [pair.winnerClubId, pair.duplicateClubId]),
    EXPECTED_PAIRS,
  );
});

test("T-I-02: somente os 10 pares explícitos da Spec compõem o plano", () => {
  assert.deepEqual(
    CLUB_PAIRS.map((pair) => [pair.winnerClubId, pair.duplicateClubId]),
    EXPECTED_PAIRS,
  );
});

test("--execute precisa ser explícito e não pode ser combinado com --dry-run", () => {
  assert.deepEqual(parseArgs([]), { execute: false });
  assert.deepEqual(parseArgs(["--dry-run"]), { execute: false });
  assert.deepEqual(parseArgs(["--execute"]), { execute: true });
  assert.throws(() => parseArgs(["--dry-run", "--execute"]), /mutuamente exclusivas/);
  assert.throws(() => parseArgs(["--unknown"]), /Argumento desconhecido/);
});
