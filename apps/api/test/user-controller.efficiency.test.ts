import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { UserController } from "../src/user/user.controller";
import { UserService } from "../src/user/user.service";

test("PP-015 T-I-03 controller rejeita year invalido em GET /efficiency", async () => {
  let serviceCalls = 0;
  const controller = new UserController({
    async listGlobalEfficiency() {
      serviceCalls += 1;
      return { weights: { pesoOuro: 130, pesoPrata: 80, pesoBronze: 50 }, ranking: [], availableYears: [] };
    },
  } as unknown as UserService) as UserController & {
    listGlobalEfficiency(year?: string): Promise<unknown>;
  };

  await assert.rejects(() => controller.listGlobalEfficiency("abc"), BadRequestException);
  await assert.rejects(() => controller.listGlobalEfficiency("99999"), BadRequestException);
  assert.equal(serviceCalls, 0);
});
