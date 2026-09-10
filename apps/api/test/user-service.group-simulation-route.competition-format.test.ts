import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

test("PP-025 T-I-03 rota real do simulador propaga competitionFormat K1", async () => {
  let eventSelect: Record<string, unknown> | undefined;
  const prisma = {
    category: {
      async findMany() {
        return [
          {
            id: 200,
            eventId: 57,
            name: "DUPLA ABSOLUTO MASC",
            normalizedName: "dupla absoluto masc",
          },
        ];
      },
    },
    event: {
      async findMany(args: { select: Record<string, unknown> }) {
        eventSelect = args.select;
        return [{ id: 57, ratingMatchFormat: "RR_K1", competitionFormat: "K1" }];
      },
    },
    athleteCategory: {
      async findMany() {
        return Array.from({ length: 4 }, (_, index) => ({
          categoryId: 200,
          registrationStatus: "INSCRITO",
          rankingPoints: 1000 - index * 10,
          ratingPoints: 500 - index * 10,
          athlete: {
            id: index + 1,
            nameDisplay: `ATLETA ${index + 1}`,
            clubId: index + 1,
            club: { name: `CLUBE ${index + 1}` },
            rankingPoints: 1000 - index * 10,
            ratingPoints: 500 - index * 10,
          },
        }));
      },
    },
  };
  const service = new UserService(prisma as never, prisma as never) as any;
  service.resolveEventScope = async () => ({
    canonicalEventId: 57,
    allEventIds: [57],
    childSuffixByEventId: new Map(),
  });
  service.ensureEvent = async () => ({
    id: 57,
    concluido: false,
    inicioInscricoes: new Date("2099-04-01T00:00:00.000Z"),
    fimInscricoes: new Date("2099-04-20T00:00:00.000Z"),
    inicioRealizacao: new Date("2099-04-25T00:00:00.000Z"),
    fimRealizacao: new Date("2099-04-27T00:00:00.000Z"),
    dataInicio: new Date("2099-04-25T00:00:00.000Z"),
    dataFim: new Date("2099-04-27T00:00:00.000Z"),
  });
  service.readEventPublicationFlags = async () => ({
    hasPublishedMatches: false,
    hasPublishedResults: false,
  });
  service.eventHasOfficialGroups = async () => false;
  service.inferHistoricalGroupPreferences = async () => new Map();

  const response = await service.simulateGroups(57, 200, "confirmed", false);

  assert.equal(eventSelect?.competitionFormat, true);
  assert.equal(response.categories[0]?.groups.length, 0);
  assert.equal(response.categories[0]?.matchups.length, 2);
});
