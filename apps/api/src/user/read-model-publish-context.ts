import { AsyncLocalStorage } from "node:async_hooks";
import type { ReadModelPublishMode } from "./read-model-mirror";

const publishModeStorage = new AsyncLocalStorage<ReadModelPublishMode>();

export function runWithReadModelPublishMode<T>(mode: ReadModelPublishMode, callback: () => T): T {
  return publishModeStorage.run(mode, callback);
}

export function getReadModelPublishMode(): ReadModelPublishMode {
  return publishModeStorage.getStore() ?? "compare";
}

export function normalizeReadModelPublishMode(value: unknown): ReadModelPublishMode {
  return String(value ?? "").toLowerCase() === "replace" ? "replace" : "compare";
}
