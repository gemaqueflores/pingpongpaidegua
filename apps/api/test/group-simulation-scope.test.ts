import assert from "node:assert/strict";
import test from "node:test";
import {
  computeRegistrationBreakdown,
  hasMinimumSimulationAthletes,
  selectAthletesByRegistrationScope,
  type SimulationAthleteLink,
} from "../src/user/group-simulation-scope";

function row(id: number, status: "INSCRITO" | "PRE_INSCRITO" | "OUTRO" | null): SimulationAthleteLink {
  return {
    categoryId: 1,
    registrationStatus: status,
    rankingPoints: null,
    ratingPoints: null,
    athlete: {
      id,
      nameDisplay: `ATLETA ${id}`,
      clubId: 1,
      club: { name: "CLUBE A" },
      rankingPoints: null,
      ratingPoints: null,
    },
  };
}

test("breakdown conta status de inscricao por categoria", () => {
  const breakdown = computeRegistrationBreakdown([
    row(1, "INSCRITO"),
    row(2, "PRE_INSCRITO"),
    row(3, "OUTRO"),
    row(4, null),
  ]);

  assert.deepEqual(breakdown, {
    total: 4,
    confirmed: 1,
    preInscrito: 1,
    other: 1,
    unknown: 1,
  });
});

test("scope confirmed inclui apenas inscritos", () => {
  const selected = selectAthletesByRegistrationScope(
    [row(1, "INSCRITO"), row(2, "PRE_INSCRITO"), row(3, null)],
    "confirmed",
  );

  assert.deepEqual(
    selected.athletes.map((athlete) => athlete.id),
    [1],
  );
});

test("scope confirmed_and_pre inclui inscritos e pre-inscritos", () => {
  const selected = selectAthletesByRegistrationScope(
    [row(1, "INSCRITO"), row(2, "PRE_INSCRITO"), row(3, null)],
    "confirmed_and_pre",
  );

  assert.deepEqual(
    selected.athletes.map((athlete) => athlete.id),
    [1, 2],
  );
});

test("scope confirmed usa fallback legado quando so ha status desconhecido", () => {
  const selected = selectAthletesByRegistrationScope([row(10, null), row(11, null)], "confirmed");

  assert.deepEqual(
    selected.athletes.map((athlete) => athlete.id),
    [10, 11],
  );
  assert.ok(selected.warnings.length > 0);
});

test("categoria precisa de no minimo 3 atletas para simulacao", () => {
  assert.equal(hasMinimumSimulationAthletes(2), false);
  assert.equal(hasMinimumSimulationAthletes(3), true);
});
