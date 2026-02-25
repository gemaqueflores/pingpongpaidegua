import { APIRequestContext, request } from "playwright";
import {
  DiscoveredCategory,
  DxPayload,
  EliminationPayload,
  extractDxPayloads,
} from "@cbtm/parser";
import { compactWhitespace, computeOfficialCategoryMatchesCount } from "@cbtm/shared";
import { config } from "../config";
import { CategoryContext, DXRequestBuilder } from "./dx-request-builder";
import type { CaptureOptions } from "./capture.service";

interface HttpTabConfig {
  tabLabel: "INSCRICOES" | "GRUPOS" | "RESULTADOS";
  callbackId: string;
}

export interface LiveHttpCaptureResult {
  payloads: DxPayload[];
  rawBodies: string[];
  eliminationPayloads: EliminationPayload[];
  warnings: string[];
  categoriesDiscovered: DiscoveredCategory[];
  categoriesVisited: string[];
  tabsVisited: string[];
  paginationRequests: number;
}

interface InitialPageSnapshot {
  hiddenFields: Record<string, string>;
  categories: DiscoveredCategory[];
  categoryTextById: Map<string, string>;
}

const HTTP_TAB_CONFIG: HttpTabConfig[] = [
  {
    tabLabel: "INSCRICOES",
    callbackId: "ctl00$ctl00$MainContent$MainContent$EventoTabPage$Inscricoes$CardViewInscricoes",
  },
  {
    tabLabel: "GRUPOS",
    callbackId: "ctl00$ctl00$MainContent$MainContent$EventoTabPage$Grupos$CardViewGrupo",
  },
  {
    tabLabel: "RESULTADOS",
    callbackId: "ctl00$ctl00$MainContent$MainContent$EventoTabPage$Resultados$CardViewResultado",
  },
];

const CBINFO_CALLBACK_ID = "ctl00$ctl00$MainContent$MainContent$cbInfo";
const RESULTS_PHASE_CALLBACK_ID =
  "ctl00$ctl00$MainContent$MainContent$EventoTabPage$Resultados$cmbFase";
const RESULTS_ATHLETE_CALLBACK_ID =
  "ctl00$ctl00$MainContent$MainContent$EventoTabPage$Resultados$cmbAtleta";
const RESULTS_FILTER_REFRESH_PARAM = "c0:LECCP|7;REFRESH;LBCRI|4;0:-2;";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

function categoryDisplayName(raw: string): string {
  return compactWhitespace(
    raw.replace(
      /\s+\d+\s+(?:pr[eé][-\s]?inscrito(?:\(s\)|s)?|inscrito(?:\(s\)|s)?)(?:[\s\S]*)$/i,
      "",
    ),
  );
}

