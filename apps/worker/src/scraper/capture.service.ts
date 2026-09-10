import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import type { DxTab } from "@cbtm/parser";
import {
  DiscoveredCategory,
  DxPayload,
  EliminationPayload,
  extractDxPayloads,
  parseDxPayloads,
} from "@cbtm/parser";
import { compactWhitespace, computeOfficialCategoryMatchesCount } from "@cbtm/shared";
import { config } from "../config";
import { CategoryContext, DXRequestBuilder } from "./dx-request-builder";
import { LiveHttpCaptureService } from "./live-http-capture.service";

export interface CaptureResult {
  payloads: DxPayload[];
  rawBodies: string[];
  eliminationPayloads: EliminationPayload[];
  source: "fixture" | "live-http" | "live-browser";
  warnings: string[];
  categoriesDiscovered: DiscoveredCategory[];
  categoriesVisited: string[];
  tabsVisited: string[];
  paginationRequests: number;
  categoryDiagnostics: Record<
    string,
    {
      payloadsByTab: Record<string, number>;
      dxResultErrorCount: number;
      retriedByBrowser: boolean;
      source: "http" | "browser" | "mixed";
    }
  >;
}

export interface CaptureOptions {
  captureInscricoes?: boolean;
  captureGrupos?: boolean;
  captureResultados?: boolean;
  fetchEliminatoria?: boolean;
  eventStartDate?: Date | string | null;
  ratingMatchFormat?: "RR_K1" | "K1" | null;
  competitionFormat?: "AUTO" | "K1" | null;
}

type CaptureOptionsResolved = {
  captureInscricoes: boolean;
  captureGrupos: boolean;
  captureResultados: boolean;
  fetchEliminatoria: boolean;
  eventStartDate: Date | string | null;
  ratingMatchFormat: "RR_K1" | "K1" | null;
  competitionFormat: "AUTO" | "K1" | null;
};

const TAB_CONFIG: Array<{ tabName: string; controlVar: string; tabLabel: string }> = [
  { tabName: "INSCRICOESTAB", controlVar: "CardViewInscricoes", tabLabel: "INSCRICOES" },
  { tabName: "GRUPOSTAB", controlVar: "CardViewGrupo", tabLabel: "GRUPOS" },
  { tabName: "RESULTADOSTAB", controlVar: "CardViewResultado", tabLabel: "RESULTADOS" },
];

function resolveCaptureOptions(options: CaptureOptions | undefined): CaptureOptionsResolved {
  return {
    captureInscricoes: options?.captureInscricoes ?? true,
    captureGrupos: options?.captureGrupos ?? true,
    captureResultados: options?.captureResultados ?? true,
    fetchEliminatoria: false,
    eventStartDate: options?.eventStartDate ?? null,
    ratingMatchFormat: options?.ratingMatchFormat ?? null,
    competitionFormat: options?.competitionFormat ?? null,
  };
}

function shouldIncludePayloadByTab(tab: DxTab, options: CaptureOptionsResolved): boolean {
  if (tab === "INSCRICOES") {
    return options.captureInscricoes;
  }
  if (tab === "GRUPOS") {
    return options.captureGrupos;
  }
  if (tab === "RESULTADOS") {
    return options.captureResultados;
  }
  if (tab === "ELIMINATORIA") {
    return options.fetchEliminatoria;
  }
  return true;
}

function hasMatchGameId(match: {
  cbtmMatchId?: string | null;
  metadata?: Record<string, string | number | null> | undefined;
  round?: string | null;
}): boolean {
  if (match.cbtmMatchId && compactWhitespace(match.cbtmMatchId)) {
    return true;
  }

  const rawMetaGame = compactWhitespace(String(match.metadata?.jogo ?? ""));
  if (rawMetaGame && /\d+/.test(rawMetaGame)) {
    return true;
  }

  const round = compactWhitespace(String(match.round ?? "")).toLowerCase();
  if (/\bjogo\s*0*\d+\b/.test(round)) {
    return true;
  }

  return false;
}

function hasDxServerError(rawLiteral: string): boolean {
  const normalized = compactWhitespace(rawLiteral).toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("'error':{'message':") ||
    normalized.includes('"error":{"message":') ||
    normalized.includes("object reference not set to an instance of an object")
  );
}

export class CaptureService {
  private readonly dxRequestBuilder = new DXRequestBuilder();
  private readonly liveHttpCaptureService = new LiveHttpCaptureService();
  private readonly httpResultsDegradedUntilByEventId = new Map<number, number>();
  private static readonly HTTP_DEGRADED_TTL_MS = 2 * 60 * 60 * 1000;

  private shouldPreferBrowserForResults(eventId: number, options: CaptureOptionsResolved): boolean {
    if (!options.captureResultados) {
      return false;
    }
    return true;
  }

