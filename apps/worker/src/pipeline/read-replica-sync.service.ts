import { Prisma, SyncMode, SyncStatus } from "@prisma/client";
import { log } from "../logger";
import { prismaRead, prismaWrite } from "../prisma";
import { diffByKey, inc } from "./read-replica-diff";

type PublishInput = {
  eventId: number;
  mode?: SyncMode;
  sourceScrapeRunId?: number | null;
};

type CountMap = Record<string, number>;

export class ReadReplicaSyncService {
  async publishEvent(input: PublishInput): Promise<{
    eventId: number;
    mode: SyncMode;
    status: SyncStatus;
    inserted: CountMap;
    updated: CountMap;
    deleted: CountMap;
    syncRunId: number;
  }> {
    const mode = input.mode ?? "INCREMENTAL";
    const event = await prismaWrite.event.findUnique({
      where: { id: input.eventId },
    });
    if (!event) {
      throw new Error(`Evento ${input.eventId} nao encontrado no DB_WRITE.`);
    }

    const syncRun = await prismaWrite.eventSyncRun.create({
      data: {
        eventId: input.eventId,
        sourceScrapeRunId: input.sourceScrapeRunId ?? null,
        mode,
        status: "SUCCESS",
        startedAt: new Date(),
        insertedCounts: {},
        updatedCounts: {},
        deletedCounts: {},
      },
    });

    const inserted: CountMap = {};
    const updated: CountMap = {};
    const deleted: CountMap = {};

    try {
      const state = await prismaWrite.eventSyncState.findUnique({
        where: { eventId: input.eventId },
      });
      const since = mode === "FULL_EVENT_REBUILD" ? null : state?.lastPublishedAt ?? null;

      const [
        athletesAll,
        athletesChanged,
        categoriesAll,
        categoriesChanged,
        matchesAll,
        matchesChanged,
        athleteCategoriesAll,
        aliasesAll,
        conflictsAll,
      ] = await Promise.all([
        prismaWrite.athlete.findMany({ where: { eventId: input.eventId } }),
        prismaWrite.athlete.findMany({
          where: {
            eventId: input.eventId,
            ...(since ? { updatedAt: { gt: since } } : {}),
          },
        }),
        prismaWrite.category.findMany({ where: { eventId: input.eventId } }),
        prismaWrite.category.findMany({
          where: {
            eventId: input.eventId,
            ...(since ? { updatedAt: { gt: since } } : {}),
          },
        }),
        prismaWrite.match.findMany({ where: { eventId: input.eventId } }),
        prismaWrite.match.findMany({
          where: {
            eventId: input.eventId,
            ...(since ? { updatedAt: { gt: since } } : {}),
          },
        }),
        prismaWrite.athleteCategory.findMany({
          where: {
            athlete: { eventId: input.eventId },
          },
        }),
        prismaWrite.athleteAlias.findMany({
          where: {
            athlete: { eventId: input.eventId },
          },
        }),
        prismaWrite.athleteMatchConflict.findMany({
          where: { eventId: input.eventId },
        }),
      ]);

      const clubIds = [...new Set(athletesAll.map((item) => item.clubId))];
      const clubsAll = clubIds.length
        ? await prismaWrite.club.findMany({
            where: { id: { in: clubIds } },
          })
        : [];

      const matchIds = matchesAll.map((item) => item.id);
      const matchParticipantsAll = matchIds.length
        ? await prismaWrite.matchParticipant.findMany({
            where: { matchId: { in: matchIds } },
          })
        : [];

      const changedAthleteIds = new Set(athletesChanged.map((item) => item.id));
      for (const row of athleteCategoriesAll) {
        changedAthleteIds.add(row.athleteId);
      }
      for (const row of aliasesAll) {
        changedAthleteIds.add(row.athleteId);
      }
      const changedCategoryIds = new Set(categoriesChanged.map((item) => item.id));
      for (const row of athleteCategoriesAll) {
        changedCategoryIds.add(row.categoryId);
      }
      const changedMatchIds = new Set(matchesChanged.map((item) => item.id));
      for (const row of matchParticipantsAll) {
        changedMatchIds.add(row.matchId);
      }

      await prismaRead.$transaction(async (tx) => {
        await this.syncEvent(tx, event, inserted, updated);
        await this.syncClubs(tx, clubsAll, inserted, updated);

        await this.syncAthletes(tx, {
          eventId: input.eventId,
          sourceAll: athletesAll,
          sourceChanged: mode === "FULL_EVENT_REBUILD" ? athletesAll : athletesAll.filter((a) => changedAthleteIds.has(a.id)),
          inserted,
          updated,
          deleted,
        });

        await this.syncCategories(tx, {
          eventId: input.eventId,
          sourceAll: categoriesAll,
          sourceChanged: mode === "FULL_EVENT_REBUILD" ? categoriesAll : categoriesAll.filter((c) => changedCategoryIds.has(c.id)),
          inserted,
          updated,
          deleted,
        });

        await this.syncAthleteCategories(tx, input.eventId, athleteCategoriesAll, inserted, deleted);
        await this.syncAliases(tx, input.eventId, aliasesAll, inserted, deleted);
        await this.syncMatches(tx, {
          eventId: input.eventId,
          sourceAll: matchesAll,
          sourceChanged: mode === "FULL_EVENT_REBUILD" ? matchesAll : matchesAll.filter((m) => changedMatchIds.has(m.id)),
          inserted,
          updated,
          deleted,
        });
        await this.syncMatchParticipants(tx, input.eventId, matchParticipantsAll, inserted, deleted);
        await this.syncConflicts(tx, input.eventId, conflictsAll, inserted, deleted);
      });

      await prismaWrite.eventSyncState.upsert({
        where: { eventId: input.eventId },
        create: {
          eventId: input.eventId,
          lastPublishedAt: new Date(),
          lastSourceScrapeRunId: input.sourceScrapeRunId ?? null,
          lastStatus: "SUCCESS",
          lastErrorMessage: null,
        },
        update: {
          lastPublishedAt: new Date(),
          lastSourceScrapeRunId: input.sourceScrapeRunId ?? null,
          lastStatus: "SUCCESS",
          lastErrorMessage: null,
        },
      });

      await prismaWrite.eventSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "SUCCESS",
          finishedAt: new Date(),
          insertedCounts: inserted,
          updatedCounts: updated,
          deletedCounts: deleted,
          errorMessage: null,
        },
      });

      log("info", "Sync WRITE->READ concluido", {
        eventId: input.eventId,
        mode,
        syncRunId: syncRun.id,
        inserted,
        updated,
        deleted,
      });

      return {
        eventId: input.eventId,
        mode,
        status: "SUCCESS",
        inserted,
        updated,
        deleted,
        syncRunId: syncRun.id,
      };
    } catch (error) {
      await prismaWrite.eventSyncState.upsert({
        where: { eventId: input.eventId },
        create: {
          eventId: input.eventId,
          lastPublishedAt: null,
          lastSourceScrapeRunId: input.sourceScrapeRunId ?? null,
          lastStatus: "ERROR",
          lastErrorMessage: String(error),
        },
        update: {
          lastStatus: "ERROR",
          lastErrorMessage: String(error),
          lastSourceScrapeRunId: input.sourceScrapeRunId ?? null,
        },
      });

      await prismaWrite.eventSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "ERROR",
          finishedAt: new Date(),
          insertedCounts: inserted,
          updatedCounts: updated,
          deletedCounts: deleted,
          errorMessage: String(error),
        },
      });

      log("error", "Falha no sync WRITE->READ", {
        eventId: input.eventId,
        mode,
        syncRunId: syncRun.id,
        error: String(error),
      });
      throw error;
    }
  }

  async publishOpenEventsIncremental(): Promise<{ total: number; success: number; failed: number }> {
    const openEvents = await prismaWrite.event.findMany({
      where: { concluido: false },
      select: { id: true },
    });

    let success = 0;
    let failed = 0;
    for (const event of openEvents) {
      try {
        await this.publishEvent({ eventId: event.id, mode: "INCREMENTAL" });
        success += 1;
      } catch {
        failed += 1;
      }
    }
    return { total: openEvents.length, success, failed };
  }

  private async syncEvent(
    tx: Prisma.TransactionClient,
    event: Prisma.EventUncheckedCreateInput,
    inserted: CountMap,
    updated: CountMap,
  ): Promise<void> {
    const existing = await tx.event.findUnique({ where: { id: Number(event.id) } });
    await tx.event.upsert({
      where: { id: Number(event.id) },
      create: event,
      update: {
        cbtmEventId: event.cbtmEventId,
        nome: event.nome,
        nivel: event.nivel,
        dataInicio: event.dataInicio,
        dataFim: event.dataFim,
        inicioInscricoes: event.inicioInscricoes,
        fimInscricoes: event.fimInscricoes,
        inicioRealizacao: event.inicioRealizacao,
        fimRealizacao: event.fimRealizacao,
        concluido: event.concluido,
        lastScrapeAt: event.lastScrapeAt,
      },
    });
    if (existing) {
      inc(updated, "events");
    } else {
      inc(inserted, "events");
    }
  }

  private async syncClubs(
    tx: Prisma.TransactionClient,
    source: Prisma.ClubUncheckedCreateInput[],
    inserted: CountMap,
    updated: CountMap,
  ): Promise<void> {
    for (const club of source) {
      const existing = await tx.club.findUnique({ where: { id: Number(club.id) } });
      await tx.club.upsert({
        where: { id: Number(club.id) },
        create: club,
        update: {
          name: club.name,
          normalizedName: club.normalizedName,
        },
      });
      if (existing) {
        inc(updated, "clubs");
      } else {
        inc(inserted, "clubs");
      }
    }
  }

  private async syncAthletes(
    tx: Prisma.TransactionClient,
    input: {
      eventId: number;
      sourceAll: Prisma.AthleteUncheckedCreateInput[];
      sourceChanged: Prisma.AthleteUncheckedCreateInput[];
      inserted: CountMap;
      updated: CountMap;
      deleted: CountMap;
    },
  ): Promise<void> {
    const targetAll = await tx.athlete.findMany({
      where: { eventId: input.eventId },
      select: { id: true },
    });
    const diff = diffByKey({
      source: input.sourceAll.map((item) => ({ id: Number(item.id) })),
      target: targetAll,
      keyOf: (row) => String(row.id),
    });

    if (diff.extraInTarget.length > 0) {
      const deletedRows = await tx.athlete.deleteMany({
        where: {
          eventId: input.eventId,
          id: { in: diff.extraInTarget.map((row) => row.id) },
        },
      });
      inc(input.deleted, "athletes", deletedRows.count);
    }

    for (const athlete of input.sourceChanged) {
      const existing = await tx.athlete.findUnique({ where: { id: Number(athlete.id) } });
      await tx.athlete.upsert({
        where: { id: Number(athlete.id) },
        create: athlete,
        update: {
          nameDisplay: athlete.nameDisplay,
          nameNormalized: athlete.nameNormalized,
          rankingPoints: athlete.rankingPoints,
          ratingPoints: athlete.ratingPoints,
          stateCode: athlete.stateCode,
          stateName: athlete.stateName,
          region: athlete.region,
          createdFromWarning: athlete.createdFromWarning,
          clubId: athlete.clubId,
          eventId: athlete.eventId,
        },
      });
      if (existing) {
        inc(input.updated, "athletes");
      } else {
        inc(input.inserted, "athletes");
      }
    }
  }

  private async syncCategories(
    tx: Prisma.TransactionClient,
    input: {
      eventId: number;
      sourceAll: Prisma.CategoryUncheckedCreateInput[];
      sourceChanged: Prisma.CategoryUncheckedCreateInput[];
      inserted: CountMap;
      updated: CountMap;
      deleted: CountMap;
    },
  ): Promise<void> {
    const targetAll = await tx.category.findMany({
      where: { eventId: input.eventId },
      select: { id: true },
    });
    const diff = diffByKey({
      source: input.sourceAll.map((item) => ({ id: Number(item.id) })),
      target: targetAll,
      keyOf: (row) => String(row.id),
    });
    if (diff.extraInTarget.length > 0) {
      const deletedRows = await tx.category.deleteMany({
        where: {
          eventId: input.eventId,
          id: { in: diff.extraInTarget.map((row) => row.id) },
        },
      });
      inc(input.deleted, "categories", deletedRows.count);
    }

    for (const category of input.sourceChanged) {
      const existing = await tx.category.findUnique({ where: { id: Number(category.id) } });
      await tx.category.upsert({
        where: { id: Number(category.id) },
        create: category,
        update: {
          name: category.name,
          normalizedName: category.normalizedName,
          cbtmCategoryId: category.cbtmCategoryId,
          eventId: category.eventId,
        },
      });
      if (existing) {
        inc(input.updated, "categories");
      } else {
        inc(input.inserted, "categories");
      }
    }
  }

  private async syncAthleteCategories(
    tx: Prisma.TransactionClient,
    eventId: number,
    source: Prisma.AthleteCategoryUncheckedCreateInput[],
    inserted: CountMap,
    deleted: CountMap,
  ): Promise<void> {
    await tx.athleteCategory.deleteMany({
      where: {
        athlete: { eventId },
      },
    });
    inc(deleted, "athlete_categories");
    if (source.length > 0) {
      await tx.athleteCategory.createMany({
        data: source,
        skipDuplicates: true,
      });
      inc(inserted, "athlete_categories", source.length);
    }
  }

  private async syncAliases(
    tx: Prisma.TransactionClient,
    eventId: number,
    source: Prisma.AthleteAliasUncheckedCreateInput[],
    inserted: CountMap,
    deleted: CountMap,
  ): Promise<void> {
    await tx.athleteAlias.deleteMany({
      where: {
        athlete: { eventId },
      },
    });
    inc(deleted, "athlete_aliases");
    if (source.length > 0) {
      await tx.athleteAlias.createMany({
        data: source,
        skipDuplicates: true,
      });
      inc(inserted, "athlete_aliases", source.length);
    }
  }

  private async syncMatches(
    tx: Prisma.TransactionClient,
    input: {
      eventId: number;
      sourceAll: Prisma.MatchUncheckedCreateInput[];
      sourceChanged: Prisma.MatchUncheckedCreateInput[];
      inserted: CountMap;
      updated: CountMap;
      deleted: CountMap;
    },
  ): Promise<void> {
    const targetAll = await tx.match.findMany({
      where: { eventId: input.eventId },
      select: { id: true },
    });
    const diff = diffByKey({
      source: input.sourceAll.map((item) => ({ id: Number(item.id) })),
      target: targetAll,
      keyOf: (row) => String(row.id),
    });
    if (diff.extraInTarget.length > 0) {
      await tx.matchParticipant.deleteMany({
        where: {
          matchId: { in: diff.extraInTarget.map((row) => row.id) },
        },
      });
      const deletedRows = await tx.match.deleteMany({
        where: {
          eventId: input.eventId,
          id: { in: diff.extraInTarget.map((row) => row.id) },
        },
      });
      inc(input.deleted, "matches", deletedRows.count);
    }

    for (const match of input.sourceChanged) {
      const existing = await tx.match.findUnique({ where: { id: Number(match.id) } });
      await tx.match.upsert({
        where: { id: Number(match.id) },
        create: match,
        update: {
          eventId: match.eventId,
          categoryId: match.categoryId,
          cbtmMatchId: match.cbtmMatchId,
          phase: match.phase,
          round: match.round,
          tableNumber: match.tableNumber,
          matchDatetime: match.matchDatetime,
          scoreRaw: match.scoreRaw,
          setsJson: match.setsJson,
          scoreFinal: match.scoreFinal,
          scoreSets: match.scoreSets,
          sourceFlags: match.sourceFlags,
          p1Sets: match.p1Sets,
          p2Sets: match.p2Sets,
          winnerIndex: match.winnerIndex,
          scorePlayers: match.scorePlayers,
          sourceUrl: match.sourceUrl,
          fetchedAt: match.fetchedAt,
          matchKey: match.matchKey,
        },
      });
      if (existing) {
        inc(input.updated, "matches");
      } else {
        inc(input.inserted, "matches");
      }
    }
  }

  private async syncMatchParticipants(
    tx: Prisma.TransactionClient,
    eventId: number,
    source: Prisma.MatchParticipantUncheckedCreateInput[],
    inserted: CountMap,
    deleted: CountMap,
  ): Promise<void> {
    const matchIds = await tx.match.findMany({
      where: { eventId },
      select: { id: true },
    });
    if (matchIds.length > 0) {
      await tx.matchParticipant.deleteMany({
        where: {
          matchId: { in: matchIds.map((item) => item.id) },
        },
      });
      inc(deleted, "match_participants");
    }
    if (source.length > 0) {
      await tx.matchParticipant.createMany({
        data: source,
        skipDuplicates: true,
      });
      inc(inserted, "match_participants", source.length);
    }
  }

  private async syncConflicts(
    tx: Prisma.TransactionClient,
    eventId: number,
    source: Prisma.AthleteMatchConflictUncheckedCreateInput[],
    inserted: CountMap,
    deleted: CountMap,
  ): Promise<void> {
    await tx.athleteMatchConflict.deleteMany({ where: { eventId } });
    inc(deleted, "athlete_match_conflicts");
    if (source.length > 0) {
      await tx.athleteMatchConflict.createMany({
        data: source,
        skipDuplicates: true,
      });
      inc(inserted, "athlete_match_conflicts", source.length);
    }
  }
}

