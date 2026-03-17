import assert from "node:assert/strict";
import test from "node:test";
import { buildResolverCandidates, resolveByCategoryHistory } from "../src/pipeline/athlete-resolution";

test("buildResolverCandidates filtra por evento, categoria e exclui atletas de warning", () => {
  const athletesById = new Map([
    [
      1,
      {
        id: 1,
        eventId: 43,
        nameDisplay: "ATLETA A",
        nameNormalized: "atleta a",
        rankingPoints: 100,
        ratingPoints: 90,
        clubNormalizedName: "clube-a",
        createdFromWarning: false,
        aliases: new Set(["atleta a", "a atleta"]),
      },
    ],
    [
      2,
      {
        id: 2,
        eventId: 43,
        nameDisplay: "ATLETA B",
        nameNormalized: "atleta b",
        rankingPoints: 80,
        ratingPoints: 70,
        clubNormalizedName: "clube-b",
        createdFromWarning: true,
        aliases: new Set(["atleta b"]),
      },
    ],
    [
      3,
      {
        id: 3,
        eventId: 44,
        nameDisplay: "ATLETA C",
        nameNormalized: "atleta c",
        rankingPoints: 60,
        ratingPoints: 50,
        clubNormalizedName: "clube-c",
        createdFromWarning: false,
        aliases: new Set(["atleta c"]),
      },
    ],
  ]);

  const result = buildResolverCandidates({
    eventId: 43,
    athletesById,
    categoryAthleteIds: new Set([1, 2, 3]),
  });

  assert.deepEqual(result, [
    {
      athleteId: 1,
      eventId: 43,
      nameDisplay: "ATLETA A",
      nameNormalized: "atleta a",
      rankingPoints: 100,
      ratingPoints: 90,
      clubNormalizedName: "clube-a",
      aliasesNormalized: ["atleta a", "a atleta"],
    },
  ]);
});

test("resolveByCategoryHistory escolhe candidato com historico dominante e rejeita empate", () => {
  const candidates = [{ id: 1, name: "A" }, { id: 2, name: "B" }];

  const winner = resolveByCategoryHistory(
    candidates,
    new Map([
      [1, 3],
      [2, 1],
    ]),
  );
  assert.deepEqual(winner, { id: 1, name: "A" });

  const tied = resolveByCategoryHistory(
    candidates,
    new Map([
      [1, 2],
      [2, 2],
    ]),
  );
  assert.equal(tied, null);

  const noHistory = resolveByCategoryHistory(candidates, new Map([[1, 0]]));
  assert.equal(noHistory, null);
});
