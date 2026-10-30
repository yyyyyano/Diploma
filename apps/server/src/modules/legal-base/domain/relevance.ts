// Дешёвые фильтры релевантности без модели (LAW-13): раздел реестра и префикс ID (местные акты), шаблоны заголовков
// (кадровые, наградные, разовые, территориальные), изменяющие акты (LAW-12: не запись каталога, а событие). Причина каждого
// отсева — короткий код: он идёт в журнал обновлений.
export const DEFAULT_TITLE_PATTERNS: readonly string[] = [
  "^О назначении",
  "^Об освобождении",
  "^О присвоении",
  "^О награждении",
  "^О помиловании",
  // «О Сурове В.А.»: персональный акт.
  "^О [А-ЯЁ][а-яё-]+ [А-ЯЁ]\\.\\s?[А-ЯЁ]\\.?$",
  "^Об изменении границ",
  "^О предоставлении полномочий",
  "^О делегировании полномочий",
  "^О выделении",
  "^О создании (?:\\p{L}+ ){0,2}(?:учреждени|предприяти|комисси|совет)",
];

/** Изменяющий акт по заголовку: «Об изменении …», «О внесении изменений …», «О признании утратившими силу …». */
const AMENDING = /^Об?\s+(?:внесении\s+)?(?:изменени|дополнени)|^О\s+признании\s+утратив/u;

export function isAmendingTitle(title: string): boolean {
  return AMENDING.test(title.trim());
}

/** ID местных актов: решения Советов депутатов (`D9…`) и исполкомов (`R9…`). */
const LOCAL_ID = /^[DR]9/u;

/** Раздел Национального реестра из «17-1/148285»: 15–18 — местные Советы и исполкомы. */
export function registrySection(registryNo: string | null): number | null {
  const m = /^(\d{1,2})-/u.exec(registryNo ?? "");
  return m === null ? null : Number(m[1]);
}

export type DropReason = "local" | "amending" | "title-pattern";

export interface PrefilterInput {
  readonly pravoId: string;
  readonly title: string;
  readonly registryNo: string | null;
}

export interface Prefilter {
  readonly reason: DropReason;
  /** Для `title-pattern` — какой шаблон сработал (в журнал, без текста страниц). */
  readonly pattern?: string;
}

/** Первый сработавший фильтр до любых запросов; ни один — null. Шаблоны — строки (редактируются в админке, T-039). */
export function prefilter(input: PrefilterInput, patterns: readonly string[]): Prefilter | null {
  const section = registrySection(input.registryNo);
  if (LOCAL_ID.test(input.pravoId) || (section !== null && section >= 15)) {
    return { reason: "local" };
  }
  for (const source of patterns) {
    let re: RegExp;
    try {
      re = new RegExp(source, "u");
    } catch {
      // Шаблон из админки с ошибкой не должен ронять проход: он просто не действует.
      continue;
    }
    if (re.test(input.title.trim())) return { reason: "title-pattern", pattern: source };
  }
  // Шаблоны раньше изменяющих: «Об изменении границ …» — территориальный акт, а не поправка к акту.
  if (isAmendingTitle(input.title)) return { reason: "amending" };
  return null;
}
