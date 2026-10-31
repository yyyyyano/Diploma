// Динамика запроса — в конце сообщения пользователя, а не в префиксе (ARCHITECTURE §8.2: префикс постоянен ради кэша):
// сегодняшняя дата и контекст страницы (CHAT-08: раздел, период, фильтры, открытый объект). Блок — данные, не
// инструкции (SEC-10): параметры страницы приходят из адресной строки, поэтому проходят фильтр инструктивных фраз.
import type { PageContext } from "@kosht/contract";
import { prepareDocument } from "../../llm/index.ts";

export interface ContextBlock {
  readonly text: string;
  /** Сколько инструктивных фраз заменено в данных страницы (для лога). */
  readonly neutralized: number;
}

export function contextBlock(input: {
  readonly today: string;
  readonly page?: PageContext | undefined;
  /** Ключ факта, который код только что записал из ответа на дозапрос (AGT-06): повторно его сохранять не нужно. */
  readonly recordedFact?: string | undefined;
}): ContextBlock {
  const lines = [`today: ${input.today}`];
  let neutralized = 0;
  if (input.page !== undefined) {
    const prepared = prepareDocument(JSON.stringify(input.page));
    neutralized = prepared.neutralized;
    lines.push(`page: ${prepared.text}`);
  }
  if (input.recordedFact !== undefined) lines.push(`fact-recorded: ${input.recordedFact}`);
  return { text: `<context>\n${lines.join("\n")}\n</context>`, neutralized };
}