  private markHttpResultsDegraded(eventId: number): void {
    this.httpResultsDegradedUntilByEventId.set(
      eventId,
      Date.now() + CaptureService.HTTP_DEGRADED_TTL_MS,
    );
  }

  async capture(eventId: number, options?: CaptureOptions): Promise<CaptureResult> {
    const resolvedOptions = resolveCaptureOptions(options);

    if (config.scraperMode === "fixture") {
      return this.captureFixture(eventId, resolvedOptions);
    }

    return this.captureLive(eventId, resolvedOptions);
  }

  private async captureFixture(eventId: number, options: CaptureOptionsResolved): Promise<CaptureResult> {
    const fixtureFiles = this.resolveFixtureFiles();
    const rawBodies = fixtureFiles.map((filePath) => fs.readFileSync(filePath, "utf8"));
    const payloads = rawBodies
      .flatMap((raw) => extractDxPayloads(raw))
      .filter((payload) => shouldIncludePayloadByTab(payload.tab, options));
    const ignoredCategoryIds = new Set(config.scraperExcludedCategoryIds);

    const seededCategories = parseDxPayloads(eventId, payloads).categories;
    const categoryNameById = new Map<string, string>();
    for (const seeded of seededCategories) {
      if (seeded.categoryId) {
        categoryNameById.set(seeded.categoryId, seeded.categoryName);
      }
    }

    const discoveredMap = new Map<string, DiscoveredCategory>();
    for (const payload of payloads) {
      if (!payload.categoryId || discoveredMap.has(payload.categoryId)) {
        continue;
      }
      discoveredMap.set(payload.categoryId, {
        categoryId: payload.categoryId,
        categoryName: categoryNameById.get(payload.categoryId) ?? `Categoria ${payload.categoryId}`,
        valid: !ignoredCategoryIds.has(payload.categoryId),
      });
    }

    return {
      payloads,
      rawBodies,
      eliminationPayloads: [],
      source: "fixture",
      warnings: [],
      categoriesDiscovered: [...discoveredMap.values()],
      categoriesVisited: [...new Set(payloads.map((item) => item.categoryId).filter(Boolean))] as string[],
      tabsVisited: [...new Set(payloads.map((item) => item.tab))],
      paginationRequests: 0,
      categoryDiagnostics: {},
    };
  }

  private resolveFixtureFiles(): string[] {
    const files: string[] = [];
    const seen = new Set<string>();

    for (const rawInput of config.scraperFixturePaths) {
      const absoluteInput = path.resolve(rawInput);
      if (!fs.existsSync(absoluteInput)) {
        continue;
      }

      const stats = fs.statSync(absoluteInput);
      if (stats.isDirectory()) {
        for (const entry of fs.readdirSync(absoluteInput, { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".txt")) {
            continue;
          }
          const resolved = path.resolve(absoluteInput, entry.name);
          if (!seen.has(resolved)) {
            seen.add(resolved);
            files.push(resolved);
          }
        }
        continue;
      }

      if (!seen.has(absoluteInput)) {
        seen.add(absoluteInput);
        files.push(absoluteInput);
      }
    }

    if (files.length === 0) {
      return [path.resolve(config.scraperFixturePath)];
    }

    return files.sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  }

