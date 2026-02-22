function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth > 3) {
    return "[TRUNCATED_DEPTH]";
  }

  if (typeof value === "string") {
    const compact = value.length > 600 ? `${value.slice(0, 600)}...[truncated:${value.length}]` : value;
    if (compact.includes("@")) {
      return compact.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
    }
    if (/bearer\s+[a-z0-9._-]+/i.test(compact)) {
      return compact.replace(/bearer\s+[a-z0-9._-]+/gi, "bearer [REDACTED_TOKEN]");
    }
    return compact;
  }

  if (Array.isArray(value)) {
    if (value.length > 40) {
      return [
        ...value.slice(0, 40).map((entry) => sanitizeValue(entry, depth + 1)),
        `[TRUNCATED_ITEMS:${value.length - 40}]`,
      ];
    }
    return value.map((entry) => sanitizeValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const sanitized = entries.slice(0, 80).reduce<Record<string, unknown>>((acc, [key, entry]) => {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("password") ||
        lowerKey.includes("token") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("authorization") ||
        lowerKey.includes("cookie")
      ) {
        acc[key] = "[REDACTED]";
      } else {
        acc[key] = sanitizeValue(entry, depth + 1);
      }
      return acc;
    }, {});

    if (entries.length > 80) {
      sanitized.__truncated_keys = entries.length - 80;
    }
    return sanitized;
  }

  return value;
}

export function log(level: "info" | "warn" | "error", message: string, metadata: Record<string, unknown> = {}): void {
  const payload = sanitizeValue({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...metadata,
  }) as Record<string, unknown>;

  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}
