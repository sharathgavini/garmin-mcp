// Small UTC date helpers shared by MCP tools and tests.
const DAY_MS = 24 * 60 * 60 * 1000;

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysAgoIso(days: number, from = new Date()): string {
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function inclusiveDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.floor((end - start) / DAY_MS) + 1;
}

export function filterByDateRange<T extends { date?: unknown }>(
  rows: T[],
  startDate: string,
  endDate: string
): T[] {
  return rows.filter((row) => {
    if (typeof row.date !== "string") {
      return false;
    }
    return row.date >= startDate && row.date <= endDate;
  });
}

export function latestByDate<T extends { date?: unknown }>(rows: T[]): T | undefined {
  return [...rows]
    .filter((row) => typeof row.date === "string")
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
}
