import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

function createService(prisma: Record<string, unknown>) {
  const service = new UserService(prisma as never, prisma as never) as UserService & {
    resolveEventScope(eventId: number): Promise<{
      canonicalEventId: number;
      allEventIds: number[];
      childSuffixByEventId: Map<number, string>;
    }>;
    ensureEvent(eventId: number): Promise<Record<string, unknown>>;
    getStateCircuitEligibleClubIds(): Promise<Set<number>>;
    ensureStableAthleteRouteIds(
      athletes: Array<{
        eventId: number;
        athleteId: number;
        athleteName: string;
        athleteNameNormalized: string;
        clubNormalizedName: string | null;
      }>,
    ): Promise<Map<number, number>>;
    ensureCategoryOfEvent(eventIds: number[], categoryId: number): Promise<void>;
  };

  service.resolveEventScope = async (eventId: number) => ({
    canonicalEventId: eventId,
    allEventIds: [eventId],
    childSuffixByEventId: new Map<number, string>(),
  });
  service.ensureEvent = async (eventId: number) => ({ id: eventId });
  service.getStateCircuitEligibleClubIds = async () => new Set([1, 2, 3]);
  service.ensureStableAthleteRouteIds = async (athletes) =>
    new Map(athletes.map((athlete) => [athlete.athleteId, athlete.athleteId]));
  service.ensureCategoryOfEvent = async () => undefined;

  return service;
}

test("listAthletes exige registrationStatus INSCRITO", async () => {
  let whereArg: Record<string, unknown> | null = null;
  const prisma = {
    athlete: {
      async findMany(args: { where: Record<string, unknown> }) {
        whereArg = args.where;
        return [];
      },
    },
  };

  const service = createService(prisma);
  await service.listAthletes(44, "");

  assert.equal(
    ((whereArg?.categories as { some?: { registrationStatus?: string } })?.some?.registrationStatus ?? null),
    "INSCRITO",
  );
});

test("listAthletes busca por nome normalizado sem depender de acentos", async () => {
  let whereArg: Record<string, unknown> | null = null;
  const prisma = {
    athlete: {
      async findMany(args: { where: Record<string, unknown> }) {
        whereArg = args.where;
        return [];
      },
    },
  };

  const service = createService(prisma);
  await service.listAthletes(44, "cassio");

  const andClauses = (whereArg?.AND as Array<Record<string, unknown>>) ?? [];
  const searchClause = andClauses.find((item) => "nameNormalized" in item) as
    | { nameNormalized?: { contains?: string } }
    | undefined;

  assert.equal(searchClause?.nameNormalized?.contains, "cassio");
});

test("listClubs exige registrationStatus INSCRITO no filtro principal e na contagem por clube", async () => {
  const clubWhereArgs: Array<Record<string, unknown>> = [];
  const athleteWhereArgs: Array<Record<string, unknown>> = [];
  const prisma = {
    club: {
      async findMany(args: { where: Record<string, unknown> }) {
        clubWhereArgs.push(args.where);
        return [{ id: 1, name: "CLUBE A" }];
      },
    },
    athlete: {
      async findMany(args: { where: Record<string, unknown> }) {
        athleteWhereArgs.push(args.where);
        return [{ clubId: 1, nameNormalized: "atleta a" }];
      },
    },
  };

  const service = createService(prisma);
  const result = await service.listClubs(44, "", null);

  assert.equal(result.length, 1);
  assert.equal(
    (((clubWhereArgs[0]?.athletes as { some?: { categories?: { some?: { registrationStatus?: string } } } })?.some
      ?.categories as { some?: { registrationStatus?: string } })?.some?.registrationStatus ?? null),
    "INSCRITO",
  );
  assert.equal(
    (((athleteWhereArgs[0]?.categories as { some?: { registrationStatus?: string } })?.some?.registrationStatus ??
      null)),
    "INSCRITO",
  );
});

test("listClubs conta atleta agregado apenas uma vez por clube e nome normalizado", async () => {
  let athleteFindManyArgs: { distinct?: string[] } | null = null;
  const prisma = {
    club: {
      async findMany() {
        return [{ id: 1, name: "CLUBE A" }];
      },
    },
    athlete: {
      async findMany(args: { distinct?: string[] }) {
        athleteFindManyArgs = args;
        return [{ clubId: 1, nameNormalized: "atleta a" }];
      },
    },
  };

  const service = createService(prisma);
  await service.listClubs(44, "", null);

  assert.deepEqual(athleteFindManyArgs?.distinct, ["clubId", "nameNormalized"]);
});

