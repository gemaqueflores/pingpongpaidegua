import { describe, expect, it } from "vitest";
import { getMatchPhaseOrder, getRoundSemanticOrder, resolveAthleteCandidate } from "../src/index";

describe("resolveAthleteCandidate", () => {
  const candidates = [
    {
      athleteId: 1,
      eventId: 5246,
      nameDisplay: "DAVI TUMA FURTADO",
      nameNormalized: "davi tuma furtado",
      rankingPoints: 10,
      ratingPoints: 352,
      clubNormalizedName: "beltt/caminho do bem-pa",
      aliasesNormalized: ["davi tuma furtado", "davi furtado"],
    },
    {
      athleteId: 2,
      eventId: 5246,
      nameDisplay: "FERNANDO ALVES SILVA",
      nameNormalized: "fernando alves silva",
      rankingPoints: 370,
      ratingPoints: 394,
      clubNormalizedName: "cabana clube - pa",
      aliasesNormalized: ["fernando silva"],
    },
    {
      athleteId: 3,
      eventId: 5246,
      nameDisplay: "VICTOR HENRIQUE DOS REIS MARTINS",
      nameNormalized: "victor henrique dos reis martins",
      rankingPoints: 0,
      ratingPoints: 596,
      clubNormalizedName: "amazonia clube",
      aliasesNormalized: ["victor martins"],
    },
    {
      athleteId: 4,
      eventId: 5246,
      nameDisplay: "JOAO VICTOR RIBEIRO CARDOSO",
      nameNormalized: "joao victor ribeiro cardoso",
      rankingPoints: 60,
      ratingPoints: 410,
      clubNormalizedName: "clube a",
      aliasesNormalized: [],
    },
    {
      athleteId: 5,
      eventId: 5246,
      nameDisplay: "JOAO PAULO SILVA SANTOS",
      nameNormalized: "joao paulo silva santos",
      rankingPoints: 65,
      ratingPoints: 420,
      clubNormalizedName: "clube b",
      aliasesNormalized: [],
    },
  ];

  it("resolve por alias exato", () => {
    const resolved = resolveAthleteCandidate({
      eventId: 5246,
      shortName: "victor martins",
      candidates,
    });

    expect(resolved.status).toBe("resolved");
    expect(resolved.strategy).toBe("alias-exato");
    expect(resolved.athleteId).toBe(3);
  });

  it("resolve por ranking/rating + nome compatível", () => {
    const resolved = resolveAthleteCandidate({
      eventId: 5246,
      shortName: "davi furtado",
      rankingPoints: 10,
      ratingPoints: 352,
      candidates,
    });

    expect(resolved.status).toBe("resolved");
    expect(resolved.athleteId).toBe(1);
  });

  it("gera conflito em ambiguidade com nome curto e sem pontos", () => {
    const resolved = resolveAthleteCandidate({
      eventId: 5246,
      shortName: "joao",
      candidates,
    });

    expect(resolved.status).toBe("conflict");
    expect(resolved.scoredCandidates.length).toBe(0);
  });

  it("resolve variacao ortografica pequena em nome reduzido quando houver candidato dominante", () => {
    const resolved = resolveAthleteCandidate({
      eventId: 5246,
      shortName: "gleidson pereira",
      candidates: [
        {
          athleteId: 10,
          eventId: 5246,
          nameDisplay: "GLEISON DIEGO OLIVEIRA PEREIRA",
          nameNormalized: "gleison diego oliveira pereira",
          rankingPoints: 605,
          ratingPoints: 531,
          clubNormalizedName: "clube x",
          aliasesNormalized: ["gleison pereira"],
        },
        {
          athleteId: 11,
          eventId: 5246,
          nameDisplay: "JOAO PAULO PEREIRA COLARES",
          nameNormalized: "joao paulo pereira colares",
          rankingPoints: 35,
          ratingPoints: 210,
          clubNormalizedName: "clube y",
          aliasesNormalized: [],
        },
      ],
    });

    expect(resolved.status).toBe("resolved");
    expect(resolved.strategy).toBe("heuristica");
    expect(resolved.athleteId).toBe(10);
  });

  it("resolve por rating + nome quando ranking observado diverge", () => {
    const resolved = resolveAthleteCandidate({
      eventId: 5246,
      shortName: "joao junior",
      rankingPoints: 125,
      ratingPoints: 791,
      candidates: [
        {
          athleteId: 20,
          eventId: 5246,
          nameDisplay: "JOAO CARLOS SILVA CAMPOS JUNIOR",
          nameNormalized: "joao carlos silva campos junior",
          rankingPoints: 430,
          ratingPoints: 791,
          clubNormalizedName: "clube a",
          aliasesNormalized: [],
        },
        {
          athleteId: 21,
          eventId: 5246,
          nameDisplay: "JOAO SOUSA DE OLIVEIRA JUNIOR",
          nameNormalized: "joao sousa de oliveira junior",
          rankingPoints: 1095,
          ratingPoints: 1576,
          clubNormalizedName: "clube b",
          aliasesNormalized: [],
        },
      ],
    });

    expect(resolved.status).toBe("resolved");
    expect(resolved.strategy).toBe("forte-ranking-rating");
    expect(resolved.athleteId).toBe(20);
  });

  it("nao resolve por apenas um token do alias quando houver homonimia parcial", () => {
    const resolved = resolveAthleteCandidate({
      eventId: 5246,
      shortName: "elias santos",
      rankingPoints: 500,
      ratingPoints: 700,
      candidates: [
        {
          athleteId: 30,
          eventId: 5246,
          nameDisplay: "LEONARDO GEMAQUE SANTOS",
          nameNormalized: "leonardo gemaque santos",
          rankingPoints: 500,
          ratingPoints: 700,
          clubNormalizedName: "clube a",
          aliasesNormalized: [],
        },
      ],
    });

    expect(resolved.status).toBe("conflict");
  });

  it("gera conflito para homonimos com mesmo alias e mesmo clube sem discriminador forte", () => {
    const resolved = resolveAthleteCandidate({
      eventId: 5368,
      shortName: "daniel santos",
      clubNormalizedName: "academia ping drive ltda",
      candidates: [
        {
          athleteId: 101,
          eventId: 5368,
          nameDisplay: "DANIEL BATISTA SANTOS",
          nameNormalized: "daniel batista santos",
          rankingPoints: 0,
          ratingPoints: 520,
          clubNormalizedName: "academia ping drive ltda",
          aliasesNormalized: ["daniel santos"],
        },
        {
          athleteId: 102,
          eventId: 5368,
          nameDisplay: "DANIEL FERREIRA DOS SANTOS",
          nameNormalized: "daniel ferreira dos santos",
          rankingPoints: 0,
          ratingPoints: 520,
          clubNormalizedName: "academia ping drive ltda",
          aliasesNormalized: ["daniel santos"],
        },
      ],
    });

    expect(resolved.status).toBe("conflict");
  });

  it("resolve homonimo quando alias coincide mas ranking/rating identificam unico atleta", () => {
    const resolved = resolveAthleteCandidate({
      eventId: 5368,
      shortName: "fernando silva",
      clubNormalizedName: "associacao paraense de tenis de mesa-aptm",
      rankingPoints: 0,
      ratingPoints: 640,
      candidates: [
        {
          athleteId: 201,
          eventId: 5368,
          nameDisplay: "FERNANDO ANTONIO DUTRA E SILVA",
          nameNormalized: "fernando antonio dutra e silva",
          rankingPoints: 0,
          ratingPoints: 640,
          clubNormalizedName: "associacao paraense de tenis de mesa-aptm",
          aliasesNormalized: ["fernando silva"],
        },
        {
          athleteId: 202,
          eventId: 5368,
          nameDisplay: "FERNANDO ALVES SILVA",
          nameNormalized: "fernando alves silva",
          rankingPoints: 0,
          ratingPoints: 410,
          clubNormalizedName: "associacao paraense de tenis de mesa-aptm",
          aliasesNormalized: ["fernando silva"],
        },
      ],
    });

    expect(resolved.status).toBe("resolved");
    expect(resolved.athleteId).toBe(201);
  });

  it("ordena fases e rodadas semanticamente", () => {
    expect(getMatchPhaseOrder("GRUPOS")).toBeLessThan(getMatchPhaseOrder("RESULTADOS"));
    expect(getMatchPhaseOrder("ELIMINATORIA")).toBe(getMatchPhaseOrder("RESULTADOS"));

    expect(getRoundSemanticOrder("Oitavas de Final")).toBeLessThan(getRoundSemanticOrder("Quartas de Final"));
    expect(getRoundSemanticOrder("Quartas de Final")).toBeLessThan(getRoundSemanticOrder("Semifinal"));
    expect(getRoundSemanticOrder("Semifinal")).toBeLessThan(getRoundSemanticOrder("Final"));
  });
});
