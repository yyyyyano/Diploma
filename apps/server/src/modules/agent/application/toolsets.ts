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

// Основы слов (нижний регистр, «е» вместо «ё»). Порядок наборов — приоритет при совпадении нескольких.
const WORDS: readonly (readonly [NonCoreToolset, RegExp])[] = [
  [
    "legal",
    /закон|стат(?:ья|ьи|ье|ью|ей)\b|ст\.\s*\d|кодекс|\bнк\b|\bгк\b|\bтк\b|налог|вычет|ндфл|подоходн|штраф|пенси|пособи|декрет|алимент|наследств|претензи|гаранти|возврат|верн\p{L}* товар|права потребител|трудов|увольн|отпускн|больничн|юридическ|правов|судит|суд\b|норм[аыу]\b|pravo|кто прав/u,
  ],
  [
    "planning",
    /лимит|копилк|накопить|накоплен|цел[ьиюе]\b|целей|бюджет|регулярн|подписк|ближайш\p{L}* платеж|календар|напомни|свободн\p{L}* остаток|хватит ли|можно ли купить|смогу ли купить|потяну|откуда (?:эта )?цифр|почему так(?:ая|ой)? сумм|создай счет|переименуй счет|удали счет|новый счет|счет[аов]?\b/u,
  ],
  ["reports", /excel|эксель|xlsx|отчет|выписк|импорт|распознан|чек[аие]?\b|фото чека/u],
];

// Страницы сайта (маршрут из PageContext): законы — право, бюджет и регулярные — планирование, документы — отчёты.
const PAGES: readonly (readonly [NonCoreToolset, RegExp])[] = [
  ["legal", /^\/laws(?:\/|$)/u],
  ["planning", /^\/(?:budget|recurring|accounts|calendar)(?:\/|$)/u],
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
