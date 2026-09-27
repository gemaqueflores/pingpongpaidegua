import assert from "node:assert/strict";
import test from "node:test";
import { applyTrustProxy } from "../src/common/trust-proxy";

test("PP-070 T-U-01: interpreta TRUST_PROXY sem ampliar os saltos confiaveis", () => {
  const cases: Array<{ raw: string; expected: unknown[] }> = [
    { raw: "1", expected: [1] },
    { raw: "2", expected: [2] },
    { raw: "0", expected: [0] },
    { raw: "true", expected: [true] },
    { raw: "false", expected: [false] },
    { raw: "", expected: [] },
    { raw: "10.0.0.1, 10.0.0.2", expected: [["10.0.0.1", "10.0.0.2"]] },
  ];

  for (const { raw, expected } of cases) {
    const received: unknown[] = [];
    applyTrustProxy(
      {
        set(key, value) {
          assert.equal(key, "trust proxy");
          received.push(value);
        },
      },
      raw,
    );
    assert.deepEqual(received, expected, `TRUST_PROXY=${JSON.stringify(raw)}`);
  }
});
