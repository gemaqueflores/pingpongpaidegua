import assert from "node:assert/strict";
import test from "node:test";
import { AdminEventsService } from "../src/admin/admin-events.service";

test("PP-025 T-I-02a update propaga competitionFormat e invalida filho e canonico", async () => {
  let updateData: Record<string, unknown> | undefined;
  let invalidatedIds: number[] | undefined;
  const currentEvent = {
    id: 57,
    cbtmEventId: 5828,
    nome: "Evento filho",
    concluido: true,
    inicioInscricoes: null,
    fimInscricoes: null,
    inicioRealizacao: null,
    fimRealizacao: null,
    dataInicio: null,
    dataFim: null,
  };
  const prisma = {
    event: {
      async findUnique() {
        return currentEvent;
      },
      async update(args: { data: Record<string, unknown> }) {
        updateData = args.data;
        return { ...currentEvent, ...args.data };
      },
    },
    eventMerge: {
      async findMany() {
        return [{ primaryEventId: 55, secondaryEventId: 57 }];
      },
    },
    readModelCache: {
      async deleteMany(args: { where: { eventId: { in: number[] } } }) {
        invalidatedIds = args.where.eventId.in;
        return { count: 2 };
      },
    },
  };
  const service = new AdminEventsService(prisma as never, {} as never, {} as never);

  await service.updateEvent(57, { competitionFormat: "K1" } as never);

  assert.equal(updateData?.competitionFormat, "K1");
  assert.deepEqual(invalidatedIds, [57, 55]);
});
