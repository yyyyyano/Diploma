// Начальное наполнение таблицы ставок (TAX-03): значения 2026 года из SPEC §9.1 и §9.3. Это умолчания кода — итог миграций `norm_rates`
// и источник тестов; код читает таблицу. `verified` — значение найдено в тексте нормы из сохранённой страницы pravo.by
// (`legal-base/__fixtures__/pravo-by/Hk0900071.html`): вычеты ст. 209 — страница от 30.10.2026, ставки ст. 214 и 381² — полный текст НК от
// 01.11.2026 (T-045); такое поставляется «подтверждено разработчиком» в день сверки (`verifiedOn`), калькулятор работает сразу.
// Остальное в сохранённых страницах отсутствует (взнос ФСЗН, сайт Нацбанка) — значение ждёт «Подтвердить» в админке: числа из памяти
// или SPEC без сверки с текстом нормы калькулятору не отдаются. `valid*` — календарный 2026 год, как в SPEC.
export interface SeedRate {
  readonly param: string;
  readonly value: number;
  /** Конец периода: календарный 2026 год; у параметров, чьё значение действует до смены нормы (срок гарантии), — null. */
  readonly validTo: string | null;
  readonly sourceAct: string | null;
  /** Ключ фрагмента `legal_fragments.path_key` (сам и вложенные): сверка LAW-33 ищет число в их текстах. */
  readonly sourcePath: string | null;
  readonly sourceArticle: string | null;
  readonly sourcePoint: string | null;
  /** Источник вне pravo.by (Нацбанк, §9.3). */
  readonly sourceUrl: string | null;
  readonly verified: boolean;
  /** День сверки с текстом нормы; у ждущих подтверждения — null. */
  readonly verifiedOn: string | null;
}

export const SEED_PERIOD = { from: "2026-01-01", to: "2026-12-31" } as const;
/** День сохранения страницы Закона № 90-З «О защите прав потребителей» (`H10200090.html`): по ней сверен срок гарантии (T-047). */
export const CONSUMER_LAW_VERIFIED_ON = "2026-10-30";
/** День сохранения страницы НК, по которой сверены вычеты ст. 209. */
export const SEED_VERIFIED_ON = "2026-10-30";
/** День, когда сохранён полный текст НК: по нему сверены ставки ст. 214 и 381² (T-045). */
export const NK_VERIFIED_ON = "2026-11-01";

const NK = "Hk0900071";
const CONSUMER_LAW = "H10200090";
const verified = (
  param: string,
  value: number,
  article: string,
  point: string,
  path: string,
  verifiedOn: string = SEED_VERIFIED_ON,
  act: string = NK,
  validTo: string | null = SEED_PERIOD.to,
): SeedRate => ({
  param,
  value,
  validTo,
  sourceAct: act,
  sourcePath: path,
  sourceArticle: article,
  sourcePoint: point,
  sourceUrl: null,
  verified: true,
  verifiedOn,
});
const unverified = (
  param: string,
  value: number,
  source: Partial<SeedRate> & Pick<SeedRate, "sourceArticle">,
): SeedRate => ({
  param,
  value,
  validTo: SEED_PERIOD.to,
  sourceAct: null,
  sourcePath: null,
  sourcePoint: null,
  sourceUrl: null,
  verified: false,
  verifiedOn: null,
  ...source,
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
  // Ставки подоходного налога (ст. 214 НК) и ИП (п. 3 той же статьи): сверены с полным текстом НК от 01.11.2026.
  verified("ndfl.rate.base", 1300, "214", "1.1", "a214/p1.1", NK_VERIFIED_ON),
  verified("ndfl.rate.high", 2500, "214", "1.2", "a214/p1.2", NK_VERIFIED_ON),
  verified("ndfl.rate.high-from", 35_000_000, "214", "1.2", "a214/p1.2", NK_VERIFIED_ON),
  verified("ndfl.rate.top", 3000, "214", "1.3", "a214/p1.3", NK_VERIFIED_ON),
  verified("ndfl.rate.top-from", 60_000_000, "214", "1.3", "a214/p1.3", NK_VERIFIED_ON),
  verified("ip.rate.base", 2000, "214", "3", "a214/p3", NK_VERIFIED_ON),
  verified("ip.rate.high", 3000, "214", "3", "a214/p3", NK_VERIFIED_ON),
  verified("ip.rate.high-from", 50_000_000, "214", "3", "a214/p3", NK_VERIFIED_ON),
  // НПД: ставки — ст. 381² НК (не ст. 380, как стояло в SPEC §9.1: ст. 380 — «Общие условия», ставок в ней нет).
  // Статья целиком — один фрагмент базы (`a381.2`): пункты в вёрстке pravo.by не размечены, сверка LAW-33 ищет число во всём тексте статьи.
  verified("npd.rate.base", 1000, "381²", "1", "a381.2", NK_VERIFIED_ON),
  verified("npd.rate.high", 2000, "381²", "1", "a381.2", NK_VERIFIED_ON),
  verified("npd.rate.high-from", 6_000_000, "381²", "1", "a381.2", NK_VERIFIED_ON),
  // Взнос работника в ФСЗН (TAX-04: «на руки / 0,86»): нормы о 1 % в сохранённых страницах нет — ждёт «Подтвердить».
  unverified("fszn.employee-rate", 100, { sourceArticle: "ФСЗН" }),
  // Пределы ПДН (SPEC §9.3): источник вне pravo.by.
  unverified("pdn.limit.default", 4000, { sourceArticle: "ПДН", sourceUrl: NBRB }),
  unverified("pdn.limit.domestic-goods", 5000, { sourceArticle: "ПДН", sourceUrl: NBRB }),
  // CAL-04: гарантийный срок по умолчанию — «в течение двух лет со дня передачи» (ст. 21, п. 1 Закона № 90-З), 24 месяца. Действует,
  // пока норма не изменится (конца периода нет): календарь берёт значение на дату покупки.
  verified(
    "warranty.default-months",
    24,
    "21",
    "1",
    "a21/p1",
    CONSUMER_LAW_VERIFIED_ON,
    CONSUMER_LAW,
    null,
  ),
];