  private async captureLive(eventId: number, options: CaptureOptionsResolved): Promise<CaptureResult> {
    if (this.shouldPreferBrowserForResults(eventId, options)) {
      const browserFirst = await this.captureLiveBrowser(eventId, options);
      browserFirst.warnings.unshift(
        `HTTP_DEGRADED_RESULTS: evento ${eventId} em modo browser-first por degradacao recente da captura HTTP de RESULTADOS.`,
      );
      return browserFirst;
    }

    try {
      const httpCapture = await this.liveHttpCaptureService.capture(eventId, options);
      const httpWarnings = [...httpCapture.warnings];
      const sanitizedPayloads = httpCapture.payloads.filter((payload) => {
        if (payload.tab !== "RESULTADOS") {
          return true;
        }
        if (!options.captureResultados) {
          return true;
        }
        if (!hasDxServerError(payload.rawLiteral)) {
          return true;
        }
        return false;
      });
      if (sanitizedPayloads.length < httpCapture.payloads.length) {
        httpWarnings.push(
          `Payloads DX invalidos de RESULTADOS foram ignorados (${httpCapture.payloads.length - sanitizedPayloads.length}).`,
        );
      }
      const resultadosPayloads = httpCapture.payloads.filter((payload) => payload.tab === "RESULTADOS");
      const resultadosWithServerError = resultadosPayloads.filter((payload) => hasDxServerError(payload.rawLiteral));
      const erroredResultCategoryIds = new Set(
        resultadosWithServerError.map((payload) => compactWhitespace(payload.categoryId ?? "")).filter(Boolean),
      );
      let mergedPayloads = [...sanitizedPayloads];
      let mergedEliminationPayloads = [...httpCapture.eliminationPayloads];
      let retriedByBrowserCategories: string[] = [];
      const requiresResultValidation = options.captureResultados;
      const diagnosticWarnings: string[] = [];

      if (requiresResultValidation && erroredResultCategoryIds.size > 0) {
        const categoryRetry = await this.captureLiveBrowser(
          eventId,
          {
            captureInscricoes: false,
            captureGrupos: false,
            captureResultados: true,
            fetchEliminatoria: options.fetchEliminatoria,
            eventStartDate: options.eventStartDate,
            ratingMatchFormat: options.ratingMatchFormat,
            competitionFormat: options.competitionFormat,
          },
          erroredResultCategoryIds,
        );
        retriedByBrowserCategories = [...erroredResultCategoryIds.values()];
        diagnosticWarnings.push(
          `Retry browser por categoria aplicado em RESULTADOS para ${retriedByBrowserCategories.length} categoria(s): ${retriedByBrowserCategories.join(", ")}.`,
        );
        diagnosticWarnings.push(...categoryRetry.warnings.map((warning) => `[retry-categoria] ${warning}`));

        const retryResultPayloadsByCategory = new Map<string, DxPayload[]>();
        for (const payload of categoryRetry.payloads) {
          if (payload.tab !== "RESULTADOS" || !payload.categoryId) {
            continue;
          }
          const bucket = retryResultPayloadsByCategory.get(payload.categoryId) ?? [];
          bucket.push(payload);
          retryResultPayloadsByCategory.set(payload.categoryId, bucket);
        }

        mergedPayloads = mergedPayloads.filter(
          (payload) =>
            payload.tab !== "RESULTADOS" ||
            !payload.categoryId ||
            !erroredResultCategoryIds.has(payload.categoryId),
        );
        for (const [categoryId, retryPayloads] of retryResultPayloadsByCategory.entries()) {
          if (!erroredResultCategoryIds.has(categoryId)) {
            continue;
          }
          mergedPayloads.push(...retryPayloads);
        }

        mergedEliminationPayloads = [];
      }

      const categorizedPayloads = mergedPayloads.filter((payload) => Boolean(payload.categoryId)).length;
      const previewDataset = parseDxPayloads(eventId, mergedPayloads, {
        categoriesDiscovered: httpCapture.categoriesDiscovered,
        eliminationPayloads: mergedEliminationPayloads,
      });
      const resultadosCount = previewDataset.matches.filter((match) => match.phase === "RESULTADOS").length;
      const matchesWithSets = previewDataset.matches.filter((match) => (match.sets?.length ?? 0) > 0).length;
      if (options.captureInscricoes) {
        diagnosticWarnings.push(
          ...this.buildRegistrationCoverageWarnings(previewDataset.registrations, httpCapture.categoriesDiscovered),
        );
      }

      if (requiresResultValidation && resultadosCount > 0) {
        const byCategory = new Map<
          string,
          { total: number; withSets: number; withoutSets: number; missingMetadata: number; name: string }
        >();
        for (const match of previewDataset.matches) {
          if (match.phase !== "RESULTADOS") {
            continue;
          }

          const key = match.categoryId ?? `name:${match.categoryNormalizedName}`;
          const bucket = byCategory.get(key) ?? {
            total: 0,
            withSets: 0,
            withoutSets: 0,
            missingMetadata: 0,
            name: match.categoryName,
          };
          bucket.total += 1;
          if ((match.sets?.length ?? 0) > 0) {
            bucket.withSets += 1;
          } else {
            bucket.withoutSets += 1;
          }
          const hasRound = Boolean(compactWhitespace(match.round ?? ""));
          const hasTable = Boolean(compactWhitespace(match.tableNumber ?? ""));
          const hasDay = Boolean(compactWhitespace(match.matchDatetime ?? ""));
          const hasGameId = hasMatchGameId(match);
          if (!hasRound || !hasTable || !hasDay || !hasGameId) {
            bucket.missingMetadata += 1;
          }
          byCategory.set(key, bucket);
        }

        for (const [categoryKey, bucket] of byCategory.entries()) {
          if (bucket.total > 0 && bucket.withSets === 0) {
            diagnosticWarnings.push(
              `RESULTADOS sem sets na categoria '${bucket.name}' (${categoryKey}) - jogos=${bucket.total}.`,
            );
          }

          diagnosticWarnings.push(
            `RESULTADOS diagnostico '${bucket.name}' (${categoryKey}): com_sets=${bucket.withSets}, sem_sets=${bucket.withoutSets}, metadata_incompleta=${bucket.missingMetadata}, total=${bucket.total}.`,
          );
        }
      }

      if (categorizedPayloads === 0) {
        throw new Error(
          `Captura HTTP inconsistente (categorizedPayloads=${categorizedPayloads}, resultadosCount=${resultadosCount}, matchesWithSets=${matchesWithSets})`,
        );
      }

      if (requiresResultValidation && (resultadosCount === 0 || matchesWithSets === 0)) {
        diagnosticWarnings.push(
          `Captura HTTP com resultados incompletos (resultadosCount=${resultadosCount}, matchesWithSets=${matchesWithSets}); mantendo payload HTTP para evitar scrape vazio.`,
        );
      }

      if (requiresResultValidation && resultadosWithServerError.length > 0) {
        diagnosticWarnings.push(
          `Detectado erro de callback DX em RESULTADOS (${resultadosWithServerError.length}/${resultadosPayloads.length} payloads); fallback para browser sera acionado se nao houver jogos de resultados validos.`,
        );
      }

      if (requiresResultValidation && resultadosCount === 0 && resultadosWithServerError.length > 0) {
        this.markHttpResultsDegraded(eventId);
        throw new Error(
          `Captura HTTP de RESULTADOS com erro DX (${resultadosWithServerError.length} payloads com erro e resultadosCount=${resultadosCount}).`,
        );
      }

      return {
        ...httpCapture,
        payloads: mergedPayloads,
        eliminationPayloads: mergedEliminationPayloads,
        warnings: [...httpWarnings, ...diagnosticWarnings],
        source: "live-http",
        categoryDiagnostics: this.buildCategoryDiagnostics({
          payloads: mergedPayloads,
          resultadosWithServerError,
          retriedByBrowserCategoryIds: new Set(retriedByBrowserCategories),
          source: retriedByBrowserCategories.length > 0 ? "mixed" : "http",
        }),
      };
    } catch (error) {
      if (
        String(error ?? "").includes("Captura HTTP de RESULTADOS com erro DX") ||
        String(error ?? "").includes("Captura HTTP inconsistente")
      ) {
        this.markHttpResultsDegraded(eventId);
      }
      const fallback = await this.captureLiveBrowser(eventId, options);
      fallback.warnings.unshift(
        `HTTP_DEGRADED_RESULTS: Falha no scraping HTTP, fallback para browser: ${String(error)}`,
      );
      return fallback;
    }
  }

