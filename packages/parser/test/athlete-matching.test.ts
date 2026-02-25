import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseResultsText } from "../src/index";
import { normalizeText, resolveAthleteCandidate } from "@cbtm/shared";

describe("matching com fixture real", () => {
  const fixturePath = path.resolve(fileURLToPath(new URL("../../../fixtures/results.txt", import.meta.url)));
  const fixture = fs.readFileSync(fixturePath, "utf8");
  const dataset = parseResultsText(5246, fixture);

  const baseCandidates = dataset.registrations.map((registration, index) => {
    const tokens = registration.athleteNormalizedName.split(" ").filter(Boolean);
    const firstLast = `${tokens[0]} ${tokens[tokens.length - 1]}`;
    return {
      athleteId: index + 1,
      eventId: 5246,
      nameDisplay: registration.athleteName,
      nameNormalized: registration.athleteNormalizedName,
      rankingPoints: registration.rankingPoints,
      ratingPoints: registration.ratingPoints,
      clubNormalizedName: registration.clubNormalizedName,
      aliasesNormalized: [registration.athleteNormalizedName, firstLast],
    };
  });

  it("resolve ao menos 5 nomes reduzidos com apoio de ranking/rating", () => {
    const targets = [
      { short: "davi furtado", full: "davi tuma furtado" },
      { short: "fernando silva", full: "fernando alves silva" },
      { short: "victor martins", full: "victor henrique dos reis martins" },
      { short: "edson silva", full: "edson vinicius santos da silva" },
      { short: "edival oliveira", full: "edival cordeiro de oliveira" },
    ];

    for (const target of targets) {
      const match = dataset.matches.find(
        (item) =>
          normalizeText(item.athleteAName) === target.short ||
          normalizeText(item.athleteBName) === target.short,
      );

      expect(match, `match ausente para ${target.short}`).toBeTruthy();

      const isA = normalizeText(match!.athleteAName) === target.short;
      const resolved = resolveAthleteCandidate({
        eventId: 5246,
        shortName: target.short,
        rankingPoints: isA ? match!.athleteARankingPoints ?? null : match!.athleteBRankingPoints ?? null,
        ratingPoints: isA ? match!.athleteARatingPoints ?? null : match!.athleteBRatingPoints ?? null,
        candidates: baseCandidates,
      });

      expect(resolved.status, `falha no short ${target.short}`).toBe("resolved");

      const expected = baseCandidates.find((candidate) => candidate.nameNormalized === target.full)!;
      expect(resolved.athleteId).toBe(expected.athleteId);
    }
  });

  it("gera conflito quando há ambiguidade sem pontos", () => {
    const candidates = [
      {
        athleteId: 100,
        eventId: 5246,
        nameDisplay: "JOAO VICTOR RIBEIRO CARDOSO",
        nameNormalized: "joao victor ribeiro cardoso",
        rankingPoints: null,
        ratingPoints: null,
        clubNormalizedName: "clube a",
        aliasesNormalized: [],
      },
      {
        athleteId: 101,
        eventId: 5246,
        nameDisplay: "JOAO PAULO DE SOUSA CARDOSO",
        nameNormalized: "JOAO PAULO DE SOUSA CARDOSO",
        rankingPoints: null,
        ratingPoints: null,
        clubNormalizedName: "clube b",
        aliasesNormalized: [],
      },
    ];

    const resolved = resolveAthleteCandidate({
      eventId: 5246,
      shortName: "joao cardoso",
      candidates,
    });

    expect(resolved.status).toBe("conflict");
    expect(resolved.scoredCandidates.length).toBe(2);
  });
});
