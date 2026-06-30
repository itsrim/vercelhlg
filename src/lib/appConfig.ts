/** Lecture de skipEmailVerification depuis app_config (Google Sheets). */

import { parseBool } from "./sheetCsv.js";
import { isSheetsReadConfigured, sheetGet } from "./googleSheets.js";

const CACHE_MS = 60_000;

let cachedSkip: boolean | null = null;
let cachedAt = 0;

function envSkip(): boolean {
  return process.env.SKIP_EMAIL_VERIFICATION?.trim().toLowerCase() === "true";
}

async function readSkipFromSheets(): Promise<boolean | null> {
  if (!isSheetsReadConfigured()) return null;
  try {
    const rows = await sheetGet<Record<string, string>>("app_config");
    const global = rows.find((r) => r.id === "global");
    if (!global) return null;
    return parseBool(global.skipEmailVerification);
  } catch (err) {
    console.warn("[appConfig] Sheets read error:", err);
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

  const fromSheets = await readSkipFromSheets();
  cachedSkip = fromSheets ?? false;
  cachedAt = now;
  return cachedSkip;
}
