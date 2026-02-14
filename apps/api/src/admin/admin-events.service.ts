import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { QueueService } from "../common/queue.service";
import { computeEventSituation, getEventSituationTransition, normalizeText } from "@cbtm/shared";
import { CreateAdminEventDto } from "./dto/create-admin-event.dto";
import { UpdateAdminEventDto } from "./dto/update-admin-event.dto";

type DateBoundary = "start" | "end";
const EVENT_TZ_OFFSET_MINUTES = -3 * 60;

@Injectable()
export class AdminEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async listEvents() {
    const events = await this.prisma.event.findMany({
      orderBy: [{ createdAt: "desc" }],
      include: {
        _count: {
          select: {
            scrapeRuns: true,
            athletes: true,
            categories: true,
            matches: true,
            athleteMatchConflicts: true,
          },
        },
      },
    });

    return events.map((event) => ({
      ...event,
      situacaoComputada: computeEventSituation(event),
      proximaMudanca: getEventSituationTransition(event),
    }));
  }

  async createEvent(dto: CreateAdminEventDto) {
    const concluido = dto.concluido ?? false;
    const inicioInscricoes = this.parseDateInput(dto.inicioInscricoes, "inicioInscricoes", "start");
    const fimInscricoes = this.parseDateInput(dto.fimInscricoes, "fimInscricoes", "end");
    const inicioRealizacao = this.resolveDateField(
      dto.inicioRealizacao,
      dto.dataInicio,
      "inicioRealizacao",
      "start",
    );
    const fimRealizacao = this.resolveDateField(dto.fimRealizacao, dto.dataFim, "fimRealizacao", "end");

    this.validateEventDateRules({
      concluido,
      inicioInscricoes,
      fimInscricoes,
      inicioRealizacao,
      fimRealizacao,
    });

    const event = await this.prisma.event.create({
      data: {
        cbtmEventId: dto.cbtmEventId,
        nome: dto.nome,
        nivel: dto.nivel ?? null,
        inicioInscricoes,
        fimInscricoes,
        inicioRealizacao,
        fimRealizacao,
        dataInicio: inicioRealizacao,
        dataFim: fimRealizacao,
        concluido,
      },
    });

    if (event.concluido) {
      await this.queue.enqueueScrapeNow(event.id);
    } else {
      await this.queue.enqueueScrape(event.id, "admin-create");
    }

    return event;
  }

  async updateEvent(id: number, dto: UpdateAdminEventDto) {
    const currentEvent = await this.ensureEvent(id);

    const hasInicioInscricoes = this.hasOwn(dto, "inicioInscricoes");
    const hasFimInscricoes = this.hasOwn(dto, "fimInscricoes");
    const hasInicioRealizacao = this.hasOwn(dto, "inicioRealizacao");
    const hasFimRealizacao = this.hasOwn(dto, "fimRealizacao");
    const hasDataInicio = this.hasOwn(dto, "dataInicio");
    const hasDataFim = this.hasOwn(dto, "dataFim");

    const nextConcluido = this.hasOwn(dto, "concluido")
      ? Boolean(dto.concluido)
      : currentEvent.concluido;

    const nextInicioInscricoes = hasInicioInscricoes
      ? this.parseDateInput(dto.inicioInscricoes, "inicioInscricoes", "start")
      : currentEvent.inicioInscricoes;
    const nextFimInscricoes = hasFimInscricoes
      ? this.parseDateInput(dto.fimInscricoes, "fimInscricoes", "end")
      : currentEvent.fimInscricoes;

    const nextInicioRealizacao = hasInicioRealizacao
      ? this.parseDateInput(dto.inicioRealizacao, "inicioRealizacao", "start")
      : hasDataInicio
        ? this.parseDateInput(dto.dataInicio, "dataInicio", "start")
        : currentEvent.inicioRealizacao ?? currentEvent.dataInicio;
    const nextFimRealizacao = hasFimRealizacao
      ? this.parseDateInput(dto.fimRealizacao, "fimRealizacao", "end")
      : hasDataFim
        ? this.parseDateInput(dto.dataFim, "dataFim", "end")
        : currentEvent.fimRealizacao ?? currentEvent.dataFim;

    this.validateEventDateRules({
      concluido: nextConcluido,
      inicioInscricoes: nextInicioInscricoes,
      fimInscricoes: nextFimInscricoes,
      inicioRealizacao: nextInicioRealizacao,
      fimRealizacao: nextFimRealizacao,
    });

    const event = await this.prisma.event.update({
      where: { id },
      data: {
        cbtmEventId: dto.cbtmEventId,
        nome: dto.nome,
        nivel: dto.nivel,
        inicioInscricoes: nextInicioInscricoes,
        fimInscricoes: nextFimInscricoes,
        inicioRealizacao: nextInicioRealizacao,
        fimRealizacao: nextFimRealizacao,
        dataInicio: nextInicioRealizacao,
        dataFim: nextFimRealizacao,
        concluido: nextConcluido,
      },
    });

    if (!event.concluido) {
      await this.queue.enqueueScrape(event.id, "admin-update");
    } else if (!currentEvent.concluido && event.concluido) {
      await this.queue.enqueueScrapeNow(event.id);
    }

    return event;
  }

  async deleteEvent(id: number) {
    await this.ensureEvent(id);

    const deleted = await this.prisma.$transaction(async (tx) => {
      const athletes = await tx.athlete.findMany({
        where: { eventId: id },
        select: { id: true, clubId: true },
      });
      const athleteIds = athletes.map((item) => item.id);
      const clubIds = [...new Set(athletes.map((item) => item.clubId))];

      const matches = await tx.match.findMany({
        where: { eventId: id },
        select: { id: true },
      });
      const matchIds = matches.map((item) => item.id);

      const categories = await tx.category.findMany({
        where: { eventId: id },
        select: { id: true },
      });
      const categoryIds = categories.map((item) => item.id);

      const deletedMatchParticipants =
        matchIds.length === 0
          ? { count: 0 }
          : await tx.matchParticipant.deleteMany({
              where: {
                matchId: { in: matchIds },
              },
            });

      const deletedAthleteCategories =
        athleteIds.length === 0 || categoryIds.length === 0
          ? { count: 0 }
          : await tx.athleteCategory.deleteMany({
              where: {
                OR: [
                  { athleteId: { in: athleteIds } },
                  { categoryId: { in: categoryIds } },
                ],
              },
            });

      const deletedAliases =
        athleteIds.length === 0
          ? { count: 0 }
          : await tx.athleteAlias.deleteMany({
              where: {
                athleteId: { in: athleteIds },
              },
            });

      const deletedConflicts = await tx.athleteMatchConflict.deleteMany({
        where: { eventId: id },
      });

      const deletedMatches = await tx.match.deleteMany({
        where: { eventId: id },
      });

      const deletedAthletes = await tx.athlete.deleteMany({
        where: { eventId: id },
      });

      const deletedCategories = await tx.category.deleteMany({
        where: { eventId: id },
      });

      const deletedRawCaptures = await tx.rawCapture.deleteMany({
        where: { eventId: id },
      });

      const deletedScrapeRuns = await tx.scrapeRun.deleteMany({
        where: { eventId: id },
      });

      await tx.event.delete({
        where: { id },
      });

      if (clubIds.length > 0) {
        await tx.club.deleteMany({
          where: {
            id: { in: clubIds },
            athletes: { none: {} },
          },
        });
      }

      return {
        matchParticipants: deletedMatchParticipants.count,
        athleteCategories: deletedAthleteCategories.count,
        athleteAliases: deletedAliases.count,
        conflicts: deletedConflicts.count,
        matches: deletedMatches.count,
        athletes: deletedAthletes.count,
        categories: deletedCategories.count,
        rawCaptures: deletedRawCaptures.count,
        scrapeRuns: deletedScrapeRuns.count,
      };
    });

    return {
      success: true,
      deleted,
    };
  }

  async markCompleted(id: number) {
    await this.ensureEvent(id);

    return this.prisma.event.update({
      where: { id },
      data: {
        concluido: true,
      },
    });
  }

  async scrapeNow(id: number) {
    await this.ensureEvent(id);

    return this.queue.enqueueScrapeNow(id);
  }

  async listScrapeRuns(eventId: number) {
    await this.ensureEvent(eventId);

    return this.prisma.scrapeRun.findMany({
      where: { eventId },
      orderBy: [{ startedAt: "desc" }],
      take: 100,
    });
  }

  async listAthleteConflicts(eventId: number) {
    await this.ensureEvent(eventId);

    return this.prisma.athleteMatchConflict.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "desc" }],
      include: {
        resolvedAthlete: {
          select: {
            id: true,
            nameDisplay: true,
          },
        },
      },
      take: 200,
    });
  }

  async resolveAthleteConflict(eventId: number, conflictId: number, athleteId: number) {
    await this.ensureEvent(eventId);

    const conflict = await this.prisma.athleteMatchConflict.findFirst({
      where: {
        id: conflictId,
        eventId,
      },
    });

    if (!conflict) {
      throw new NotFoundException("Conflito não encontrado");
    }

    const athlete = await this.prisma.athlete.findFirst({
      where: {
        id: athleteId,
        eventId,
      },
    });

    if (!athlete) {
      throw new BadRequestException("Atleta inválido para este evento");
    }

    const payload = conflict.candidateAthletes as {
      matchKey?: string;
      placeholderAthleteId?: number | null;
    };

    await this.prisma.$transaction(async (tx) => {
      if (payload?.matchKey && payload?.placeholderAthleteId) {
        const match = await tx.match.findFirst({
          where: {
            eventId,
            matchKey: payload.matchKey,
          },
          select: {
            id: true,
          },
        });

        if (match) {
          await tx.matchParticipant.deleteMany({
            where: {
              matchId: match.id,
              athleteId: payload.placeholderAthleteId,
            },
          });

          await tx.matchParticipant.upsert({
            where: {
              matchId_athleteId: {
                matchId: match.id,
                athleteId,
              },
            },
            update: {},
            create: {
              matchId: match.id,
              athleteId,
            },
          });
        }
      }

      await tx.athleteAlias.upsert({
        where: {
          athleteId_aliasNormalized: {
            athleteId,
            aliasNormalized: normalizeText(conflict.shortName),
          },
        },
        update: {
          aliasDisplay: conflict.shortName,
        },
        create: {
          athleteId,
          aliasDisplay: conflict.shortName,
          aliasNormalized: normalizeText(conflict.shortName),
          source: "JOGOS",
        },
      });

      await tx.athleteMatchConflict.update({
        where: {
          id: conflict.id,
        },
        data: {
          resolvedAthleteId: athleteId,
          resolvedAt: new Date(),
        },
      });
    });

    return {
      success: true,
      conflictId,
      athleteId,
    };
  }

  private async ensureEvent(eventId: number) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new NotFoundException("Evento não encontrado");
    }
    return event;
  }

  private hasOwn<T extends object>(obj: T, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  private parseDateInput(
    rawValue: string | null | undefined,
    fieldName: string,
    boundary: DateBoundary,
  ): Date | null {
    const value = String(rawValue ?? "").trim();
    if (!value) {
      return null;
    }

    const brMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brMatch) {
      const day = Number(brMatch[1]);
      const month = Number(brMatch[2]);
      const year = Number(brMatch[3]);
      return this.buildUtcDate(year, month, day, boundary, fieldName);
    }

    const isoDateMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateMatch) {
      const year = Number(isoDateMatch[1]);
      const month = Number(isoDateMatch[2]);
      const day = Number(isoDateMatch[3]);
      return this.buildUtcDate(year, month, day, boundary, fieldName);
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `Campo '${fieldName}' invalido. Use o formato dd/mm/yyyy.`,
      );
    }

    return parsed;
  }

  private resolveDateField(
    primary: string | null | undefined,
    fallback: string | null | undefined,
    fieldName: string,
    boundary: DateBoundary,
  ): Date | null {
    return (
      this.parseDateInput(primary, fieldName, boundary) ??
      this.parseDateInput(fallback, fieldName, boundary)
    );
  }

  private buildUtcDate(
    year: number,
    month: number,
    day: number,
    boundary: DateBoundary,
    fieldName: string,
  ): Date {
    const calendarValidation = new Date(Date.UTC(year, month - 1, day));
    const isCalendarDateValid =
      calendarValidation.getUTCFullYear() === year &&
      calendarValidation.getUTCMonth() === month - 1 &&
      calendarValidation.getUTCDate() === day;
    if (!isCalendarDateValid) {
      throw new BadRequestException(
        `Campo '${fieldName}' invalido. Use uma data real no formato dd/mm/yyyy.`,
      );
    }

    const hour = boundary === "start" ? 0 : 23;
    const minute = boundary === "start" ? 0 : 59;
    const second = boundary === "start" ? 0 : 59;
    const millisecond = 0;
    // Datas administrativas devem respeitar o fuso do evento (UTC-03),
    // mantendo inicio 00:00:00 e fim 23:59:59 do dia informado.
    const utcMillis =
      Date.UTC(year, month - 1, day, hour, minute, second, millisecond) -
      EVENT_TZ_OFFSET_MINUTES * 60 * 1000;
    const date = new Date(utcMillis);

    return date;
  }

  private validateEventDateRules(input: {
    concluido: boolean;
    inicioInscricoes: Date | null;
    fimInscricoes: Date | null;
    inicioRealizacao: Date | null;
    fimRealizacao: Date | null;
  }): void {
    const missing: string[] = [];

    if (!input.concluido) {
      if (!input.inicioInscricoes) {
        missing.push("inicioInscricoes");
      }
      if (!input.fimInscricoes) {
        missing.push("fimInscricoes");
      }
      if (!input.inicioRealizacao) {
        missing.push("inicioRealizacao");
      }
      if (!input.fimRealizacao) {
        missing.push("fimRealizacao");
      }
    }

    if (missing.length > 0) {
      throw new BadRequestException(
        `Eventos nao concluidos exigem as datas: ${missing.join(", ")} (formato dd/mm/yyyy).`,
      );
    }

    if (input.inicioInscricoes && input.fimInscricoes && input.inicioInscricoes > input.fimInscricoes) {
      throw new BadRequestException("Periodo de inscricoes invalido: inicio maior que fim.");
    }

    if (input.inicioRealizacao && input.fimRealizacao && input.inicioRealizacao > input.fimRealizacao) {
      throw new BadRequestException("Periodo de realizacao invalido: inicio maior que fim.");
    }

    if (input.inicioInscricoes && input.fimRealizacao && input.inicioInscricoes > input.fimRealizacao) {
      throw new BadRequestException("Datas invalidas: inicio de inscricoes apos fim de realizacao.");
    }
  }
}