test("listClubs busca por nome normalizado sem depender de acentos", async () => {
  const clubWhereArgs: Array<Record<string, unknown>> = [];
  const prisma = {
    club: {
      async findMany(args: { where: Record<string, unknown> }) {
        clubWhereArgs.push(args.where);
        return [];
      },
    },
  };

  const service = createService(prisma);
  await service.listClubs(44, "associacao", null);

  assert.equal((clubWhereArgs[0]?.normalizedName as { contains?: string })?.contains, "associacao");
});

test("listClubAthletes exige registrationStatus INSCRITO no lookup do clube e dos atletas", async () => {
  let clubWhereArg: Record<string, unknown> | null = null;
  let athleteWhereArg: Record<string, unknown> | null = null;
  const prisma = {
    club: {
      normalizedName: "clube-a",
      async findFirst(args: { where: Record<string, unknown> }) {
        clubWhereArg = args.where;
        return { id: 1, name: "CLUBE A", normalizedName: "clube-a" };
      },
    },
    athlete: {
      async findMany(args: { where: Record<string, unknown> }) {
        athleteWhereArg = args.where;
        return [
          {
            id: 10,
            eventId: 44,
            nameDisplay: "ATLETA A",
            nameNormalized: "atleta a",
            stateCode: "PA",
            region: "NORTE",
            categories: [
              {
                registrationStatus: "INSCRITO",
                category: {
                  id: 100,
                  eventId: 44,
                  name: "ABSOLUTO A",
                },
              },
            ],
          },
        ];
      },
    },
  };

  const service = createService(prisma);
  const result = await service.listClubAthletes(44, 1, null);

  assert.equal(result.athletes.length, 1);
  assert.equal(
    ((((clubWhereArg?.athletes as { some?: { categories?: { some?: { registrationStatus?: string } } } })?.some
      ?.categories as { some?: { registrationStatus?: string } })?.some?.registrationStatus ?? null)),
    "INSCRITO",
  );
  assert.equal(
    (((athleteWhereArg?.categories as { some?: { registrationStatus?: string } })?.some?.registrationStatus ??
      null)),
    "INSCRITO",
  );
});

test("listClubAthletes agrega categorias de child events com sufixo no evento canonico", async () => {
  const prisma = {
    club: {
      async findFirst() {
        return { id: 1, name: "CLUBE A", normalizedName: "clube-a" };
      },
    },
    athlete: {
      async findMany() {
        return [
          {
            id: 10,
            eventId: 44,
            nameDisplay: "ATLETA A",
            nameNormalized: "atleta a",
            stateCode: "PA",
            region: "NORTE",
            categories: [
              {
                registrationStatus: "INSCRITO",
                category: {
                  id: 100,
                  eventId: 44,
                  name: "ABSOLUTO A",
                },
              },
            ],
          },
          {
            id: 20,
            eventId: 45,
            nameDisplay: "ATLETA A",
            nameNormalized: "atleta a",
            stateCode: "PA",
            region: "NORTE",
            categories: [
              {
                registrationStatus: "INSCRITO",
                category: {
                  id: 200,
                  eventId: 45,
                  name: "ABSOLUTO A",
                },
              },
            ],
          },
        ];
      },
    },
  };

  const service = createService(prisma);
  service.resolveEventScope = async (eventId: number) => ({
    canonicalEventId: eventId,
    allEventIds: [44, 45],
    childSuffixByEventId: new Map([[45, " - DUPLAS"]]),
  });

  const result = await service.listClubAthletes(44, 1, null);

  assert.equal(result.athletes.length, 1);
  assert.deepEqual(result.athletes[0]?.categoryNames, ["ABSOLUTO A", "ABSOLUTO A - DUPLAS"]);
});

