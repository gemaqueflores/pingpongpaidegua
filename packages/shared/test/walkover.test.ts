import { describe, expect, it } from "vitest";
import { detectWalkover } from "../src";

describe("detectWalkover", () => {
  it("detecta WO simples por scoreRaw", () => {
    const result = detectWalkover({
      scoreRaw: "WO",
      sets: [],
      p1Sets: null,
      p2Sets: null,
    });

    expect(result.isWalkover).toBe(true);
    expect(result.isDoubleWalkover).toBe(false);
  });

  it("detecta WO simples por sets 11x0 com placar 3-0", () => {
    const result = detectWalkover({
      sets: [
        { p1: 11, p2: 0 },
        { p1: 11, p2: 0 },
        { p1: 11, p2: 0 },
      ],
      p1Sets: 3,
      p2Sets: 0,
      scoreRaw: "3x0",
    });

    expect(result.isWalkover).toBe(true);
    expect(result.isDoubleWalkover).toBe(false);
  });

  it("detecta duplo WO por sets 0x0 e placar 0x0", () => {
    const result = detectWalkover({
      sets: [
        { p1: 0, p2: 0 },
        { p1: 0, p2: 0 },
        { p1: 0, p2: 0 },
      ],
      p1Sets: 0,
      p2Sets: 0,
      scoreRaw: "0x0",
    });

    expect(result.isWalkover).toBe(true);
    expect(result.isDoubleWalkover).toBe(true);
  });

  it("nao marca como WO sem placar final explicito em sets 0x0", () => {
    const result = detectWalkover({
      sets: [
        { p1: 0, p2: 0 },
        { p1: 0, p2: 0 },
      ],
      p1Sets: null,
      p2Sets: null,
      scoreRaw: "",
    });

    expect(result.isWalkover).toBe(false);
    expect(result.isDoubleWalkover).toBe(false);
  });
});

