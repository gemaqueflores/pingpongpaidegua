import { compactWhitespace } from "@cbtm/shared";

export interface CategoryContext {
  categoryId: string;
  categoryName: string;
  callbackState?: string | null;
  selection?: string | null;
  keys?: string[];
}

export class DXRequestBuilder {
  toCategoryValue(categoryId: string): string | number {
    const normalized = compactWhitespace(categoryId);
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : normalized;
  }

  pagerCommand(pageIndex: number): string {
    return `PAGERONCLICK|PN${Math.max(1, pageIndex + 1)}`;
  }
}
