import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

test("athlete career inclui confrontos de dupla quando a chave representa um par", async () => {
  const pairAthlete = {
    id: 100,
    eventId: 45,
    nameDisplay: "ALEXANDRE BATISTA # LEONARDO FLORES",
    nameNormalized: "alexandre batista # leonardo flores",
    stateCode: null,
    stateName: null,
    region: null,
    aliases: [],
  };

  const rawMatch = {
    id: 900,
    eventId: 45,
    categoryId: 200,
    cbtmMatchId: null,
    phase: "RESULTADOS",
    round: "Grupo 02",
    tableNumber: "4",
    matchDatetime: new Date("2026-03-28T10:00:00.000Z"),
    scoreRaw: "0-3",
    setsJson: null,
    scoreFinal: { setsA: 0, setsB: 3 },
    scoreSets: [
      { set: 1, a: 5, b: 11 },
      { set: 2, a: 8, b: 11 },
      { set: 3, a: 7, b: 11 },
    ],
    sourceFlags: null,
    p1Sets: null,
    p2Sets: null,
    winnerIndex: 1,
    scorePlayers: [
      { name: "LEONARDO FLORES - ALEXANDRE BATISTA", athleteId: null },
      { name: "EFSON GOMES - CRISTIAN SILVA", athleteId: 5650 },
    ],
    sourceUrl: "https://app.cbtm.org.br/IUI/App/Evento?EVE_Evento_ID=5476",
    fetchedAt: new Date("2026-03-28T10:05:00.000Z"),
    matchKey: "pair-match",
    event: {
      id: 45,
      cbtmEventId: 5476,
      nome: "2TMB26 - DUPLAS",
      nivel: "ESTADUAL",
      dataInicio: new Date("2026-03-28T00:00:00.000Z"),
      dataFim: new Date("2026-03-29T00:00:00.000Z"),
      concluido: true,
    },
    category: {
      id: 200,
      name: "ABSOLUTO G (MAS)",
      cbtmCategoryId: "310",
    },
    participants: [
      {
        athleteId: 5650,
        athlete: {
          id: 5650,
          nameDisplay: "CRISTIAN # EFSON GOMES",
          club: { id: 1, name: "CLUBE B" },
        },
      },
    ],
  };

  const prisma = {
    athlete: {
      async findMany() {
        return [pairAthlete];
      },
    },
    athleteCategory: {
      async findMany() {
        return [{ categoryId: 200 }];
      },
    },
    match: {
      async findMany() {
        return [rawMatch];
      },
    },
  };

  const service = new UserService(prisma as never, prisma as never);
  const result = await service.getAthleteCareer("alexandre batista leonardo flores");

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.matches.length, 1);
  assert.equal(result.events[0]?.matches[0]?.category.name, "ABSOLUTO G (MAS)");
  assert.equal(result.events[0]?.matches[0]?.athlete?.name, "LEONARDO FLORES - ALEXANDRE BATISTA");
  assert.equal(result.events[0]?.matches[0]?.athleteKey, "leonardo flores alexandre batista");
  assert.equal(result.events[0]?.matches[0]?.opponent?.name, "CRISTIAN # EFSON GOMES");
});