  private async captureLiveBrowser(
    eventId: number,
    options: CaptureOptionsResolved,
    onlyCategoryIds?: Set<string>,
  ): Promise<CaptureResult> {
    const browser = await chromium.launch({ headless: config.scraperHeadless });
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "Accept-Encoding": process.env.SCRAPER_HTTP_ACCEPT_ENCODING ?? "gzip, deflate, br",
      },
    });
    const page = await context.newPage();

    const warnings: string[] = [];
    const responses: Array<{
      rawBody: string;
      fallbackCategoryId: string | null;
      requestCategoryId: string | null;
      tabLabel: string | null;
    }> = [];
    const seen = new Set<string>();
    const requestContext = new WeakMap<
      object,
      { fallbackCategoryId: string | null; requestCategoryId: string | null; tabLabel: string | null }
    >();
    const tabsVisited = new Set<string>();
    const categoriesVisited = new Set<string>();
    const eliminationPayloads: EliminationPayload[] = [];
    let paginationRequests = 0;
    let activeCategoryId: string | null = null;
    let activeTabLabel: string | null = null;

    page.on("request", (request) => {
      try {
        if (request.method() !== "POST") {
          return;
        }
        if (!request.url().includes(`/IUI/App/Evento?EVE_Evento_ID=${eventId}`)) {
          return;
        }
        const requestCategoryId = this.extractCategoryIdFromDxRequest(request.postData());
        requestContext.set(request as unknown as object, {
          fallbackCategoryId: activeCategoryId,
          requestCategoryId,
          tabLabel: activeTabLabel,
        });
      } catch {
        // Melhor esforco para associar request e response.
      }
    });

    page.on("response", async (response) => {
      try {
        const request = response.request();
        if (request.method() !== "POST") {
          return;
        }

        if (!response.url().includes(`/IUI/App/Evento?EVE_Evento_ID=${eventId}`)) {
          return;
        }

        const text = await response.text();
        if (!text.includes("/*DX*/")) {
          return;
        }

        const requestCtx = requestContext.get(request as unknown as object);
        const tabLabel = requestCtx?.tabLabel ?? null;
        if (!tabLabel) {
          return;
        }
        const requestCategoryId = compactWhitespace(requestCtx?.requestCategoryId ?? "");
        const fallbackCategoryId = compactWhitespace(requestCtx?.fallbackCategoryId ?? "");
        const dedupeKey = `${requestCategoryId || fallbackCategoryId || "sem_categoria"}|${tabLabel}|${text}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          responses.push({
            rawBody: text,
            fallbackCategoryId: fallbackCategoryId || null,
            requestCategoryId: requestCategoryId || null,
            tabLabel,
          });
        }
      } catch (error) {
        const message = String(error ?? "");
        if (message.includes("Target page, context or browser has been closed")) {
          return;
        }
        warnings.push(`Falha ao ler response DX: ${message}`);
      }
    });

    try {
      const eventUrl = config.scraperEventUrl.replace("{EVENT_ID}", String(eventId));
      let navigated = false;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const waitUntil = attempt === 1 ? "domcontentloaded" : "networkidle";
        const timeout = attempt === 1 ? 90000 : 120000;
        try {
          await page.goto(eventUrl, { waitUntil, timeout });
          await page.waitForTimeout(1500);
          navigated = true;
          break;
        } catch (error) {
          warnings.push(
            `Falha ao abrir pagina do evento (tentativa ${attempt}/2, waitUntil=${waitUntil}): ${String(error ?? "")}`,
          );
        }
      }
      if (!navigated) {
        throw new Error(`Nao foi possivel abrir a pagina do evento ${eventId} no browser fallback.`);
      }

      const ignoredCategoryIds = new Set(config.scraperExcludedCategoryIds);
      const discovered = await this.discoverCategories(page, ignoredCategoryIds, options);
      const validCategories = discovered.filter(
        (item) => item.valid && (!onlyCategoryIds || onlyCategoryIds.has(item.categoryId)),
      );

      for (const category of validCategories) {
        activeCategoryId = category.categoryId;
        const categoryContext: CategoryContext = {
          categoryId: category.categoryId,
          categoryName: category.categoryName,
        };
        const selected = await this.selectCategory(page, categoryContext);
        if (!selected) {
          warnings.push(`Categoria não selecionada: ${category.categoryName} (${category.categoryId})`);
          continue;
        }

        categoriesVisited.add(category.categoryId);

        for (const tab of TAB_CONFIG) {
          if (
            (tab.tabLabel === "INSCRICOES" && !options.captureInscricoes) ||
            (tab.tabLabel === "GRUPOS" && !options.captureGrupos) ||
            (tab.tabLabel === "RESULTADOS" && !options.captureResultados)
          ) {
            continue;
          }

          tabsVisited.add(tab.tabLabel);
          activeTabLabel = tab.tabLabel;
          const loaded = await this.loadTab(page, tab.tabName);
          if (!loaded) {
            warnings.push(
              `Aba não carregada para categoria ${category.categoryId}: ${tab.tabLabel}`,
            );
            activeTabLabel = null;
            continue;
          }

          const pagination = await this.paginateCardView(page, tab.controlVar, {
            categoryId: category.categoryId,
            tabLabel: tab.tabLabel,
          });
          paginationRequests += pagination.requests;
          warnings.push(...pagination.warnings);
          activeTabLabel = null;
        }

        activeCategoryId = null;
        activeTabLabel = null;
      }

      const payloads: DxPayload[] = [];
      const discoveredCategoryIds = new Set(discovered.map((item) => item.categoryId));
      const droppedMismatchedCategoryIds = new Map<string, number>();
      for (const responseEntry of responses) {
        const { rawBody, fallbackCategoryId, requestCategoryId, tabLabel } = responseEntry;
        const extracted = extractDxPayloads(rawBody)
          .map((payload) => {
          const payloadCategoryId = compactWhitespace(payload.categoryId ?? "");
          const requestCategoryIdNorm = compactWhitespace(requestCategoryId ?? "");
          const fallbackCategoryIdNorm = compactWhitespace(fallbackCategoryId ?? "");

          // Em RESULTADOS, so descarta quando nao ha nenhum contexto de categoria.
          // Isso preserva volume de jogos sem aceitar payload totalmente "solto".
          if (payload.tab === "RESULTADOS" && !requestCategoryIdNorm && !fallbackCategoryIdNorm) {
            return null;
          }

          const payloadIsValid =
            Boolean(payloadCategoryId) &&
            discoveredCategoryIds.has(payloadCategoryId) &&
            !ignoredCategoryIds.has(payloadCategoryId);
          const requestIsValid =
            Boolean(requestCategoryIdNorm) &&
            discoveredCategoryIds.has(requestCategoryIdNorm) &&
            !ignoredCategoryIds.has(requestCategoryIdNorm);
          const fallbackIsValid =
            Boolean(fallbackCategoryIdNorm) &&
            discoveredCategoryIds.has(fallbackCategoryIdNorm) &&
            !ignoredCategoryIds.has(fallbackCategoryIdNorm);

          // Quando payload e contexto da requisicao trazem categoryId validos e divergentes,
          // trata-se de resposta defasada. Nao re-rotular para evitar poluicao entre categorias.
          if (payloadIsValid && requestIsValid && payloadCategoryId !== requestCategoryIdNorm) {
            const mismatchKey = `${tabLabel ?? payload.tab}:${payloadCategoryId}->${requestCategoryIdNorm}`;
            droppedMismatchedCategoryIds.set(
              mismatchKey,
              (droppedMismatchedCategoryIds.get(mismatchKey) ?? 0) + 1,
            );
            return null;
          }

          if (
            payloadIsValid &&
            !requestIsValid &&
            fallbackIsValid &&
            payloadCategoryId !== fallbackCategoryIdNorm
          ) {
            const mismatchKey = `${tabLabel ?? payload.tab}:${payloadCategoryId}->${fallbackCategoryIdNorm}`;
            droppedMismatchedCategoryIds.set(
              mismatchKey,
              (droppedMismatchedCategoryIds.get(mismatchKey) ?? 0) + 1,
            );
            return null;
          }

          let chosenCategoryId = "";
          if (payloadIsValid) {
            chosenCategoryId = payloadCategoryId;
          } else if (requestIsValid) {
            chosenCategoryId = requestCategoryIdNorm;
          } else if (fallbackIsValid) {
            chosenCategoryId = fallbackCategoryIdNorm;
          }

          if (!chosenCategoryId) {
            return payload;
          }
          return {
            ...payload,
            categoryId: chosenCategoryId,
          };
          })
          .filter((payload): payload is DxPayload => Boolean(payload));
        payloads.push(...extracted);
      }

      if (droppedMismatchedCategoryIds.size > 0) {
        const samples = [...droppedMismatchedCategoryIds.entries()]
          .slice(0, 5)
          .map(([key, count]) => `${key} (${count}x)`)
          .join(", ");
        warnings.push(
          `Capture browser descartou payload com categoryId inconsistente em ${droppedMismatchedCategoryIds.size} combinacao(oes): ${samples}.`,
        );
      }

      return {
        payloads,
        rawBodies: responses.map((entry) => entry.rawBody),
        eliminationPayloads,
        source: "live-browser",
        warnings,
        categoriesDiscovered: discovered,
        categoriesVisited: [...categoriesVisited],
        tabsVisited: [...tabsVisited],
        paginationRequests,
        categoryDiagnostics: this.buildCategoryDiagnostics({
          payloads,
          resultadosWithServerError: [],
          retriedByBrowserCategoryIds: new Set(),
          source: "browser",
        }),
      };
    } finally {
      await context.close();
      await browser.close();
    }
  }

  private buildCategoryDiagnostics(input: {
    payloads: DxPayload[];
    resultadosWithServerError: DxPayload[];
    retriedByBrowserCategoryIds: Set<string>;
    source: "http" | "browser" | "mixed";
  }): Record<
    string,
    {
      payloadsByTab: Record<string, number>;
      dxResultErrorCount: number;
      retriedByBrowser: boolean;
      source: "http" | "browser" | "mixed";
    }
  > {
    const diagnostics: Record<
      string,
      {
        payloadsByTab: Record<string, number>;
        dxResultErrorCount: number;
        retriedByBrowser: boolean;
        source: "http" | "browser" | "mixed";
      }
    > = {};

    for (const payload of input.payloads) {
      const categoryId = compactWhitespace(payload.categoryId ?? "");
      if (!categoryId) {
        continue;
      }
      const existing = diagnostics[categoryId] ?? {
        payloadsByTab: {},
        dxResultErrorCount: 0,
        retriedByBrowser: input.retriedByBrowserCategoryIds.has(categoryId),
        source: input.source,
      };
      existing.payloadsByTab[payload.tab] = (existing.payloadsByTab[payload.tab] ?? 0) + 1;
      diagnostics[categoryId] = existing;
    }

    for (const payload of input.resultadosWithServerError) {
      const categoryId = compactWhitespace(payload.categoryId ?? "");
      if (!categoryId) {
        continue;
      }
      const existing = diagnostics[categoryId] ?? {
        payloadsByTab: {},
        dxResultErrorCount: 0,
        retriedByBrowser: input.retriedByBrowserCategoryIds.has(categoryId),
        source: input.source,
      };
      existing.dxResultErrorCount += 1;
      diagnostics[categoryId] = existing;
    }

    return diagnostics;
  }

  private extractCategoryIdFromDxRequest(postData: string | null | undefined): string | null {
    const raw = String(postData ?? "");
    if (!raw) {
      return null;
    }

    const decoded = (() => {
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    })();

    const candidates = [raw, decoded];
    for (const candidate of candidates) {
      const params = new URLSearchParams(candidate);
      const callbackParam = params.get("__CALLBACKPARAM") ?? "";
      const payload = `${candidate}\n${callbackParam}`;

      const customCallbackMatch = payload.match(/CUSTOMCALLBACK3\|(\d+)\s*;/i);
      if (customCallbackMatch?.[1]) {
        return customCallbackMatch[1];
      }

      const categorySelectMatch = payload.match(/(?:^|[|;:,])c0:(\d+)(?:[|;:,]|$)/i);
      if (categorySelectMatch?.[1]) {
        return categorySelectMatch[1];
      }
    }

    return null;
  }

  private buildRegistrationCoverageWarnings(
    registrations: Array<{ categoryId?: string | null }>,
    categoriesDiscovered: DiscoveredCategory[],
  ): string[] {
    const validCategoriesWithCounters = categoriesDiscovered.filter(
      (category) => category.valid && Number(category.totalListedCount ?? 0) > 0,
    );
    if (validCategoriesWithCounters.length === 0) {
      return [];
    }

    const expectedTotal = validCategoriesWithCounters.reduce(
      (sum, category) => sum + Number(category.totalListedCount ?? 0),
      0,
    );

    const actualByCategoryId = new Map<string, number>();
    for (const registration of registrations) {
      const categoryId = compactWhitespace(registration.categoryId ?? "");
      if (!categoryId) {
        continue;
      }
      actualByCategoryId.set(categoryId, (actualByCategoryId.get(categoryId) ?? 0) + 1);
    }

    const actualTotal = validCategoriesWithCounters.reduce(
      (sum, category) => sum + (actualByCategoryId.get(category.categoryId) ?? 0),
      0,
    );

    const warnings: string[] = [];
    const ratio = expectedTotal > 0 ? actualTotal / expectedTotal : 1;
    warnings.push(
      `INSCRICOES reconciliacao: esperado_combo=${expectedTotal}, extraido_parser=${actualTotal}, cobertura=${(ratio * 100).toFixed(1)}%.`,
    );

    if (ratio >= 0.97) {
      return warnings;
    }

    const largestGaps = validCategoriesWithCounters
      .map((category) => {
        const expected = Number(category.totalListedCount ?? 0);
        const actual = actualByCategoryId.get(category.categoryId) ?? 0;
        return {
          categoryId: category.categoryId,
          categoryName: category.categoryName,
          expected,
          actual,
          gap: expected - actual,
        };
      })
      .filter((entry) => entry.gap > 0)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 10);

    if (largestGaps.length > 0) {
      warnings.push(
        `INSCRICOES gaps top10: ${largestGaps
          .map(
            (entry) =>
              `${entry.categoryName}(${entry.categoryId}) esperado=${entry.expected} extraido=${entry.actual} gap=${entry.gap}`,
          )
          .join(" | ")}`,
      );
    }

    return warnings;
  }

  private async discoverCategories(
    page: import("playwright").Page,
    ignoredCategoryIds: Set<string>,
    options: CaptureOptionsResolved,
  ): Promise<DiscoveredCategory[]> {
    const discoveredRaw = await page.evaluate((ignored) => {
      const combo = (window as any).cmbCategoria;
      if (!combo || typeof combo.GetItemCount !== "function" || typeof combo.GetItem !== "function") {
        return [];
      }

      const values: DiscoveredCategory[] = [];
      const seen = new Set<string>();
      const ignoredSet = new Set<string>(ignored);

      for (let index = 0; index < combo.GetItemCount(); index += 1) {
        const item = combo.GetItem(index);
        if (!item) {
          continue;
        }

        const categoryId = String(item.value ?? "").trim();
        const rawText = String(item.text ?? "").replace(/\s+/g, " ").trim();
        const preMatches = [...rawText.matchAll(/(\d+)\s+pr[^\s]*inscrito(?:\(s\)|s)?/gi)];
        const registeredMatches = [...rawText.matchAll(/(\d+)\s+inscrito(?:\(s\)|s)?/gi)];
        const preRegisteredCount =
          preMatches.reduce((sum, match) => sum + Number(match[1] ?? 0), 0) || null;
        const registeredCount =
          registeredMatches.reduce((sum, match) => sum + Number(match[1] ?? 0), 0) || null;
        const totalListedCount =
          (registeredCount ?? 0) + (preRegisteredCount ?? 0) > 0
            ? (registeredCount ?? 0) + (preRegisteredCount ?? 0)
            : null;
        const categoryName = rawText
          .replace(
            /\s+\d+\s+(?:pr[eé][-\s]?inscrito(?:\(s\)|s)?|inscrito(?:\(s\)|s)?)(?:[\s\S]*)$/i,
            "",
          )
          .trim();
        if (!categoryId || !categoryName || seen.has(categoryId)) {
          continue;
        }

        seen.add(categoryId);
        values.push({
          categoryId,
          categoryName,
          valid: !ignoredSet.has(categoryId),
          registeredCount,
          preRegisteredCount,
          totalListedCount,
          officialMatchesCount: null,
        });
      }

      return values;
    }, [...ignoredCategoryIds]);

    return discoveredRaw.map((category) => {
      const officialMatchesCount = computeOfficialCategoryMatchesCount(category.registeredCount, {
        categoryName: category.categoryName,
        eventStartDate: options.eventStartDate,
        ratingMatchFormat: options.ratingMatchFormat,
        competitionFormat: options.competitionFormat,
      });
      return {
        ...category,
        officialMatchesCount: officialMatchesCount > 0 ? officialMatchesCount : null,
      };
    });
  }

  private async selectCategory(page: import("playwright").Page, context: CategoryContext): Promise<boolean> {
    const callbackValue = this.dxRequestBuilder.toCategoryValue(context.categoryId);
    return page.evaluate(({ rawCategoryId, callbackValue }) => {
      const combo = (window as any).cmbCategoria;
      if (!combo) {
        return false;
      }

      try {
        if (typeof combo.SetValue === "function") {
          combo.SetValue(callbackValue);
        } else if (typeof combo.SelectIndex === "function" && typeof combo.GetItemCount === "function") {
          for (let index = 0; index < combo.GetItemCount(); index += 1) {
            const item = combo.GetItem(index);
            if (String(item?.value) === String(rawCategoryId)) {
              combo.SelectIndex(index);
              break;
            }
          }
        }

        if (typeof (window as any).OnSelectedIndexChangedX === "function") {
          (window as any).OnSelectedIndexChangedX(combo, {});
          return true;
        }

        const selected = combo.GetSelectedItem?.();
        if (selected?.value != null && (window as any).cbInfo?.PerformCallback) {
          (window as any).cbInfo.PerformCallback(callbackValue);
          return true;
        }

        return false;
      } catch {
        return false;
      }
    }, { rawCategoryId: context.categoryId, callbackValue });
  }

  private async loadTab(page: import("playwright").Page, tabName: string): Promise<boolean> {
    const loaded = await page.evaluate((targetTabName) => {
      const tabControl = (window as any).EventoTabPage;
      const loader = (window as any).loadControlByTab;
      if (!tabControl || typeof loader !== "function") {
        return false;
      }

      const upper = String(targetTabName).toUpperCase();
      if (typeof tabControl.GetTabCount === "function" && typeof tabControl.SetActiveTabIndex === "function") {
        for (let index = 0; index < tabControl.GetTabCount(); index += 1) {
          const tab = tabControl.GetTab(index);
          if (String(tab?.name ?? "").toUpperCase() === upper) {
            tabControl.SetActiveTabIndex(index);
            break;
          }
        }
      }

      loader(targetTabName, false);
      return true;
    }, tabName);

    if (!loaded) {
      return false;
    }

    await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => undefined);
    await page.waitForTimeout(900);
    return true;
  }

  private async paginateCardView(
    page: import("playwright").Page,
    controlVar: string,
    context?: { categoryId: string; tabLabel: string },
  ): Promise<{ requests: number; warnings: string[] }> {
    const state = await page.evaluate((targetControl) => {
      const control = (window as any)[targetControl];
      if (!control) {
        return {
          available: false,
          pageCount: 1,
          currentPageIndex: 0,
        };
      }

      const fromMethod =
        typeof control.GetPageCount === "function"
          ? Number(control.GetPageCount())
          : Number(control.pageCount ?? control.cpPageCount ?? 1);
      const currentFromMethod =
        typeof control.GetPageIndex === "function"
          ? Number(control.GetPageIndex())
          : Number(control.pageIndex ?? 0);

      return {
        available: true,
        pageCount: Number.isFinite(fromMethod) && fromMethod > 0 ? fromMethod : 1,
        currentPageIndex: Number.isFinite(currentFromMethod) ? currentFromMethod : 0,
      };
    }, controlVar);

    if (!state.available) {
      return {
        requests: 0,
        warnings: [
          `Controle de paginacao indisponivel - categoria registrada sem dados de paginacao (categoria=${context?.categoryId ?? "desconhecida"}, aba=${context?.tabLabel ?? "desconhecida"}).`,
        ],
      };
    }

    if (state.currentPageIndex === -1) {
      return { requests: 0, warnings: [] };
    }

    let requests = 0;
    for (let targetPageIndex = 0; targetPageIndex < state.pageCount; targetPageIndex += 1) {
      const callbackCommand = this.dxRequestBuilder.pagerCommand(targetPageIndex);
      const moved = await page.evaluate(
        ({ targetControl, index, callbackCommand }) => {
          const control = (window as any)[targetControl];
          if (!control) {
            return false;
          }

          const current =
            typeof control.GetPageIndex === "function"
              ? Number(control.GetPageIndex())
              : Number(control.pageIndex ?? -1);
          if (current === index) {
            return false;
          }

          try {
            if (typeof control.GotoPage === "function") {
              control.GotoPage(index);
              return true;
            }
            if (typeof control.SetPageIndex === "function") {
              control.SetPageIndex(index);
              return true;
            }
            if (typeof control.PerformCallback === "function") {
              control.PerformCallback(callbackCommand);
              return true;
            }
            return false;
          } catch {
            return false;
          }
        },
        { targetControl: controlVar, index: targetPageIndex, callbackCommand },
      );

      if (moved) {
        requests += 1;
        await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => undefined);
        await page.waitForTimeout(750);
      }
    }

    return { requests, warnings: [] };
  }
}
