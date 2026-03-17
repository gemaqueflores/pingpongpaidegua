import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeAthleteName } from "@cbtm/shared";
import { parseResultsText } from "../../../packages/parser/src/index";
import {
  computeCategoryClassificationSummaries,
  type CategoryAnalyticsMatch,
} from "../src/user/athlete-analytics";
import { normalizeCategoryMedalists, type MedalType } from "../src/user/podium-normalizer";

type MedalistRow = {
  athleteId: number;
  athleteName: string;
  medalha: MedalType;
  position: number;
};

function resolveMedalFromPosition(position: number | null): MedalType | null {
  if (position === 1) return "ouro";
  if (position === 2) return "prata";
  if (position === 3) return "bronze";
  return null;
}

function toAnalyticsMatches(categoryMatches: ReturnType<typeof parseResultsText>["matches"]): CategoryAnalyticsMatch[] {
  return categoryMatches.map((match) => ({
    categoryId: 1,
    categoryName: match.categoryName,
    phase: match.phase,
    round: match.round,
    scoreRaw: match.scoreRaw ?? null,
    players: [
      { athleteId: null, name: match.athleteAName },
      { athleteId: null, name: match.athleteBName },
    ],
    sets: match.sets ?? [],
    setsResult: match.setsResult ?? null,
    winnerIndex: match.winnerIndex ?? null,
  }));
}

test("fixture real gera podio coerente sem depender de ELIMINATORIA operacional", () => {
  const fixturePath = path.resolve(
    fileURLToPath(new URL("../../../fixtures/results.txt", import.meta.url)),
  );
  const fixture = fs.readFileSync(fixturePath, "utf8");
  const dataset = parseResultsText(5246, fixture);

  assert.ok(dataset.matches.length > 0);
  assert.equal(dataset.matches.some((match) => match.phase === "ELIMINATORIA"), false);

  const categoryName = "ABSOLUTO E (MAS)";
  const categoryMatches = dataset.matches.filter((match) => match.categoryName === categoryName);
  assert.ok(categoryMatches.length > 0);

  const analyticsMatches = toAnalyticsMatches(categoryMatches);
  const athleteNames = [
    ...new Set(
      categoryMatches.flatMap((match) => [match.athleteAName, match.athleteBName]).map(normalizeAthleteName),
    ),
  ];

  const medalistsRaw: MedalistRow[] = athleteNames
    .map((athleteNameNormalized) => {
      const displayName =
        categoryMatches
          .flatMap((match) => [match.athleteAName, match.athleteBName])
          .find((name) => normalizeAthleteName(name) === athleteNameNormalized) ?? athleteNameNormalized;
      const [classification] = computeCategoryClassificationSummaries(analyticsMatches, {
        athleteName: displayName,
        athleteNameNormalized,
      });
      const medalha = resolveMedalFromPosition(classification?.position ?? null);
      if (!medalha || classification?.position === null) {
        return null;
      }
      return {
        athleteId: athleteNames.indexOf(athleteNameNormalized) + 1,
        athleteName: displayName,
        medalha,
        position: classification.position,
      } satisfies MedalistRow;
    })
    .filter((item): item is MedalistRow => Boolean(item));

  const medalists = normalizeCategoryMedalists(medalistsRaw).sort((left, right) => {
    if (left.position !== right.position) {
      return left.position - right.position;
    }
    return left.athleteName.localeCompare(right.athleteName, "pt-BR", { sensitivity: "base" });
  });

  assert.deepEqual(
    medalists.map((item) => ({
      athleteName: item.athleteName,
      medalha: item.medalha,
      position: item.position,
    })),
    [
      { athleteName: "DAVI FURTADO", medalha: "ouro", position: 1 },
      { athleteName: "VICTOR MARTINS", medalha: "prata", position: 2 },
      { athleteName: "EDSON SILVA", medalha: "bronze", position: 3 },
      { athleteName: "FERNANDO SILVA", medalha: "bronze", position: 3 },
    ],
  );
});
