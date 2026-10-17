import assert from "node:assert/strict";
import test from "node:test";
import type { ResolvingMetadata } from "next";

// generateMetadata does not read the parent; keep the stub promise-shaped.
const parent = Promise.resolve({}) as ResolvingMetadata;

type FetchCall = {
  url: string;
};

function mockFetch(payload: unknown): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push({ url: String(input) });
    return {
      ok: true,
      json: async () => payload,
    } as Response;
  }) as typeof fetch;
  return calls;
}

test("PP-007 T-U-01 generateMetadata usa nome retornado por /events/:id", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
  const calls = mockFetch({ id: 51, nome: "3TMB26 - Mestre Bianor Coelho" });
  const { generateMetadata } = await import("../app/events/[id]/layout");

  const metadata = await generateMetadata({ params: Promise.resolve({ id: "51" }), children: null }, parent);

  assert.match(String(metadata.title), /3TMB26 - Mestre Bianor Coelho/);
  assert.match(String(metadata.openGraph?.title), /3TMB26 - Mestre Bianor Coelho/);
  assert.ok(calls.length >= 1);
  assert.ok(calls.every((call) => new URL(call.url).pathname === "/events/51"));
});

test("PP-007 T-U-02 generateMetadata preserva fallback para retorno nulo", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
  mockFetch(null);
  const { generateMetadata } = await import("../app/events/[id]/layout");

  const metadata = await generateMetadata({ params: Promise.resolve({ id: "99" }), children: null }, parent);

  assert.match(String(metadata.title), /nome indisponível/);
});

test("PP-007 T-U-03 generateMetadata nunca chama listagem /events", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
  const calls = mockFetch({ id: 52, nome: "Evento direto" });
  const { generateMetadata } = await import("../app/events/[id]/layout");

  await generateMetadata({ params: Promise.resolve({ id: "52" }), children: null }, parent);

  const paths = calls.map((call) => new URL(call.url).pathname);
  assert.ok(paths.includes("/events/52"));
  assert.ok(!paths.includes("/events"));
});
