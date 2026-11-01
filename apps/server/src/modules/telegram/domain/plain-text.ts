// Ответ модели — Markdown, а Telegram получает обычный текст без разметки (SEC-05: ни сырого HTML, ни экранирования, которое
// можно перепутать): убираем жирный/курсив/заголовки/обратные кавычки. Поток приходит кусками, «**» может разорваться между
// ними — поэтому преобразователь держит хвост («*», «_», «`», «#»), пока не увидит следующий знак.
const MARKERS = /\*\*|__|`/gu;
const HEADING = /^#{1,6}[ \t]+/gmu;
const CARRY = /[*_`#]+$/u;

export interface PlainTextStream {
  /** Очередной кусок Markdown → готовый к отправке текст (может быть пустым — хвост удержан). */
  push(chunk: string): string;
  /** Конец потока: удержанный хвост уходит как есть. */
  end(): string;
}

function strip(text: string): string {
  return text.replace(MARKERS, "").replace(HEADING, "");
}

export function createPlainTextStream(): PlainTextStream {
  let carry = "";
  let atLineStart = true;
  return {
    push(chunk) {
      const text = carry + chunk;
      const held = CARRY.exec(text)?.[0] ?? "";
      carry = held;
      const ready = text.slice(0, text.length - held.length);
      // Заголовок распознаётся в начале строки; кусок, начавшийся посреди строки, «#» в начале не имеет.
      const prefix = atLineStart ? "" : "\n";
      const out = strip(prefix + ready);
      if (ready.length > 0) atLineStart = ready.endsWith("\n");
      return atLineStart || prefix === "" ? out : out.slice(1);
    },
    end() {
      const rest = carry;
      carry = "";
      return strip(atLineStart ? rest : `\n${rest}`).slice(atLineStart ? 0 : 1);
    },
  };
}

/** Целый текст разом (запасная отправка одним сообщением). */
export function plainText(markdown: string): string {
  const stream = createPlainTextStream();
  return stream.push(markdown) + stream.end();
}
