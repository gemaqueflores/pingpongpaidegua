import assert from "node:assert/strict";

type Target = "local" | "prod" | "both";

function getArgValue(prefix: string): string | null {
  const arg = process.argv.find((item) => item.startsWith(`${prefix}=`));
  if (!arg) {
    return null;
  }
  return arg.slice(prefix.length + 1).trim() || null;
}

function resolveTarget(): Target {
  const raw = (getArgValue("--target") ?? "both").toLowerCase();
  if (raw === "local" || raw === "prod" || raw === "both") {
    return raw;
  }
  throw new Error(`--target invalido: ${raw}. Use local|prod|both.`);
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} em ${url}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function extractEventIds(eventsRaw: unknown): number[] {
  if (!Array.isArray(eventsRaw)) {
    return [];
  }

  return eventsRaw
    .map((item) => (item && typeof item === "object" ? (item as { id?: unknown }).id : null))
    .filter((id): id is number => Number.isInteger(id));
}

function parseOptionalInt(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

async function validateBase(baseUrlRaw: string, label: string): Promise<void> {
  const baseUrl = baseUrlRaw.replace(/\/+$/, "");
  console.log(`[${label}] Validando API em ${baseUrl}`);

  const eventsRaw = await fetchJson(`${baseUrl}/events`);
  assert.ok(Array.isArray(eventsRaw), `[${label}] /events nao retornou array`);
  assert.ok(eventsRaw.length > 0, `[${label}] /events retornou vazio`);

  const eventIds = extractEventIds(eventsRaw);
  assert.ok(eventIds.length > 0, `[${label}] nenhum evento com id valido em /events`);

  const selectedEventId = parseOptionalInt(process.env.VALIDATE_EVENT_ID);
  const eventId = selectedEventId ?? eventIds[0];

  const clubsRaw = await fetchJson(`${baseUrl}/events/${eventId}/clubs`);
  assert.ok(Array.isArray(clubsRaw), `[${label}] /events/${eventId}/clubs nao retornou array`);

  console.log(`[${label}] OK`);
}

async function validateClubCounters(baseUrlRaw: string, label: string): Promise<void> {
  const baseUrl = baseUrlRaw.replace(/\/+$/, "");
  const eventsRaw = await fetchJson(`${baseUrl}/events`);
  const eventIds = extractEventIds(eventsRaw);

  for (const eventId of eventIds) {
    const clubsRaw = await fetchJson(`${baseUrl}/events/${eventId}/clubs`);

    if (!Array.isArray(clubsRaw) || clubsRaw.length === 0) {
      continue;
    }

    const withoutCounter = clubsRaw.filter((club) => {
      if (!club || typeof club !== "object") {
        return true;
      }
      return !Number.isFinite((club as { athleteCount?: unknown }).athleteCount as number);
    });

    assert.equal(
      withoutCounter.length,
      0,
      `[${label}] evento ${eventId} tem ${withoutCounter.length} clubes sem athleteCount`,
    );

    console.log(`[${label}] contadores de clubes validados no evento ${eventId}`);
    return;
  }

  console.log(`[${label}] aviso: nenhum evento com clubes para validar athleteCount`);
}

async function main(): Promise<void> {
  const target = resolveTarget();
  const localUrl = process.env.LOCAL_API_URL ?? "http://localhost:4000";
  const prodUrl = process.env.PROD_API_URL ?? "https://api-pingpongpaidegua.duckdns.org";

  if (target === "local" || target === "both") {
    await validateBase(localUrl, "local");
    await validateClubCounters(localUrl, "local");
  }

  if (target === "prod" || target === "both") {
    await validateBase(prodUrl, "producao");
    await validateClubCounters(prodUrl, "producao");
  }
}

main().catch((error) => {
  console.error("Falha na validacao pos-commit:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
