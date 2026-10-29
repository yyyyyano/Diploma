// Метки маскирования (PRIV-03): в облако уходит `[ИМЯ_1]`, `[СЧЁТ_1]`…; номер — по порядку первого появления значения в
// вызове. Суммы, даты, магазины и категории не маскируются: без них ассистент бесполезен.

export const MASK_KINDS = [
  "name",
  "iban",
  "card",
  "phone",
  "email",
  "passport",
  "address",
] as const;
export type MaskKind = (typeof MASK_KINDS)[number];

/** Приставка метки по виду данных. */
export const LABEL_PREFIX: Readonly<Record<MaskKind, string>> = {
  name: "ИМЯ",
  iban: "СЧЁТ",
  card: "КАРТА",
  phone: "ТЕЛЕФОН",
  email: "EMAIL",
  passport: "ПАСПОРТ",
  address: "АДРЕС",
};

export const label = (kind: MaskKind, index: number): string =>
  `[${LABEL_PREFIX[kind]}_${String(index)}]`;

const PREFIXES = Object.values(LABEL_PREFIX).join("|");

/** Любая метка маскирования; модель вернула её в ответе — маскировщик подставляет исходное значение. */
export const LABEL_PATTERN = new RegExp(`\\[(?:${PREFIXES})_\\d+\\]`, "gu");

/** Самая длинная возможная метка: `[ТЕЛЕФОН_` + 6 цифр + `]` — столько буфер потока держит «недописанную» метку. */
export const MAX_LABEL_LENGTH = 16;
