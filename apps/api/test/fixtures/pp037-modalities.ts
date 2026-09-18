import { UserService } from "../../src/user/user.service";

// Synthetic unit fixtures; no claim about official event totals.
export async function rankingFor(categoryNames: string[], internal = false, context: { eventName?: string; athleteNames?: string[] } = {}) {
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

export async function careerFor(pairCategoryName = "ABSOLUTO B", pairEventName = "ETAPA TESTE", includePair = true, internal = false) {
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
