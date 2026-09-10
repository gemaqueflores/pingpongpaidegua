import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

test("PP-025 T-I-04 agregado resolve competitionFormat por category.eventId", async () => {
  const category = {
    id: 200,
    eventId: 57,
    name: "DUPLA ABSOLUTO MASC",
    normalizedName: "dupla absoluto masc",
    cbtmCategoryId: 5828001,
  };
  const prisma = {
    category: {
      async findMany() {
        return [category];
      },
    },
    event: {
      async findMany() {
        return [
          { id: 55, ratingMatchFormat: "RR_K1", competitionFormat: "AUTO" },
          { id: 57, ratingMatchFormat: "RR_K1", competitionFormat: "K1" },
        ];
      },
    },
    match: {
      async groupBy() {
        return [];
      },
    },
    athleteCategory: {
      async groupBy() {
        return [{ categoryId: 200, _count: { _all: 4 } }];
      },
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
  service.loadEventRegistrationMetrics = async () => ({
    athleteCategoryAssociationsByEvent: new Map([[57, 4]]),
    tecnicoClubAssociationsByEvent: new Map(),
    participantNamesByEvent: new Map([[57, new Set(["a", "b", "c", "d"])]]),
  });
  service.loadLatestOfficialCategoryAuditByEvent = async () =>
    new Map([
      [
        57,
        new Map([
          [
            "5828001",
            {
              categoryId: "5828001",
              categoryName: category.name,
              valid: true,
              registeredCount: 4,
              preRegisteredCount: 0,
              totalListedCount: 4,
              officialMatchesCount: 6,
            },
          ],
        ]),
      ],
    ]);
  service.countWalkoversByCategoryIds = async () => new Map([[200, 0]]);
  service.resolveEventScope = async () => ({
    canonicalEventId: 55,
    allEventIds: [55, 57],
    childSuffixByEventId: new Map([[57, " - DUPLAS"]]),
  });
  service.ensureEvent = async () => ({
    id: 55,
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

  const metrics = await service.loadScopedEventSummaryMetrics([
    {
      id: 55,
      lastScrapeAt: null,
      dataInicio: null,
      inicioRealizacao: null,
      ratingMatchFormat: "RR_K1",
      competitionFormat: "AUTO",
    },
    {
      id: 57,
      lastScrapeAt: null,
      dataInicio: null,
      inicioRealizacao: null,
      ratingMatchFormat: "RR_K1",
      competitionFormat: "K1",
    },
  ]);
  const simulation = await service.simulateGroups(55, 200, "confirmed", false);

  assert.equal(metrics.officialTotalsByEvent.get(57)?.totalMatches, 3);
  assert.equal(simulation.categories[0]?.groups.length, 0);
  assert.equal(simulation.categories[0]?.matchups.length, 2);
});
