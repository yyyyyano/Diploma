// Выбор набора инструментов запуска (ARCHITECTURE §8.2, AGT-03): правилами по странице и словам, без модели. Наборы
// фиксированы — префикс подсказки у каждого постоянен байт-в-байт (кэш провайдера). `legal` = core + legal, `planning` и
// `reports` — так же. Слова вопроса точнее страницы: на странице «Операции» вопрос про закон идёт в `legal`.
import type { Toolset } from "../../../platform/tools/define-tool.ts";

export type NonCoreToolset = Exclude<Toolset, "core">;

/** Почему выбран набор: в лог (ключ без текста вопроса) и для проверки правовых ответов. */
export type ToolsetReason = "words" | "page" | "default";

export interface ToolsetChoice {
  readonly toolset: Toolset;
  readonly reason: ToolsetReason;
}

// Границы слова — просмотр назад и вперёд, а не `\b`: в JS с флагом u `\b` видит только латиницу и на кириллице не срабатывает.
// Основы слов (нижний регистр, «е» вместо «ё»). Порядок наборов — приоритет при совпадении нескольких.
const WORDS: readonly (readonly [NonCoreToolset, RegExp])[] = [
  // CAL-06: напоминание и календарь — планирование раньше права («напомни заплатить налог» — событие, а не вопрос о законе).
  ["planning", /напомн|напомин|календар/u],
  [
    "legal",
    /закон|стат(?:ья|ьи|ье|ью|ей)(?![\p{L}\d])|ст\.\s*\d|кодекс|(?<![\p{L}\d])нк(?![\p{L}\d])|(?<![\p{L}\d])гк(?![\p{L}\d])|(?<![\p{L}\d])тк(?![\p{L}\d])|налог|вычет|ндфл|подоходн|штраф|пенси|пособи|декрет|алимент|наследств|претензи|гаранти|возврат|верн\p{L}* товар|верн[уё]т\p{L}*|обмен\p{L}*|продав(?:ец|ц)\p{L}*|надлежащ\p{L}* качеств|права потребител|трудов|увольн|отпускн|больничн|юридическ|правов|судит|суд(?![\p{L}\d])|норм[аыу](?![\p{L}\d])|pravo|кто прав/u,
  ],
  [
    "planning",
    /лимит|копилк|накопить|накоплен|цел[ьиюе](?![\p{L}\d])|целей|бюджет|регулярн|подписк|ближайш\p{L}* платеж|свободн\p{L}* остаток|хватит ли|можно ли купить|смогу ли купить|могу ли (?:я )?купить|позвол|безопасн\p{L}* платеж|(?<!\p{L})пдн(?!\p{L})|долгов\p{L}* нагрузк|потяну|откуда (?:эта )?цифр|почему так(?:ая|ой)? сумм|создай счет|переименуй счет|удали счет|новый счет|счет[аов]?(?![\p{L}\d])/u,
  ],
  ["reports", /excel|эксель|xlsx|отчет|выписк|импорт|распознан|чек[аие]?(?![\p{L}\d])|фото чека/u],
];

// Страницы сайта (маршрут из PageContext): законы и налоговые вычеты — право, бюджет, регулярные, календарь и «Могу ли я позволить покупку?» — планирование, документы — отчёты.
const PAGES: readonly (readonly [NonCoreToolset, RegExp])[] = [
  ["legal", /^\/(?:laws|deductions)(?:\/|$)/u],
  ["planning", /^\/(?:budget|recurring|accounts|calendar|afford)(?:\/|$)/u],
  ["reports", /^\/documents(?:\/|$)/u],
];

function normalize(text: string): string {
  return text.toLowerCase().replaceAll("ё", "е");
}

export function selectToolset(input: {
  readonly text: string;
  readonly route?: string | undefined;
}): ToolsetChoice {
  const text = normalize(input.text);
  for (const [toolset, pattern] of WORDS) {
    if (pattern.test(text)) return { toolset, reason: "words" };
  }
  if (input.route !== undefined) {
    for (const [toolset, pattern] of PAGES) {
      if (pattern.test(input.route)) return { toolset, reason: "page" };
    }
  }
  return { toolset: "core", reason: "default" };
}

/** Инструменты набора: общий `core` плюс свои. */
export function inToolset(toolOf: Toolset, chosen: Toolset): boolean {
  return toolOf === "core" || toolOf === chosen;
}
