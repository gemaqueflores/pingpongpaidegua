type Dict = Record<string, number>;

export function inc(dict: Dict, key: string, count = 1): void {
  dict[key] = (dict[key] ?? 0) + count;
}

export function toSet(values: Array<number | string>): Set<string> {
  return new Set(values.map((value) => String(value)));
}

export function diffByKey<T>(input: {
  source: T[];
  target: T[];
  keyOf: (row: T) => string;
}): {
  missingInTarget: T[];
  extraInTarget: T[];
} {
  const sourceMap = new Map<string, T>();
  for (const row of input.source) {
    sourceMap.set(input.keyOf(row), row);
  }

  const targetMap = new Map<string, T>();
  for (const row of input.target) {
    targetMap.set(input.keyOf(row), row);
  }

  const missingInTarget: T[] = [];
  const extraInTarget: T[] = [];

  for (const [key, row] of sourceMap.entries()) {
    if (!targetMap.has(key)) {
      missingInTarget.push(row);
    }
  }

  for (const [key, row] of targetMap.entries()) {
    if (!sourceMap.has(key)) {
      extraInTarget.push(row);
    }
  }

  return { missingInTarget, extraInTarget };
}

