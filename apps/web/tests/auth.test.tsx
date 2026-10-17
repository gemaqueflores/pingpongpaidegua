import assert from "node:assert/strict";
import test from "node:test";
import { getAuthToken, getHeaders, setAuthToken } from "../lib/auth";

function mockStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function mockWindow(t: Parameters<Parameters<typeof test>[1]>[0], sessionStorage: Storage, localStorage: Storage) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true, value: { sessionStorage, localStorage },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  });
}

test("PP-SEC-011 T-U-01 setAuthToken escreve somente em sessionStorage e remove legado", (t) => {
  for (const legacyToken of [null, "residuo-legado"]) {
    const sessionStorage = mockStorage();
    const localStorage = mockStorage();
    if (legacyToken) localStorage.setItem("cbtm_token", legacyToken);
    const localWrite = t.mock.method(localStorage, "setItem");
    mockWindow(t, sessionStorage, localStorage);

    setAuthToken("abc123");

    assert.equal(sessionStorage.getItem("cbtm_admin_token"), "abc123");
    assert.equal(localStorage.getItem("cbtm_token"), null);
    assert.equal(localWrite.mock.callCount(), 0);
  }
});