test("listCategories aplica sufixo de child event no evento agregado", async () => {
  const prisma = {
    category: {
      async findMany() {
        return [
          {
            id: 100,
            eventId: 44,
            name: "ABSOLUTO A",
            normalizedName: "absoluto a",
            cbtmCategoryId: 1,
          },
          {
            id: 200,
            eventId: 45,
            name: "ABSOLUTO A",
            normalizedName: "absoluto a",
            cbtmCategoryId: 2,
          },
        ];
      },
    },
  };

  const service = createService(prisma);
  service.resolveEventScope = async (eventId: number) => ({
    canonicalEventId: eventId,
    allEventIds: [44, 45],
    childSuffixByEventId: new Map([[45, " - DUPLAS"]]),
  });

  const result = await service.listCategories(44);

  assert.deepEqual(
    result.map((item) => ({ id: item.id, name: item.name })),
    [
      { id: 100, name: "ABSOLUTO A" },
      { id: 200, name: "ABSOLUTO A - DUPLAS" },
    ],
  );
});

test("listAthleteDirectory preserva nome reduzido de duplas sem colapsar os dois integrantes", async () => {
  const prisma = {
    athlete: {
      async findMany() {
        return [
          {
            id: 10,
            eventId: 46,
            nameDisplay: "EDSON SILVA # LUDMILLA LIMA",
            nameNormalized: "edson silva # ludmilla lima",
          },
        ];
      },
    },
    athleteCategory: {
      async findMany() {
        return [{ athleteId: 10, categoryId: 1538 }];
      },
    },
    match: {
      async findMany() {
        return [
          {
            id: 100,
            eventId: 46,
            categoryId: 1538,
            scorePlayers: [
              { name: "EDSON SILVA - LUDMILLA LIMA" },
              { name: "OPONENTE A # OPONENTE B" },
            ],
            participants: [],
          },
        ];
      },
    },
  };

  const service = createService(prisma);
  const result = await service.listAthleteDirectory("edson");

  assert.equal(result.length, 1);
  assert.equal(result[0]?.nameDisplay, "EDSON SILVA # LUDMILLA LIMA");
  assert.equal(result[0]?.nameReduced, "EDSON SILVA # LUDMILLA LIMA");
});

test("listAthleteDirectory busca por nome normalizado sem depender de acentos", async () => {
  let whereArg: Record<string, unknown> | null = null;
  const prisma = {
    athlete: {
      async findMany(args: { where: Record<string, unknown> }) {
        whereArg = args.where;
        return [];
      },
    },
  };

  const service = createService(prisma);
  await service.listAthleteDirectory("adonis");

  assert.equal((whereArg?.nameNormalized as { contains?: string })?.contains, "adonis");
});

test("listAthleteDirectory oculta par sem lastro competitivo publicado", async () => {
  const prisma = {
    athlete: {
      async findMany() {
        return [
          {
            id: 10,
            eventId: 46,
            nameDisplay: "DEBORA FLORES # REBECA FLORES",
            nameNormalized: "debora flores # rebeca flores",
          },
        ];
      },
    },
    athleteCategory: {
      async findMany() {
        return [{ athleteId: 10, categoryId: 1530 }];
      },
    },
    match: {
      async findMany() {
        return [];
      },
    },
  };

  const service = createService(prisma);
  const result = await service.listAthleteDirectory("debora");

  assert.deepEqual(result, []);
});

test("listAthleteDirectory mantem par com resultado publicado como lastro competitivo", async () => {
  const prisma = {
    athlete: {
      async findMany() {
        return [
          {
            id: 10,
            eventId: 46,
            nameDisplay: "ADONIS # ISABELA OLIVEIRA",
            nameNormalized: "adonis # isabela oliveira",
          },
        ];
      },
    },
    athleteCategory: {
      async findMany() {
        return [{ athleteId: 10, categoryId: 1538 }];
      },
    },
    match: {
      async findMany() {
        return [
          {
            id: 100,
            eventId: 46,
            categoryId: 1538,
            scorePlayers: [
              { name: "ADONIS AZEVEDO - ISABELA OLIVEIRA" },
              { name: "LUCAS MENEZES # YUKARI SATO" },
            ],
            participants: [],
          },
        ];
      },
    },
  };

  const service = createService(prisma);
  const result = await service.listAthleteDirectory("adonis");

  assert.equal(result.length, 1);
  assert.equal(result[0]?.nameDisplay, "ADONIS # ISABELA OLIVEIRA");
});
