import { describe, expect, it } from "vitest";
import {
  buildEventScrapePolicy,
  computeEventCacheMaxAgeMs,
  computeEventSituation,
  computeEventRecoveryStaleThresholdMs,
  resolveScrapeLockStaleMsFromEnv,
} from "../src/event-situation";

function dt(value: string): Date {
  return new Date(value);
}

describe("event cache policy", () => {
  it("usa ttl 10 minutos menor que o intervalo recomendado", () => {
    const policy = buildEventScrapePolicy(
      {
        inicioInscricoes: dt("2026-03-01T00:00:00.000Z"),
        fimInscricoes: dt("2026-03-10T00:00:00.000Z"),
        inicioRealizacao: dt("2026-03-20T00:00:00.000Z"),
        fimRealizacao: dt("2026-03-21T00:00:00.000Z"),
      },
      { now: dt("2026-03-05T12:00:00.000Z") },
    );

    expect(policy.recommendedIntervalMs).toBe(6 * 60 * 60 * 1000);
    expect(computeEventCacheMaxAgeMs(policy)).toBe(5 * 60 * 60 * 1000 + 50 * 60 * 1000);
  });

  it("respeita minimo quando o intervalo e menor que a margem", () => {
    const ttl = computeEventCacheMaxAgeMs(
      {
        autoSchedule: true,
        captureInscricoes: false,
        captureGrupos: false,
        captureResultados: true,
        fetchEliminatoria: false,
        recommendedIntervalMs: 5 * 60 * 1000,
        reason: "teste",
      },
      {
        marginMs: 10 * 60 * 1000,
        minAgeMs: 60 * 1000,
        fallbackAgeMs: 30 * 60 * 1000,
      },
    );

    expect(ttl).toBe(60 * 1000);
  });

  it("usa fallback quando nao houver agendamento automatico", () => {
    const ttl = computeEventCacheMaxAgeMs({
      autoSchedule: false,
      captureInscricoes: false,
      captureGrupos: false,
      captureResultados: false,
      fetchEliminatoria: false,
      recommendedIntervalMs: null,
      reason: "pos-evento-encerrado",
    });

    expect(ttl).toBe(30 * 60 * 1000);
  });

  it("usa recovery stale threshold derivado do intervalo recomendado", () => {
    const policy = buildEventScrapePolicy(
      {
        inicioInscricoes: dt("2026-03-01T00:00:00.000Z"),
        fimInscricoes: dt("2026-03-10T00:00:00.000Z"),
        inicioRealizacao: dt("2026-03-20T00:00:00.000Z"),
        fimRealizacao: dt("2026-03-21T00:00:00.000Z"),
      },
      { now: dt("2026-03-20T12:00:00.000Z") },
    );

    expect(policy.recommendedIntervalMs).toBe(15 * 60 * 1000);
    expect(computeEventRecoveryStaleThresholdMs(policy)).toBe(30 * 60 * 1000);
  });

  it("resolve stale lock a partir do env com fallback unico", () => {
    expect(resolveScrapeLockStaleMsFromEnv({})).toBe(15 * 60 * 1000);
    expect(resolveScrapeLockStaleMsFromEnv({ SCRAPE_LOCK_STALE_MS: "1800000" })).toBe(
      30 * 60 * 1000,
    );
    expect(resolveScrapeLockStaleMsFromEnv({ HEALTH_MONITOR_STALE_LOCK_MS: "450000" })).toBe(
      7 * 60 * 1000 + 30 * 1000,
    );
    expect(resolveScrapeLockStaleMsFromEnv({ SCRAPE_LOCK_STALE_MS: "1" })).toBe(60 * 1000);
  });

  it("classifica evento concluido como POS_EVENTO mesmo sem datas de inscricao", () => {
    const situation = computeEventSituation(
      {
        inicioInscricoes: null,
        fimInscricoes: null,
        inicioRealizacao: dt("2025-09-05T00:00:00.000Z"),
        fimRealizacao: dt("2025-09-07T23:59:59.999Z"),
      },
      dt("2026-04-09T12:00:00.000Z"),
    );

    expect(situation).toBe("POS_EVENTO");
  });

  it("mantem DRAFT antes do evento quando faltam datas de inscricao e nao ha grades publicadas", () => {
    const situation = computeEventSituation(
      {
        inicioInscricoes: null,
        fimInscricoes: null,
        inicioRealizacao: dt("2026-04-20T00:00:00.000Z"),
        fimRealizacao: dt("2026-04-21T00:00:00.000Z"),
        hasPublishedMatches: false,
        hasPublishedResults: false,
      },
      dt("2026-04-10T12:00:00.000Z"),
    );

    expect(situation).toBe("DRAFT");
  });

  it("mantem GRADES_PUBLICADAS_PRE_JOGO antes do evento quando grades ja existem mesmo sem datas de inscricao", () => {
    const situation = computeEventSituation(
      {
        inicioInscricoes: null,
        fimInscricoes: null,
        inicioRealizacao: dt("2026-04-20T00:00:00.000Z"),
        fimRealizacao: dt("2026-04-21T00:00:00.000Z"),
        hasPublishedMatches: true,
        hasPublishedResults: false,
      },
      dt("2026-04-19T20:00:00.000Z"),
    );

    expect(situation).toBe("GRADES_PUBLICADAS_PRE_JOGO");
  });
});
