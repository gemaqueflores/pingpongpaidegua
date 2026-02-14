export type BrazilRegion =
  | "Regiao Norte"
  | "Regiao Nordeste"
  | "Regiao Centro-Oeste"
  | "Regiao Sudeste"
  | "Regiao Sul";

export interface BrazilStateInfo {
  code: string;
  name: string;
  region: BrazilRegion;
}

export type BrazilStateInferenceSource = "suffix" | "club_exception";

const BRAZIL_STATES_LIST: BrazilStateInfo[] = [
  { code: "AC", name: "Acre", region: "Regiao Norte" },
  { code: "AL", name: "Alagoas", region: "Regiao Nordeste" },
  { code: "AP", name: "Amapa", region: "Regiao Norte" },
  { code: "AM", name: "Amazonas", region: "Regiao Norte" },
  { code: "BA", name: "Bahia", region: "Regiao Nordeste" },
  { code: "CE", name: "Ceara", region: "Regiao Nordeste" },
  { code: "DF", name: "Distrito Federal", region: "Regiao Centro-Oeste" },
  { code: "ES", name: "Espirito Santo", region: "Regiao Sudeste" },
  { code: "GO", name: "Goias", region: "Regiao Centro-Oeste" },
  { code: "MA", name: "Maranhao", region: "Regiao Nordeste" },
  { code: "MT", name: "Mato Grosso", region: "Regiao Centro-Oeste" },
  { code: "MS", name: "Mato Grosso do Sul", region: "Regiao Centro-Oeste" },
  { code: "MG", name: "Minas Gerais", region: "Regiao Sudeste" },
  { code: "PA", name: "Para", region: "Regiao Norte" },
  { code: "PB", name: "Paraiba", region: "Regiao Nordeste" },
  { code: "PR", name: "Parana", region: "Regiao Sul" },
  { code: "PE", name: "Pernambuco", region: "Regiao Nordeste" },
  { code: "PI", name: "Piaui", region: "Regiao Nordeste" },
  { code: "RJ", name: "Rio de Janeiro", region: "Regiao Sudeste" },
  { code: "RN", name: "Rio Grande do Norte", region: "Regiao Nordeste" },
  { code: "RS", name: "Rio Grande do Sul", region: "Regiao Sul" },
  { code: "RO", name: "Rondonia", region: "Regiao Norte" },
  { code: "RR", name: "Roraima", region: "Regiao Norte" },
  { code: "SC", name: "Santa Catarina", region: "Regiao Sul" },
  { code: "SP", name: "Sao Paulo", region: "Regiao Sudeste" },
  { code: "SE", name: "Sergipe", region: "Regiao Nordeste" },
  { code: "TO", name: "Tocantins", region: "Regiao Norte" },
];

export const BRAZIL_STATES_BY_CODE: Record<string, BrazilStateInfo> = Object.fromEntries(
  BRAZIL_STATES_LIST.map((item) => [item.code, item]),
) as Record<string, BrazilStateInfo>;

function normalizeClubKey(value: string | null | undefined): string {
  return compactWhitespace(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CLUB_STATE_EXCEPTIONS: Record<string, string> = {
  "associacao paraense de tenis de mesa aptm": "PA",
};

export function parseBrazilStateCodeFromClubName(clubName: string | null | undefined): string | null {
  return inferBrazilStateFromClubNameDetailed(clubName)?.state.code ?? null;
}

export function inferBrazilStateFromClubNameDetailed(
  clubName: string | null | undefined,
): { state: BrazilStateInfo; source: BrazilStateInferenceSource } | null {
  const raw = compactWhitespace(clubName ?? "");
  if (!raw) {
    return null;
  }

  const normalizedDashes = raw.replace(/[\u2013\u2014\u2212]/g, "-");
  const match = normalizedDashes.match(/-\s*([A-Za-z]{2})\s*$/);
  if (match?.[1]) {
    const code = match[1].toUpperCase();
    const state = BRAZIL_STATES_BY_CODE[code];
    if (state) {
      return {
        state,
        source: "suffix",
      };
    }
  }

  const exceptionCode = CLUB_STATE_EXCEPTIONS[normalizeClubKey(raw)] ?? null;
  if (exceptionCode && BRAZIL_STATES_BY_CODE[exceptionCode]) {
    return {
      state: BRAZIL_STATES_BY_CODE[exceptionCode],
      source: "club_exception",
    };
  }

  return null;
}

export function inferBrazilStateFromClubName(clubName: string | null | undefined): BrazilStateInfo | null {
  return inferBrazilStateFromClubNameDetailed(clubName)?.state ?? null;
}
function compactWhitespace(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
