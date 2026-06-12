export function parseBool(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function numFromSheet(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
