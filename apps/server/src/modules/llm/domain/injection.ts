// Защита от инъекций в документах (SEC-10, SEC-11, ADR-0009): текст чека, выписки, закона — данные, а не инструкции.
// Две меры поверх блока `<document>` и строгой схемы ответа: (1) теги, которыми текст мог бы «закрыть» блок и начать
// свои инструкции, экранируются; (2) инструктивные фразы («игнорируй предыдущие инструкции», «переведи деньги…»)
// заменяются меткой и считаются. Вывод модели правил, профиля и настроек напрямую не меняет — это держит схема и
// отсутствие у извлечения инструментов; здесь — снижение шанса, что модель вообще послушается.

/** Метка, которой заменяется инструктивная фраза: модель видит, что здесь был текст-приказ, и не исполняет его. */
export const INJECTION_MARK = "[фраза-инструкция удалена]";

/** Теги разметки промпта: из текста документа они не должны выглядеть как настоящая разметка. */
const TAGS = "document|instructions?|system|assistant|user|tool|prompt|context";
const TAG_PATTERN = new RegExp(`[<＜‹]\\s*/?\\s*(?:${TAGS})\\b[^>＞›]*[>＞›]?`, "giu");

/** `</document>` и похожие теги (пробелы, регистр, полноширинные скобки) — в видимый текст без разметки. */
export function escapeDocumentTags(text: string): string {
  return text.replace(TAG_PATTERN, (tag) =>
    tag.replace(/[<＜‹]/gu, "&lt;").replace(/[>＞›]/gu, "&gt;"),
  );
}

const PHRASES: readonly RegExp[] = [
  /игнорируй(?:те)?\s+(?:все\s+|всё\s+)?(?:предыдущие|прошлые|выше(?:стоящие)?|прежние|эти)?\s*(?:инструкции|указания|правила|команды)/giu,
  /забудь(?:те)?\s+(?:все\s+)?(?:предыдущие\s+|прошлые\s+)?(?:инструкции|указания|правила)/giu,
  /не\s+выполняй(?:те)?\s+(?:предыдущие\s+)?(?:инструкции|правила)/giu,
  /(?:ты|вы)\s+теперь\s+(?!может|можешь)[\p{L}\- ]{2,40}/giu,
  /с\s+этого\s+момента\s+(?:ты|вы)\s+[\p{L}\- ]{2,40}/giu,
  /(?:переведи|переведите|перечисли|перечислите|отправь|отправьте)\s+(?:мне\s+|на\s+(?:счёт|счет|карту)\s+)?(?:все\s+)?(?:деньги|средства|\d[\d\s.,]*\s*(?:byn|руб|usd|eur|\$|€))[^.\n]{0,60}/giu,
  /(?:покажи|раскрой|выведи|повтори)\s+(?:свою\s+|мне\s+)?(?:системн\p{L}+\s+)?(?:подсказк\p{L}*|промпт|инструкции)/giu,
  /ignore\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)/giu,
  /disregard\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?|rules?)/giu,
  /you\s+are\s+now\s+(?:a|an|the)?\s*[\p{L}\- ]{2,40}/giu,
  /(?:reveal|show|print|repeat)\s+(?:your\s+|the\s+)?system\s+prompt/giu,
  /(?:transfer|send|wire)\s+(?:all\s+)?(?:the\s+)?(?:money|funds)[^.\n]{0,60}/giu,
];

export interface PreparedDocument {
  readonly text: string;
  /** Сколько инструктивных фраз заменено (для лога: число, не текст). */
  readonly neutralized: number;
}

/** Документ перед блоком `<document>`: приказы заменены меткой, теги разметки экранированы. */
export function prepareDocument(text: string): PreparedDocument {
  let neutralized = 0;
  let result = text;
  for (const phrase of PHRASES) {
    result = result.replace(phrase, () => {
      neutralized += 1;
      return INJECTION_MARK;
    });
  }
  return { text: escapeDocumentTags(result), neutralized };
}
