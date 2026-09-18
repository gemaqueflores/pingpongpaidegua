import assert from "node:assert/strict";
import test from "node:test";
import { AppController } from "../src/app.controller";

test("T-U-04 health preserva erro do banco ao usar queryRaw", async () => {
  const prismaRead = {
    async $queryRaw() {
      throw new Error("conexão recusada");
    },
  };
  const queueService = {
    async getHealth() {
      return {
        status: "ok" as const,
        queueName: "scrape",
      };
    },
  };
  const controller = new AppController(prismaRead as never, queueService as never);

  const response = await controller.health();

  assert.equal(response.status, "degraded");
  assert.deepEqual(response.checks.database, {
    status: "error",
    error: "conexão recusada",
  });
});
