export function parseBool(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function parseCsvRows(text: string): Record<string, string>[] {
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

export async function fetchCsvRows(url: string): Promise<Record<string, string>[]> {
  const res = await fetch(url, { headers: { Accept: "text/csv" } });
  if (!res.ok) {
    throw new Error(`CSV fetch failed: ${res.status}`);
  }
  const text = await res.text();
  return parseCsvRows(text);
}
