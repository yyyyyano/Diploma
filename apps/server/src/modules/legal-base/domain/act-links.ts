// «Добавить акт по ссылке / списком» (LAW-16): из строк администратора — ID актов pravo.by. Принимается ссылка вида
// `https://pravo.by/document/?guid=3871&p0=H10200090` (LAW-03: только pravo.by) или сам ID; прочее — в ответ как не распознанное.
export const PRAVO_ID = /^[A-Za-z][A-Za-z0-9]{5,11}$/u;

const HOSTS = new Set(["pravo.by", "www.pravo.by"]);

/** ID акта из одной строки или null. */
export function pravoIdOfLine(line: string): string | null {
  const text = line.trim();
  if (PRAVO_ID.test(text)) return text;
  try {
    const url = new URL(text);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !HOSTS.has(url.hostname)) {
      return null;
    }
    const id = url.searchParams.get("p0");
    return id !== null && PRAVO_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export interface ParsedLinks {
  readonly ids: readonly string[];
  readonly rejected: readonly string[];
}

/** Строки → ID без повторов (в порядке появления) и строки, из которых ID не получен; пустые строки пропускаются. */
export function parseActLinks(lines: readonly string[]): ParsedLinks {
  const ids = new Set<string>();
  const rejected: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    const id = pravoIdOfLine(line);
    if (id === null) rejected.push(line.trim());
    else ids.add(id);
  }
  return { ids: [...ids], rejected };
}
