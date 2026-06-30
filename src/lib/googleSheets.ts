/**
 * Client Google Sheets — même API que le frontend (`src/lib/googleSheetsDb.ts`).
 * Lit/écrit via export CSV + Apps Script (GET ?action=post|put).
 * Variables : mêmes noms que le .env racine (VITE_GOOGLE_SHEETS_*).
 */

import Papa from "papaparse";
import { envVar } from "./envVar.js";
import { parseCsvRows } from "./sheetCsv.js";

export type SheetTableName =
  | "messages"
  | "viewer_settings"
  | "app_config"
  | "push_subscriptions";

interface SheetTableConfig {
  sheetName: string;
  gidKeys: string[];
  idColumn: string;
}

const TABLES: Record<SheetTableName, SheetTableConfig> = {
  messages: {
    sheetName: "messages",
    gidKeys: ["VITE_SHEET_GID_MESSAGES", "SHEET_GID_MESSAGES"],
    idColumn: "id",
  },
  viewer_settings: {
    sheetName: "viewer_settings",
    gidKeys: ["VITE_SHEET_GID_VIEWER_SETTINGS", "SHEET_GID_VIEWER_SETTINGS"],
    idColumn: "id",
  },
  app_config: {
    sheetName: "app_config",
    gidKeys: ["VITE_SHEET_GID_APP_CONFIG", "SHEET_GID_APP_CONFIG"],
    idColumn: "id",
  },
  push_subscriptions: {
    sheetName: "push_subscriptions",
    gidKeys: ["VITE_SHEET_GID_PUSH_SUBSCRIPTIONS", "SHEET_GID_PUSH_SUBSCRIPTIONS"],
    idColumn: "id",
  },
};

function gidFor(table: SheetTableName): string {
  const keys = TABLES[table].gidKeys;
  const value = envVar(...keys);
  return value || "0";
}

function simpleDecrypt(encoded: string): string {
  return encoded
    .split("")
    .map((char) => String.fromCharCode(char.charCodeAt(0) - 1))
    .join("");
}

function spreadsheetBaseUrl(): string | null {
  const id = envVar("GOOGLE_SHEETS_SPREADSHEET_ID");
  if (id) return `https://docs.google.com/spreadsheets/d/${id}`;

  const encoded = envVar(
    "VITE_GOOGLE_SHEETS_URL_ENCODED",
    "GOOGLE_SHEETS_URL_ENCODED",
  );
  if (!encoded) return null;
  const decoded = simpleDecrypt(encoded);
  return decoded.replace(/\/edit(\?.*)?$/i, "");
}

export function isSheetsReadConfigured(): boolean {
  return spreadsheetBaseUrl() != null;
}

export function isSheetsWriteConfigured(): boolean {
  return (
    isSheetsReadConfigured() &&
    envVar("VITE_GOOGLE_SHEETS_API_URL", "GOOGLE_SHEETS_API_URL").length > 0
  );
}

function csvExportUrl(table: SheetTableName): string {
  const base = spreadsheetBaseUrl();
  if (!base) {
    throw new Error(
      "Google Sheets non configuré — définir VITE_GOOGLE_SHEETS_URL_ENCODED dans le .env racine",
    );
  }
  return `${base}/export?format=csv&gid=${gidFor(table)}`;
}

function parseCsvToRows<T extends Record<string, string>>(csvData: string): T[] {
  const parsed = Papa.parse<T>(csvData, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    console.warn("[sheets] PapaParse warnings:", parsed.errors.slice(0, 3));
  }
  return parsed.data;
}

/** GET — lit un onglet entier (export CSV public du Sheet). */
export async function sheetGet<T extends Record<string, string>>(
  table: SheetTableName,
): Promise<T[]> {
  const res = await fetch(csvExportUrl(table), {
    headers: { Accept: "text/csv" },
  });
  if (!res.ok) {
    throw new Error(`Sheets GET [${table}] failed: ${res.status}`);
  }
  const text = await res.text();
  if (text.trim().startsWith("<!DOCTYPE") || text.includes("accounts.google.com")) {
    throw new Error(
      "Sheets GET : accès refusé. Partagez le classeur en lecture publique.",
    );
  }
  return parseCsvToRows<T>(text);
}

const MAX_URL_LEN = 7500;

async function sheetMutate(
  action: "post" | "put",
  table: SheetTableName,
  payload: Record<string, unknown>,
): Promise<{ ok?: boolean; skipped?: boolean; error?: string }> {
  const apiUrl = envVar("VITE_GOOGLE_SHEETS_API_URL", "GOOGLE_SHEETS_API_URL");
  if (!apiUrl) {
    throw new Error("VITE_GOOGLE_SHEETS_API_URL non configuré (Apps Script)");
  }

  const cfg = TABLES[table];
  const params = new URLSearchParams();
  params.set("action", action);
  params.set("sheet", cfg.sheetName);
  params.set("idColumn", cfg.idColumn);
  if (action === "put" && payload.id != null) {
    params.set("id", String(payload.id));
  }
  if (payload.row != null) {
    params.set("row", JSON.stringify(payload.row));
  }

  const url = `${apiUrl}?${params.toString()}`;
  if (url.length > MAX_URL_LEN) {
    throw new Error(`Sheets ${action} : ligne trop volumineuse (${url.length} car.)`);
  }

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const bodyText = await res.text();

  if (res.redirected && bodyText.includes("accounts.google.com")) {
    throw new Error("Apps Script : déployez avec « Qui a accès : Tout le monde ».");
  }
  if (!res.ok) {
    throw new Error(`Sheets ${action} failed: ${res.status}`);
  }

  let result: { ok?: boolean; skipped?: boolean; error?: string };
  try {
    result = JSON.parse(bodyText) as typeof result;
  } catch {
    throw new Error(`Sheets ${action} : réponse non JSON`);
  }
  if (result.error) throw new Error(result.error);
  if (result.ok === false) throw new Error(`Sheets ${action} rejected`);
  return result;
}

/** POST — même API Apps Script que le frontend. */
export async function sheetPost(
  table: SheetTableName,
  row: Record<string, string>,
): Promise<{ ok?: boolean; skipped?: boolean }> {
  return sheetMutate("post", table, { row });
}

/** PUT — met à jour une ligne existante par id. */
export async function sheetPut(
  table: SheetTableName,
  id: string,
  row: Record<string, string>,
): Promise<void> {
  await sheetMutate("put", table, { id, row });
}

export { parseCsvRows };
