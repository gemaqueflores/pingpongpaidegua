import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

// Synthetic unit fixtures; no claim about official event totals.
async function rankingFor(categoryNames: string[], internal = false, context: { eventName?: string; athleteNames?: string[] } = {}) {
  const categories = categoryNames.map((name, index) => ({
    id: index + 1, name, eventId: 1, cbtmCategoryId: String(index + 1),
  }));
  const athletes = categories.map((category) => ({
    id: category.id, nameDisplay: context.athleteNames?.[category.id - 1] ?? `ATLETA ${category.id}`, clubId: 1,
  }));
  const prisma = {
    club: { findMany: async () => [{ id: 1, name: "CLUBE TESTE", athletes }] },
    athlete: { findMany: async () => athletes.map((athlete) => ({
      clubId: 1, nameNormalized: athlete.nameDisplay,
    })) },
    category: { findMany: async () => categories },
    event: { findMany: async () => [{
      id: 1, nome: context.eventName ?? "ETAPA TESTE", nivel: "ESTADUAL", dataInicio: new Date("2026-01-01"),
    }] },
    athleteCategory: { findMany: async (query: { where: { categoryId: { in: number[] } } }) =>
      categories.filter((category) => query.where.categoryId.in.includes(category.id))
        .map((category) => ({ categoryId: category.id, athlete: athletes[category.id - 1] })) },
    match: { findMany: async () => [] },
  };
  const service = new UserService(prisma as never, prisma as never);
  Object.assign(service, {
    getStateCircuitEligibleClubIds: async () => new Set([1]),
    getEfficiencyWeights: async () => ({ pesoOuro: 130, pesoPrata: 80, pesoBronze: 50 }),
    computeCategoryPositionByAthleteId: () => new Map(athletes.map((athlete) => [athlete.id, 1])),
  });
  return internal
    ? (service as any).computeEfficiencyRankingByModality({ eventIds: [1] })
    : (service as any).computeEfficiencyRanking({ eventIds: [1] });
}

test("PP-037 T-U-01 ranking soma somente o ouro individual", async () => {
  const result = await rankingFor(["RATING A", "DUPLAS MASCULINAS"]);
  assert.equal(result.ranking[0].ouro, 1);
  assert.equal(result.ranking[0].totalQuantidade, 1);
  assert.equal(result.ranking[0].totalPontuacao, 390); // 1 ouro x 130 x estadual 3.
  assert.deepEqual(Object.keys(result).sort(), ["ranking", "weights"]);
  const separated = await rankingFor(["RATING A", "DUPLAS MASCULINAS"], true);
  assert.equal(separated.doubles[0].ouro, 1);
  assert.equal(separated.doubles[0].totalPontuacao, 390);
});

async function careerFor(pairCategoryName = "ABSOLUTO B", pairEventName = "ETAPA TESTE", includePair = true, internal = false) {
  const athlete = { id: 1, eventId: 1, nameDisplay: "ALICE", nameNormalized: "alice", aliases: [] };
  const event = { id: 1, nome: "ETAPA TESTE", nivel: "ESTADUAL", dataInicio: new Date("2026-01-01") };
  const matches = [false, ...(includePair ? [true] : [])].map((pair, index) => ({
    id: index + 1, eventId: 1, categoryId: index + 1,
    event: { ...event, nome: pair ? pairEventName : event.nome },
    category: { id: index + 1, name: pair ? pairCategoryName : "RATING A", cbtmCategoryId: String(index + 1) },
    phase: "RESULTADOS", round: "Final", matchKey: `final-${index}`,
    scoreRaw: "1-3", scoreFinal: { setsA: 1, setsB: 3 }, winnerIndex: 1,
    scoreSets: [{ set: 1, a: 11, b: 9 }, { set: 2, a: 8, b: 11 }, { set: 3, a: 7, b: 11 }, { set: 4, a: 6, b: 11 }],
    scorePlayers: [{ athleteId: 1, name: pair ? "ALICE # BIA" : "ALICE" }, { athleteId: 2, name: pair ? "CARLA # DORA" : "CARLA" }],
    participants: [
      { athleteId: 1, athlete: { ...athlete, nameDisplay: pair ? "ALICE # BIA" : "ALICE", club: { id: 1, name: "CLUBE TESTE" } } },
      { athleteId: 2, athlete: { id: 2, nameDisplay: pair ? "CARLA # DORA" : "CARLA", club: { id: 2, name: "OUTRO CLUBE" } } },
    ],
  }));
  const prisma = {
    athlete: { findMany: async () => [athlete] },
    athleteCategory: { findMany: async () => matches.map((match) => ({ categoryId: match.categoryId })) },
    match: { findMany: async () => matches },
  };
  const service = new UserService(prisma as never, prisma as never);
  return internal ? (service as any).getAthleteCareerByModality("alice") : service.getAthleteCareer("alice");
}

test("PP-037 T-U-02 carreira soma somente a prata individual", async () => {
  const result = await careerFor();
  assert.equal(result.medalTable.ESTADUAL.prata, 1);
  assert.equal(result.events[0].performanceByCategory.length, 1);
  assert.equal(result.totals.matches, 1);
  assert.equal(result.totals.performance.pointsWon, 32);
  assert.equal(result.totals.performance.pointsPlayed, 74);
  const separated = await careerFor("ABSOLUTO B", "ETAPA TESTE", true, true);
  assert.equal(separated.doubles.medalTable.ESTADUAL.prata, 1);
  assert.equal(separated.doubles.totals.matches, 1);
  assert.equal(separated.doubles.totals.performance.pointsWon, 32);
  assert.equal("doubles" in result, false);
});

test("PP-037 T-U-03 duplas mistas por categoria, evento ou nome nao contaminam o ranking", async () => {
  const named = await rankingFor(["RATING A", "DUPLA MISTA SUB-13"]);
  assert.equal(named.ranking[0].ouro, 1);
  const eventOnly = await rankingFor(["ABSOLUTO A"], true, { eventName: "ETAPA DUPLAS MISTAS" });
  assert.equal(eventOnly.individual[0].ouro, 0);
  assert.equal(eventOnly.doubles[0].ouro, 1);
  const pairOnly = await rankingFor(["ABSOLUTO A"], true, { athleteNames: ["ALICE # BRUNO"] });
  assert.equal(pairOnly.individual[0].ouro, 0);
  assert.equal(pairOnly.doubles[0].ouro, 1);
});

test("PP-037 T-U-03 carreira preserva prata mista somente na estrutura interna", async () => {
  const result = await careerFor("DUPLA MISTA SUB-13", "ETAPA TESTE", true, true);
  assert.equal(result.individual.medalTable.ESTADUAL.prata, 1);
  assert.equal(result.doubles.medalTable.ESTADUAL.prata, 1);
});
