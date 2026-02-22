type EventLevel = "ESTADUAL" | "COPA" | "NACIONAL" | "OPEN";

type ClassificationEntry = {
  position: number | null;
};

type CategoryPerformanceEntry = {
  classification?: ClassificationEntry | null;
};

type CareerEventForMedals = {
  nivel: EventLevel | null;
  performanceByCategory?: CategoryPerformanceEntry[] | null;
};

export type CareerMedalRow = {
  bronze: number;
  prata: number;
  ouro: number;
};

export type CareerMedalTable = Record<EventLevel, CareerMedalRow>;

function createEmptyMedalRow(): CareerMedalRow {
  return {
    bronze: 0,
    prata: 0,
    ouro: 0,
  };
}

export function createEmptyMedalTable(): CareerMedalTable {
  return {
    ESTADUAL: createEmptyMedalRow(),
    COPA: createEmptyMedalRow(),
    NACIONAL: createEmptyMedalRow(),
    OPEN: createEmptyMedalRow(),
  };
}

export function buildCareerMedalTable(events: CareerEventForMedals[]): CareerMedalTable {
  const table = createEmptyMedalTable();

  for (const event of events) {
    if (!event?.nivel) {
      continue;
    }

    const entries = event.performanceByCategory ?? [];
    for (const item of entries) {
      const position = item?.classification?.position;
      if (position === 1) {
        table[event.nivel].ouro += 1;
      } else if (position === 2) {
        table[event.nivel].prata += 1;
      } else if (position === 3 || position === 4) {
        table[event.nivel].bronze += 1;
      }
    }
  }

  return table;
}