function parseCategoryCounters(raw: string): {
  registeredCount: number | null;
  preRegisteredCount: number | null;
  totalListedCount: number | null;
} {
  const text = compactWhitespace(raw);
  if (!text) {
    return {
      registeredCount: null,
      preRegisteredCount: null,
      totalListedCount: null,
    };
  }

  const preMatches = [...text.matchAll(/(\d+)\s+pr[^\s]*inscrito(?:\(s\)|s)?/gi)];
  const registeredMatches = [...text.matchAll(/(\d+)\s+inscrito(?:\(s\)|s)?/gi)];

  const preRegisteredCount = preMatches.reduce((sum, match) => sum + Number(match[1] ?? 0), 0) || null;
  const registeredCount = registeredMatches.reduce((sum, match) => sum + Number(match[1] ?? 0), 0) || null;
  const totalListedCount =
    (registeredCount ?? 0) + (preRegisteredCount ?? 0) > 0
      ? (registeredCount ?? 0) + (preRegisteredCount ?? 0)
      : null;

  return {
    registeredCount,
    preRegisteredCount,
    totalListedCount,
  };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code) => {
      const parsed = Number(code);
      if (!Number.isFinite(parsed)) {
        return "";
      }
      return String.fromCodePoint(parsed);
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function parseHiddenInputs(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const inputRegex = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  const nameRegex = /name=["']([^"']+)["']/i;
  const valueRegex = /value=["']([\s\S]*?)["']/i;

  for (const match of html.matchAll(inputRegex)) {
    const tag = match[0];
    const nameMatch = tag.match(nameRegex);
    if (!nameMatch) {
      continue;
    }

    const valueMatch = tag.match(valueRegex);
    fields[nameMatch[1]] = valueMatch ? valueMatch[1] : "";
  }

  return fields;
}

function parseCategoriesFromHtml(
  html: string,
  ignoredCategoryIds: Set<string>,
  options?: CaptureOptions,
): { categories: DiscoveredCategory[]; categoryTextById: Map<string, string> } {
  const categories: DiscoveredCategory[] = [];
  const categoryTextById = new Map<string, string>();

  const scriptMatch = html.match(
    /ASPx\.createControl\(ASPxClientListBox,'MainContent_MainContent_cmbCategoria_DDD_L'[\s\S]*?itemsInfo':\[(.*?)\]\}\s*,\{/,
  );
  if (!scriptMatch?.[1]) {
    return { categories, categoryTextById };
  }

  const seen = new Set<string>();
  const itemRegex = /\{\s*'value':([^,]+),'text':'((?:\\'|[^'])*)'\}/g;
  for (const itemMatch of scriptMatch[1].matchAll(itemRegex)) {
    const rawValue = compactWhitespace(itemMatch[1] ?? "");
    const rawText = itemMatch[2] ?? "";
    const categoryId = rawValue.replace(/^'+|'+$/g, "");
    if (!/^\d+$/.test(categoryId) || seen.has(categoryId)) {
      continue;
    }

    seen.add(categoryId);
    const textDecoded = decodeHtmlEntities(rawText.replace(/\\'/g, "'"));
    const counters = parseCategoryCounters(textDecoded);
    categoryTextById.set(categoryId, textDecoded);
    const categoryName = categoryDisplayName(textDecoded);
    const officialMatchesCount = computeOfficialCategoryMatchesCount(counters.registeredCount, {
      categoryName,
      eventStartDate: options?.eventStartDate ?? null,
      ratingMatchFormat: options?.ratingMatchFormat ?? null,
    });
    categories.push({
      categoryId,
      categoryName,
      valid: !ignoredCategoryIds.has(categoryId),
      registeredCount: counters.registeredCount,
      preRegisteredCount: counters.preRegisteredCount,
      totalListedCount: counters.totalListedCount,
      officialMatchesCount: officialMatchesCount > 0 ? officialMatchesCount : null,
    });
  }

  return { categories, categoryTextById };
}

function buildCommonCategoryFields(
  context: CategoryContext,
  categoryTextById: Map<string, string>,
): Record<string, string> {
  const callbackValue = String(context.categoryId);
  return {
    MainContent_MainContent_cmbCategoria_VI: callbackValue,
    "ctl00$ctl00$MainContent$MainContent$cmbCategoria": categoryTextById.get(context.categoryId) ?? callbackValue,
  };
}

function buildCardViewCategoryParam(categoryId: string, sequence: 0 | 1): string {
  return `c${sequence}:KV|2;[];GB|22;14|CUSTOMCALLBACK3|${categoryId};`;
}

export class LiveHttpCaptureService {
  private readonly dxRequestBuilder = new DXRequestBuilder();
  private static readonly MAX_HTTP_RETRIES = 3;
  private static readonly RETRY_DELAY_MS = 1500;

  async capture(eventId: number, options?: CaptureOptions): Promise<LiveHttpCaptureResult> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= LiveHttpCaptureService.MAX_HTTP_RETRIES; attempt += 1) {
      const requestContext = await request.newContext({
        extraHTTPHeaders: {
          "Accept-Encoding": process.env.SCRAPER_HTTP_ACCEPT_ENCODING ?? "gzip, deflate, br",
          "User-Agent": process.env.SCRAPER_USER_AGENT ?? DEFAULT_USER_AGENT,
        },
      });

      try {
        return await this.captureWithContext(requestContext, eventId, options);
      } catch (error) {
        lastError = error;
        const message = String(error ?? "");
        const retriable =
          message.includes("ENOTFOUND") ||
          message.includes("EAI_AGAIN") ||
          message.includes("ECONNRESET") ||
          message.includes("ETIMEDOUT");
        if (!retriable || attempt >= LiveHttpCaptureService.MAX_HTTP_RETRIES) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, LiveHttpCaptureService.RETRY_DELAY_MS));
      } finally {
        await requestContext.dispose();
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async captureWithContext(
    requestContext: APIRequestContext,
    eventId: number,
    options?: CaptureOptions,
  ): Promise<LiveHttpCaptureResult> {
    const eventUrl = config.scraperEventUrl.replace("{EVENT_ID}", String(eventId));
    const warnings: string[] = [];
    const responses: string[] = [];
    const seenRawBodies = new Set<string>();
    const responseCategoryByBody = new Map<string, string>();
    const tabsVisited = new Set<string>();
    const categoriesVisited = new Set<string>();
    const eliminationPayloads: EliminationPayload[] = [];
    let paginationRequests = 0;

    const snapshot = await this.loadInitialPage(requestContext, eventUrl, options);
    const validCategories = snapshot.categories.filter((item) => item.valid);
    const shouldCaptureInscricoes = options?.captureInscricoes ?? true;
    const shouldCaptureGrupos = options?.captureGrupos ?? true;
    const shouldCaptureResultados = options?.captureResultados ?? true;
    const shouldFetchEliminatoria = false;

    for (const category of validCategories) {
      const categoryContext: CategoryContext = {
        categoryId: category.categoryId,
        categoryName: category.categoryName,
      };
      categoriesVisited.add(category.categoryId);

      const commonCategoryFields = buildCommonCategoryFields(categoryContext, snapshot.categoryTextById);

      await this.postCallback({
        requestContext,
        eventUrl,
        hiddenFields: snapshot.hiddenFields,
        callbackId: CBINFO_CALLBACK_ID,
        callbackParam: `c0:${String(this.dxRequestBuilder.toCategoryValue(category.categoryId))}`,
        extraFields: commonCategoryFields,
        warnings,
        responses,
        seenRawBodies,
        responseCategoryByBody,
        categoryId: category.categoryId,
        captureResponse: false,
      });

      for (const tab of HTTP_TAB_CONFIG) {
        if (
          (tab.tabLabel === "INSCRICOES" && !shouldCaptureInscricoes) ||
          (tab.tabLabel === "GRUPOS" && !shouldCaptureGrupos) ||
          (tab.tabLabel === "RESULTADOS" && !shouldCaptureResultados)
        ) {
          continue;
        }

        tabsVisited.add(tab.tabLabel);

        if (tab.tabLabel === "RESULTADOS") {
          await this.postCallback({
            requestContext,
            eventUrl,
            hiddenFields: snapshot.hiddenFields,
            callbackId: RESULTS_PHASE_CALLBACK_ID,
            callbackParam: RESULTS_FILTER_REFRESH_PARAM,
            extraFields: commonCategoryFields,
            warnings,
            responses,
            seenRawBodies,
            responseCategoryByBody,
            categoryId: category.categoryId,
            captureResponse: false,
          });
          await this.postCallback({
            requestContext,
            eventUrl,
            hiddenFields: snapshot.hiddenFields,
            callbackId: RESULTS_ATHLETE_CALLBACK_ID,
            callbackParam: RESULTS_FILTER_REFRESH_PARAM,
            extraFields: commonCategoryFields,
            warnings,
            responses,
            seenRawBodies,
            responseCategoryByBody,
            categoryId: category.categoryId,
            captureResponse: false,
          });
        }

        const firstResponseText = await this.postCallback({
          requestContext,
          eventUrl,
          hiddenFields: snapshot.hiddenFields,
          callbackId: tab.callbackId,
          callbackParam: buildCardViewCategoryParam(category.categoryId, 0),
          extraFields: commonCategoryFields,
          warnings,
          responses,
          seenRawBodies,
          responseCategoryByBody,
          categoryId: category.categoryId,
          captureResponse: true,
        });

        await this.postCallback({
          requestContext,
          eventUrl,
          hiddenFields: snapshot.hiddenFields,
          callbackId: tab.callbackId,
          callbackParam: buildCardViewCategoryParam(category.categoryId, 1),
          extraFields: commonCategoryFields,
          warnings,
          responses,
          seenRawBodies,
          responseCategoryByBody,
          categoryId: category.categoryId,
          captureResponse: true,
        });

        if (!firstResponseText) {
          warnings.push(
            `Callback vazio para categoria ${category.categoryId} na aba ${tab.tabLabel}.`,
          );
          continue;
        }

        const payloads = extractDxPayloads(firstResponseText);
        const payloadForTab = payloads.find((payload) => payload.tab === tab.tabLabel) ?? payloads[0] ?? null;
        const pageCount = payloadForTab?.cardView.pageCount ?? 1;
        const safePageCount = Number.isFinite(pageCount) && pageCount > 1 ? pageCount : 1;

        for (let pageIndex = 1; pageIndex < safePageCount; pageIndex += 1) {
          paginationRequests += 1;
          await this.postCallback({
            requestContext,
            eventUrl,
            hiddenFields: snapshot.hiddenFields,
            callbackId: tab.callbackId,
            callbackParam: this.dxRequestBuilder.pagerCommand(pageIndex),
            extraFields: commonCategoryFields,
            warnings,
            responses,
            seenRawBodies,
            responseCategoryByBody,
            categoryId: category.categoryId,
            captureResponse: true,
          });
        }
      }

      if (shouldFetchEliminatoria) {
        // Hard-disabled: fase eliminatoria nao faz mais parte do scraping oficial.
      }
    }

    const payloads: DxPayload[] = [];
    const discoveredCategoryIds = new Set(snapshot.categories.map((item) => item.categoryId));
    const ignoredCategoryIds = new Set(config.scraperExcludedCategoryIds);
    const mismatchedCategoryIds = new Map<string, number>();
    for (const rawBody of responses) {
      const fallbackCategoryId = responseCategoryByBody.get(rawBody) ?? null;
      const extracted = extractDxPayloads(rawBody).map((payload) => {
        const payloadCategoryId = compactWhitespace(payload.categoryId ?? "");
        if (!fallbackCategoryId) {
          return payload;
        }
        const payloadCategoryIsValid =
          Boolean(payloadCategoryId) &&
          discoveredCategoryIds.has(payloadCategoryId) &&
          !ignoredCategoryIds.has(payloadCategoryId);

        // Categoria do request HTTP (callbackparam) e a fonte de verdade.
        // O payload DX pode retornar categoryId defasado mesmo quando "valido".
        if (payloadCategoryIsValid && payloadCategoryId !== fallbackCategoryId) {
          const mismatchKey = `${payload.tab}:${payloadCategoryId}->${fallbackCategoryId}`;
          mismatchedCategoryIds.set(mismatchKey, (mismatchedCategoryIds.get(mismatchKey) ?? 0) + 1);
        }
        return {
          ...payload,
          categoryId: fallbackCategoryId,
        };
      });
      payloads.push(...extracted);
    }

    if (mismatchedCategoryIds.size > 0) {
      const samples = [...mismatchedCategoryIds.entries()]
        .slice(0, 5)
        .map(([key, count]) => `${key} (${count}x)`)
        .join(", ");
      warnings.push(
        `Capture HTTP corrigiu categoryId inconsistente em ${mismatchedCategoryIds.size} combinacao(oes): ${samples}.`,
      );
    }

    return {
      payloads,
      rawBodies: responses,
      eliminationPayloads,
      warnings,
      categoriesDiscovered: snapshot.categories,
      categoriesVisited: [...categoriesVisited],
      tabsVisited: [...tabsVisited],
      paginationRequests,
    };
  }

  private async loadInitialPage(
    requestContext: APIRequestContext,
    eventUrl: string,
    options?: CaptureOptions,
  ): Promise<InitialPageSnapshot> {
    const response = await requestContext.get(eventUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: eventUrl,
      },
    });

    if (!response.ok()) {
      throw new Error(`GET inicial falhou: ${response.status()} ${response.statusText()}`);
    }

    const html = await response.text();
    const hiddenFields = parseHiddenInputs(html);
    const { categories, categoryTextById } = parseCategoriesFromHtml(
      html,
      new Set(config.scraperExcludedCategoryIds),
      options,
    );

    if (categories.length === 0) {
      throw new Error("Nenhuma categoria encontrada no HTML inicial.");
    }

    return {
      hiddenFields,
      categories,
      categoryTextById,
    };
  }

  private async postCallback(input: {
    requestContext: APIRequestContext;
    eventUrl: string;
    hiddenFields: Record<string, string>;
    callbackId: string;
    callbackParam: string;
    extraFields?: Record<string, string>;
    warnings: string[];
    responses: string[];
    seenRawBodies: Set<string>;
    responseCategoryByBody?: Map<string, string>;
    categoryId?: string;
    captureResponse: boolean;
  }): Promise<string | null> {
    const form: Record<string, string> = {
      ...input.hiddenFields,
      ...(input.extraFields ?? {}),
      __CALLBACKID: input.callbackId,
      __CALLBACKPARAM: input.callbackParam,
    };

    const response = await input.requestContext.post(input.eventUrl, {
      form,
      headers: {
        Accept: "*/*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://app.cbtm.org.br",
        Referer: input.eventUrl,
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (!response.ok()) {
      input.warnings.push(
        `POST callback falhou (${response.status()}) ${input.callbackId} param=${input.callbackParam}`,
      );
      return null;
    }

    const text = await response.text();
    if (text.includes("Invalid viewstate")) {
      input.warnings.push(
        `Resposta com Invalid viewstate em ${input.callbackId} param=${input.callbackParam}`,
      );
    }

    if (input.captureResponse && text.includes("/*DX*/") && !input.seenRawBodies.has(text)) {
      input.seenRawBodies.add(text);
      input.responses.push(text);
      if (input.responseCategoryByBody && input.categoryId) {
        input.responseCategoryByBody.set(text, input.categoryId);
      }
    }

    return text;
  }
}
