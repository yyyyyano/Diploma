// Источник значения (TAX-03): акт, статья, пункт — ключ фрагмента `a209/p1.2` строится из статьи и пункта по правилам ADR-0007
// (надстрочные номера — через точку: «216¹» → `216.1`).
export function pathKeyOf(article: string | null, point: string | null): string | null {
  if (article === null || article === "") return null;
  const no = normalizeNumber(article);
  if (no === null) return null;
  if (point === null || point === "") return `a${no}`;
  const p = normalizeNumber(point);
  return p === null ? null : `a${no}/p${p}`;
}

const SUPERSCRIPT: Readonly<Record<string, string>> = { "¹": "1", "²": "2", "³": "3" };

/** «216¹» и «216.1» → «216.1»; «1.2» → «1.2»; не номер — null. */
export function normalizeNumber(text: string): string | null {
  const trimmed = text.trim().replaceAll(/[¹²³]/gu, (m) => `.${SUPERSCRIPT[m] ?? ""}`);
  return /^\d{1,4}(?:\.\d{1,3})*$/u.test(trimmed) ? trimmed : null;
}
