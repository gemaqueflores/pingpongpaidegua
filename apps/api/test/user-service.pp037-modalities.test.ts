import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

// Synthetic unit fixtures; no claim about official event totals.
async function rankingFor(categoryNames: string[]) {
  const categories = categoryNames.map((name, index) => ({
    id: index + 1, name, eventId: 1, cbtmCategoryId: String(index + 1),
  }));
  const athletes = categories.map((category) => ({
    id: category.id, nameDisplay: `ATLETA ${category.id}`, clubId: 1,
  }));
  const prisma = {
    club: { findMany: async () => [{ id: 1, name: "CLUBE TESTE", athletes }] },
    athlete: { findMany: async () => athletes.map((athlete) => ({
      clubId: 1, nameNormalized: athlete.nameDisplay,
    })) },
    category: { findMany: async () => categories },
    event: { findMany: async () => [{
      id: 1, nome: "ETAPA TESTE", nivel: "ESTADUAL", dataInicio: new Date("2026-01-01"),
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
  return (service as any).computeEfficiencyRanking({ eventIds: [1] });
}

test("PP-037 T-U-01 ranking soma somente o ouro individual", async () => {
  const result = await rankingFor(["RATING A", "DUPLAS MASCULINAS"]);
  assert.equal(result.ranking[0].ouro, 1);
  assert.equal(result.ranking[0].totalQuantidade, 1);
  assert.equal(result.ranking[0].totalPontuacao, 130);
});
