// Разбиение потока текста на предложения (AGT-04): ответ держится до конца предложения, числа в нём проверяются, затем
// оно выводится. Предложение — до «.», «!», «?», «…» с пробелом после, либо до перевода строки; точка после
// сокращения («ст. 210», «руб. Это», «т. д.»), в десятичной дроби и в нумерации списка границей не считается. Куски,
// сложенные обратно, дают исходный текст.

/** После этих сокращений предложение не кончается никогда: дальше — номер или название («ст. 210», «ул. Ленина»). */
const NEVER_END = new Set([
  "ст",
  "п",
  "пп",
  "ч",
  "гл",
  "разд",
  "ул",
  "д",
  "кв",
  "стр",
  "рис",
  "им",
  "ред",
]);
/** После этих — граница, только если следующее слово с заглавной («…500 руб. Это»). */
const END_IF_CAPITAL = new Set([
  "руб",
  "коп",
  "тыс",
  "млн",
  "млрд",
  "г",
  "гг",
  "др",
  "пр",
  "см",
  "напр",
  "тел",
]);

const TERMINATORS = /[.!?…]/u;
const CLOSERS = /[)»"”'\]]/u;

function lastWord(before: string): string {
  return /([\p{L}]+)$/u.exec(before)?.[1]?.toLowerCase() ?? "";
}

export interface SentenceSplitter {
  /** Добавить кусок текста; вернуть законченные предложения (с пробелами после). */
  push(chunk: string): string[];
  /** Конец текста: остаток (может быть без точки) или undefined. */
  flush(): string | undefined;
}

export function createSentenceSplitter(): SentenceSplitter {
  let buffer = "";

  /** Позиция конца первого законченного предложения в buffer (после пробелов) или -1: нужен ещё текст. */
  function boundary(): number {
    for (let i = 0; i < buffer.length; i += 1) {
      const ch = buffer[i] ?? "";
      if (ch === "\n") {
        let end = i + 1;
        while (end < buffer.length && /[\n\r]/u.test(buffer[end] ?? "")) end += 1;
        // Перевод строки — всегда конец, но после него нужен следующий символ или конец потока: пустые строки ещё могут идти.
        return end < buffer.length ? end : i + 1;
      }
      if (!TERMINATORS.test(ch)) continue;
      let end = i + 1;
      while (
        end < buffer.length &&
        (TERMINATORS.test(buffer[end] ?? "") || CLOSERS.test(buffer[end] ?? ""))
      ) {
        end += 1;
      }
      if (end >= buffer.length) return -1;
      if (!/\s/u.test(buffer[end] ?? "")) {
        i = end - 1; // «1.5», «pravo.by», «210.»+буква — не граница
        continue;
      }
      let next = end;
      while (next < buffer.length && /[ \t  ]/u.test(buffer[next] ?? "")) next += 1;
      const before = buffer.slice(0, i);
      // «1.» в начале строки — нумерация списка.
      if (ch === "." && /(?:^|\n)[ \t]*\d{1,3}$/u.test(before)) {
        i = end - 1;
        continue;
      }
      const word = lastWord(before);
      if (ch === "." && NEVER_END.has(word)) {
        i = end - 1;
        continue;
      }
      if (ch === "." && END_IF_CAPITAL.has(word)) {
        if (next >= buffer.length) return -1;
        const after = buffer[next] ?? "";
        if (!(after.toLowerCase() !== after)) {
          i = end - 1;
          continue;
        }
      }
      return next;
    }
    return -1;
  }

  return {
    push(chunk) {
      buffer += chunk;
      const out: string[] = [];
      for (;;) {
        const end = boundary();
        if (end < 0) break;
        out.push(buffer.slice(0, end));
        buffer = buffer.slice(end);
      }
      return out;
    },
    flush() {
      const rest = buffer;
      buffer = "";
      return rest === "" ? undefined : rest;
    },
  };
}
