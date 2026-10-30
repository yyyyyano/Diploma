// Темы «Кошта» (LAW-01: 10 областей) и словари определения темы без модели (LAW-13, LAW-14): рубрики Единого правового
// классификатора (ЕПК) → тема, орган, принявший акт → тема, слова заголовка → тема. Таблицы — умолчания: админка хранит свои
// копии в настройках (`legal-base.epk-topics`, T-039), код их только применяет.
export const TOPICS = [
  "taxes",
  "consumer",
  "housing",
  "banking",
  "work",
  "benefits",
  "contracts",
  "education-health",
  "family",
  "fines",
] as const;
export type Topic = (typeof TOPICS)[number];

export function isTopic(value: string): value is Topic {
  return (TOPICS as readonly string[]).includes(value);
}

/**
 * «Рубрика ЕПК (префикс) → тема» по таблице из research/legal-corpus-strategy.md §1.3. Рубрика 02.09 («обязательственное
 * право») в ресерче стояла и у банков, и у договоров, «уточнить» — здесь она отнесена к договорам: кредитные акты нужных
 * рубрик (03.04, 03.03.02) попадают к банкам сами.
 */
export const DEFAULT_EPK_TOPICS: Readonly<Record<string, Topic>> = {
  "03.02": "taxes",
  "04.01.14": "consumer",
  "07": "housing",
  "04.07.02": "housing",
  "03.04": "banking",
  "03.03.02": "banking",
  "05": "work",
  "08.02": "benefits",
  "08.03": "benefits",
  "08.04": "benefits",
  "08.05": "benefits",
  "02.06": "contracts",
  "02.09": "contracts",
  "03.05": "contracts",
  "10.01": "education-health",
  "09.02": "education-health",
  "06": "family",
  "02.11": "family",
  "13.01": "fines",
  "13.02": "fines",
};

/** Тема по рубрикам акта (LAW-14): самое длинное совпадение префикса по границе сегмента; ни одна не подошла — null. */
export function topicOfRubrics(
  codes: readonly string[],
  table: Readonly<Record<string, Topic>>,
): Topic | null {
  let best: { length: number; topic: Topic } | null = null;
  for (const code of codes) {
    for (const [prefix, topic] of Object.entries(table)) {
      const hit = code === prefix || code.startsWith(`${prefix}.`);
      if (hit && (best === null || prefix.length > best.length)) {
        best = { length: prefix.length, topic };
      }
    }
  }
  return best?.topic ?? null;
}

/** «Свои» органы (LAW-13 п. 5) с темой, к которой они относятся; порядок — от узких к общим. */
const ORGANS: readonly (readonly [RegExp, Topic])[] = [
  [/министерств\p{L}*\s+по\s+налогам\s+и\s+сборам/iu, "taxes"],
  [/министерств\p{L}*\s+финансов/iu, "taxes"],
  [/национальн\p{L}*\s+банк/iu, "banking"],
  [/антимонопольного\s+регулирования\s+и\s+торговли/iu, "consumer"],
  [/министерств\p{L}*\s+труда\s+и\s+социальной\s+защиты/iu, "work"],
  [/министерств\p{L}*\s+здравоохранения/iu, "education-health"],
  [/министерств\p{L}*\s+образования/iu, "education-health"],
  [/министерств\p{L}*\s+жилищно-коммунального\s+хозяйства/iu, "housing"],
  [/министерств\p{L}*\s+внутренних\s+дел/iu, "fines"],
  [/министерств\p{L}*\s+транспорта\s+и\s+коммуникаций/iu, "contracts"],
];

/** Тема по органу в строке «Постановление Министерства … от … № …»; орган не «свой» — null. */
export function topicOfOrgan(kindLine: string): Topic | null {
  return ORGANS.find(([re]) => re.test(kindLine))?.[1] ?? null;
}

const TITLE_WORDS: readonly (readonly [RegExp, Topic])[] = [
  [/налог|сбор(?:ах|ов|ы)?\b/iu, "taxes"],
  [/потребител|защит\p{L}*\s+прав/iu, "consumer"],
  [/жиль[еяю]|жилищн|жилых|коммунальн/iu, "housing"],
  [/банк|кредит|вклад|депозит|платежн/iu, "banking"],
  [/заработн|трудов|занятост|отпуск/iu, "work"],
  [/пособи|пенси|семейн\p{L}*\s+капитал|социальн\p{L}*\s+(?:защит|поддержк)|льгот/iu, "benefits"],
  [/страхов|договор|транспортн|автомобил/iu, "contracts"],
  [/образован|медицинск|здравоохран|платных\s+услуг/iu, "education-health"],
  [/алимент|брак|семь[яеи]|наследств/iu, "family"],
  [/административн\p{L}*\s+правонарушен|штраф/iu, "fines"],
];

/** Тема по словам заголовка (LAW-17: «по органу и заголовку»); слов нужной темы нет — null. */
export function topicOfTitle(title: string): Topic | null {
  return TITLE_WORDS.find(([re]) => re.test(title))?.[1] ?? null;
}
