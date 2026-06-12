/** Lecture de skipEmailVerification depuis app_config (CSV Google Sheet). */

const CACHE_MS = 60_000;

let cachedSkip: boolean | null = null;
let cachedAt = 0;

function envSkip(): boolean {
  return process.env.SKIP_EMAIL_VERIFICATION?.trim().toLowerCase() === "true";
}

function parseBool(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function parseCsvRows(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = (values[i] ?? "").trim();
    });
    return row;
  });
}

async function readSkipFromCsvUrl(): Promise<boolean | null> {
  const url = process.env.APP_CONFIG_CSV_URL?.trim();
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { Accept: "text/csv" } });
    if (!res.ok) {
      console.warn("[appConfig] CSV fetch failed:", res.status);
      return null;
    }
    const text = await res.text();
    const global = parseCsvRows(text).find((r) => r.id === "global");
    if (!global) return null;
    return parseBool(global.skipEmailVerification);
  } catch (err) {
    console.warn("[appConfig] CSV read error:", err);
    return null;
  }
}

/** true = nouveaux comptes validés sans email de vérification. */
export async function shouldSkipEmailVerification(): Promise<boolean> {
  if (envSkip()) return true;

  const now = Date.now();
  if (cachedSkip != null && now - cachedAt < CACHE_MS) {
    return cachedSkip;
  }

  const fromCsv = await readSkipFromCsvUrl();
  cachedSkip = fromCsv ?? false;
  cachedAt = now;
  return cachedSkip;
}
