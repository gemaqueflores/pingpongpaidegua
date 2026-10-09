import assert from "node:assert/strict";
import test from "node:test";
import { isOriginAllowed } from "../src/common/cors-origin";

test("PP-071 T-U-07: preview Vercel exige opt-in exatamente true", () => {
  const origin = "https://qualquer.vercel.app";

  assert.equal(isOriginAllowed(origin, { FRONTEND_URL: "https://app.example" }), false);
  assert.equal(
    isOriginAllowed(origin, {
      FRONTEND_URL: "https://app.example",
      FRONTEND_ALLOW_VERCEL_PREVIEWS: "false",
    }),
    false,
  );
  assert.equal(
    isOriginAllowed(origin, {
      FRONTEND_URL: "https://app.example",
      FRONTEND_ALLOW_VERCEL_PREVIEWS: "1",
    }),
    false,
  );
});

test("PP-071 T-U-08: preview Vercel e permitido com opt-in true", () => {
  assert.equal(
    isOriginAllowed("https://preview-123.vercel.app", {
      FRONTEND_ALLOW_VERCEL_PREVIEWS: "true",
    }),
    true,
  );
});

test("PP-071 T-U-09: origem exata e localhost permanecem permitidos", () => {
  const env = { FRONTEND_URL: "https://pingpongpaidegua.vercel.app" };

  assert.equal(isOriginAllowed("https://pingpongpaidegua.vercel.app", env), true);
  assert.equal(isOriginAllowed("http://localhost:3000", env), true);
  assert.equal(isOriginAllowed("http://127.0.0.1:3000", env), true);
  assert.equal(isOriginAllowed("https://evil.example", env), false);
});
