/**
 * Lecture Google Sheets (export CSV public) — même config que le frontend.
 */

import Papa from "papaparse";
import { envVar } from "./envVar.js";

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

function gidForViewerSettings(): string {
  return (
    envVar("VITE_SHEET_GID_VIEWER_SETTINGS", "SHEET_GID_VIEWER_SETTINGS") || "0"
  );
}

export function isSheetsReadConfigured(): boolean {
  return spreadsheetBaseUrl() != null;
}

function csvExportUrl(gid: string): string {
  const base = spreadsheetBaseUrl();
  if (!base) {
    throw new Error("Google Sheets non configuré (VITE_GOOGLE_SHEETS_URL_ENCODED)");
  }
  return `${base}/export?format=csv&gid=${gid}`;
}

/** GET — lit l'onglet viewer_settings entier. */
export async function loadViewerSettingsRows(): Promise<Record<string, string>[]> {
  const res = await fetch(csvExportUrl(gidForViewerSettings()), {
    headers: { Accept: "text/csv" },
  });
  if (!res.ok) {
    throw new Error(`Sheets GET viewer_settings failed: ${res.status}`);
  }
  const text = await res.text();
  if (text.trim().startsWith("<!DOCTYPE") || text.includes("accounts.google.com")) {
    throw new Error("Sheets GET : accès refusé — partagez le classeur en lecture publique.");
  }
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return parsed.data;
}
