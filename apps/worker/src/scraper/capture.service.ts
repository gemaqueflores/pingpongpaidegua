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
import { compactWhitespace } from "@cbtm/shared";
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
}

export interface CaptureOptions {
  captureInscricoes?: boolean;
  captureGrupos?: boolean;
  captureResultados?: boolean;
  fetchEliminatoria?: boolean;
}

type CaptureOptionsResolved = Required<CaptureOptions>;

const TAB_CONFIG: Array<{ tabName: string; controlVar: string; tabLabel: string }> = [
  { tabName: "INSCRICOESTAB", controlVar: "CardViewInscricoes", tabLabel: "INSCRICOES" },
  { tabName: "GRUPOSTAB", controlVar: "CardViewGrupo", tabLabel: "GRUPOS" },
  { tabName: "RESULTADOSTAB", controlVar: "CardViewResultado", tabLabel: "RESULTADOS" },
];

function categoryDisplayName(raw: string): string {
  return compactWhitespace(raw.replace(/\s+\d+\s+inscrito\(s\).*$/i, ""));
}

function resolveCaptureOptions(options: CaptureOptions | undefined): CaptureOptionsResolved {
  return {
    captureInscricoes: options?.captureInscricoes ?? true,
    captureGrupos: options?.captureGrupos ?? true,
    captureResultados: options?.captureResultados ?? true,
    fetchEliminatoria: options?.fetchEliminatoria ?? true,
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
    return options.captureResultados || options.fetchEliminatoria;
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

export class CaptureService {
  private readonly dxRequestBuilder = new DXRequestBuilder();
  private readonly liveHttpCaptureService = new LiveHttpCaptureService();

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
    try {
      const httpCapture = await this.liveHttpCaptureService.capture(eventId, options);
      const categorizedPayloads = httpCapture.payloads.filter((payload) => Boolean(payload.categoryId)).length;
      const previewDataset = parseDxPayloads(eventId, httpCapture.payloads, {
        categoriesDiscovered: httpCapture.categoriesDiscovered,
        eliminationPayloads: httpCapture.eliminationPayloads,
      });
      const resultadosCount = previewDataset.matches.filter((match) => match.phase === "RESULTADOS").length;
      const matchesWithSets = previewDataset.matches.filter((match) => (match.sets?.length ?? 0) > 0).length;
      const requiresResultValidation = options.captureResultados;
      const diagnosticWarnings: string[] = [];

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

      if (categorizedPayloads === 0 || (requiresResultValidation && (resultadosCount === 0 || matchesWithSets === 0))) {
        throw new Error(
          `Captura HTTP inconsistente (categorizedPayloads=${categorizedPayloads}, resultadosCount=${resultadosCount}, matchesWithSets=${matchesWithSets})`,
        );
      }

      return {
        ...httpCapture,
        warnings: [...httpCapture.warnings, ...diagnosticWarnings],
        source: "live-http",
      };
    } catch (error) {
      const fallback = await this.captureLiveBrowser(eventId, options);
      fallback.warnings.unshift(
        `Falha no scraping HTTP, fallback para browser: ${String(error)}`,
      );
      return fallback;
    }
  }

  private async captureLiveBrowser(eventId: number, options: CaptureOptionsResolved): Promise<CaptureResult> {
    const browser = await chromium.launch({ headless: config.scraperHeadless });
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "Accept-Encoding": process.env.SCRAPER_HTTP_ACCEPT_ENCODING ?? "gzip, deflate, br",
      },
    });
    const page = await context.newPage();

    const warnings: string[] = [];
    const responses: string[] = [];
    const seen = new Set<string>();
    const tabsVisited = new Set<string>();
    const categoriesVisited = new Set<string>();
    const eliminationPayloads: EliminationPayload[] = [];
    let paginationRequests = 0;

    page.on("response", async (response) => {
      try {
        if (response.request().method() !== "POST") {
          return;
        }

        if (!response.url().includes(`/IUI/App/Evento?EVE_Evento_ID=${eventId}`)) {
          return;
        }

        const text = await response.text();
        if (!text.includes("/*DX*/")) {
          return;
        }

        if (!seen.has(text)) {
          seen.add(text);
          responses.push(text);
        }
      } catch (error) {
        warnings.push(`Falha ao ler response DX: ${String(error)}`);
      }
    });

    try {
      const eventUrl = config.scraperEventUrl.replace("{EVENT_ID}", String(eventId));
      await page.goto(eventUrl, { waitUntil: "networkidle", timeout: 120000 });
      await page.waitForTimeout(1500);

      const ignoredCategoryIds = new Set(config.scraperExcludedCategoryIds);
      const discovered = await this.discoverCategories(page, ignoredCategoryIds);
      const validCategories = discovered.filter((item) => item.valid);

      for (const category of validCategories) {
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
          const loaded = await this.loadTab(page, tab.tabName);
          if (!loaded) {
            warnings.push(
              `Aba não carregada para categoria ${category.categoryId}: ${tab.tabLabel}`,
            );
            continue;
          }

          const requested = await this.paginateCardView(page, tab.controlVar);
          paginationRequests += requested;
        }

        if (options.fetchEliminatoria) {
          tabsVisited.add("ELIMINATORIA");
          const elimination = await this.fetchElimination(context, eventId, category);
          if (elimination) {
            eliminationPayloads.push(elimination);
          }
        }
      }

      const payloads: DxPayload[] = [];
      for (const rawBody of responses) {
        payloads.push(...extractDxPayloads(rawBody));
      }

      return {
        payloads,
        rawBodies: responses,
        eliminationPayloads,
        source: "live-browser",
        warnings,
        categoriesDiscovered: discovered,
        categoriesVisited: [...categoriesVisited],
        tabsVisited: [...tabsVisited],
        paginationRequests,
      };
    } finally {
      await context.close();
      await browser.close();
    }
  }

  private async discoverCategories(
    page: import("playwright").Page,
    ignoredCategoryIds: Set<string>,
  ): Promise<DiscoveredCategory[]> {
    return page.evaluate((ignored) => {
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
        const categoryName = rawText.replace(/\s+\d+\s+inscrito\(s\).*$/i, "").trim();
        if (!categoryId || !categoryName || seen.has(categoryId)) {
          continue;
        }

        seen.add(categoryId);
        values.push({
          categoryId,
          categoryName,
          valid: !ignoredSet.has(categoryId),
        });
      }

      return values;
    }, [...ignoredCategoryIds]);
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

  private async paginateCardView(page: import("playwright").Page, controlVar: string): Promise<number> {
    const state = await page.evaluate((targetControl) => {
      const control = (window as any)[targetControl];
      if (!control) {
        return {
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
        pageCount: Number.isFinite(fromMethod) && fromMethod > 0 ? fromMethod : 1,
        currentPageIndex: Number.isFinite(currentFromMethod) ? currentFromMethod : 0,
      };
    }, controlVar);

    if (state.currentPageIndex === -1) {
      return 0;
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

    return requests;
  }

  private async fetchElimination(
    context: import("playwright").BrowserContext,
    eventId: number,
    category: DiscoveredCategory,
  ): Promise<EliminationPayload | null> {
    const url = `https://app.cbtm.org.br/api/GameResult/${eventId}/${category.categoryId}`;
    try {
      const response = await context.request.get(url);
      if (!response.ok()) {
        return null;
      }

      const rawBody = compactWhitespace(await response.text());
      if (!rawBody || rawBody === "\"\"" || rawBody === "null") {
        return null;
      }

      return {
        categoryId: category.categoryId,
        categoryName: categoryDisplayName(category.categoryName),
        rawBody,
      };
    } catch {
      return null;
    }
  }
}
