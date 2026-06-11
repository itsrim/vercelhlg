const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://happyletsgo.fr",
  "https://www.happyletsgo.fr",
];

export function allowedOrigins(): string[] {
  const extra =
    process.env.ALLOWED_ORIGINS?.split(",")
      .map((o) => o.trim())
      .filter(Boolean) ?? [];
  return [...DEFAULT_ORIGINS, ...extra];
}

export function port(): number {
  const n = Number(process.env.PORT ?? 3000);
  return Number.isFinite(n) && n > 0 ? n : 3000;
}
