// Начальное наполнение таблицы ставок (TAX-03): значения 2026 года из SPEC §9.1 и §9.3. Это умолчания кода — источник миграции
// `norm_rates` и тестов; код читает таблицу. `verified` — значение найдено в тексте нормы из сохранённой страницы pravo.by (30.10.2026,
// `legal-base/__fixtures__/pravo-by/Hk0900071.html`): такое поставляется «подтверждено разработчиком», калькулятор работает сразу.
// Остальное в сохранённых страницах отсутствует (ст. 214, 380 НК; сайт Нацбанка) — значение ждёт «Подтвердить» в админке: числа из
// памяти или SPEC без сверки с текстом нормы калькулятору не отдаются. `valid*` — календарный 2026 год, как в SPEC.
export interface SeedRate {
  readonly param: string;
  readonly value: number;
  readonly sourceAct: string | null;
  /** Ключ фрагмента `legal_fragments.path_key` (сам и вложенные): сверка LAW-33 ищет число в их текстах. */
  readonly sourcePath: string | null;
  readonly sourceArticle: string | null;
  readonly sourcePoint: string | null;
  /** Источник вне pravo.by (Нацбанк, §9.3). */
  readonly sourceUrl: string | null;
  readonly verified: boolean;
}

export const SEED_PERIOD = { from: "2026-01-01", to: "2026-12-31" } as const;
/** День сохранения страницы НК, по которой сверены значения. */
export const SEED_VERIFIED_ON = "2026-10-30";

const NK = "Hk0900071";
const verified = (
  param: string,
  value: number,
  article: string,
  point: string,
  path: string,
): SeedRate => ({
  param,
  value,
  sourceAct: NK,
  sourcePath: path,
  sourceArticle: article,
  sourcePoint: point,
  sourceUrl: null,
  verified: true,
});
const unverified = (
  param: string,
  value: number,
  source: Partial<SeedRate> & Pick<SeedRate, "sourceArticle">,
): SeedRate => ({
  param,
  value,
  sourceAct: null,
  sourcePath: null,
  sourcePoint: null,
  sourceUrl: null,
  verified: false,
  ...source,
});
const nk = (article: string): Partial<SeedRate> & Pick<SeedRate, "sourceArticle"> => ({
  sourceAct: NK,
  sourceArticle: article,
  sourcePath: `a${article}`,
});
const NBRB =
  "https://www.nbrb.by/finsector/financialstability/macroprudentialregulation/instrumenty-ogranicheniya-dolgovoj-nagruzki-naseleniya";

export const SEED_RATES: readonly SeedRate[] = [
  // Ст. 209 НК, подпункты 1.1–1.4: сверены с текстом (BYN в месяц → копейки).
  verified("ndfl.std-deduction.base", 21_600, "209", "1.1", "a209/p1.1"),
  verified("ndfl.std-deduction.base-income-limit", 130_800, "209", "1.1", "a209/p1.1"),
  verified("ndfl.std-deduction.child", 6300, "209", "1.2", "a209/p1.2"),
  verified("ndfl.std-deduction.child-increased", 12_000, "209", "1.2", "a209/p1.2"),
  verified("ndfl.std-deduction.disabled", 30_600, "209", "1.3", "a209/p1.3"),
  verified("ndfl.std-deduction.young-specialist", 86_000, "209", "1.4", "a209/p1.4"),
  // Ставки подоходного налога (ст. 214), ИП и НПД (гл. 40): статей нет в сохранённых страницах — ждут подтверждения.
  unverified("ndfl.rate.base", 1300, nk("214")),
  unverified("ndfl.rate.high", 2500, nk("214")),
  unverified("ndfl.rate.high-from", 35_000_000, nk("214")),
  unverified("ndfl.rate.top", 3000, nk("214")),
  unverified("ndfl.rate.top-from", 60_000_000, nk("214")),
  unverified("ip.rate.base", 2000, nk("214")),
  unverified("ip.rate.high", 3000, nk("214")),
  unverified("ip.rate.high-from", 50_000_000, nk("214")),
  unverified("npd.rate.base", 1000, nk("380")),
  unverified("npd.rate.high", 2000, nk("380")),
  unverified("npd.rate.high-from", 6_000_000, nk("380")),
  // Пределы ПДН (SPEC §9.3): источник вне pravo.by.
  unverified("pdn.limit.default", 4000, { sourceArticle: "ПДН", sourceUrl: NBRB }),
  unverified("pdn.limit.domestic-goods", 5000, { sourceArticle: "ПДН", sourceUrl: NBRB }),
];
