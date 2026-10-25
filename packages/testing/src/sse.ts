// Чтение потока Server-Sent Events в тестах (fetch → тело ответа): события `event:`/`data:` и комментарии
// keepalive (строки «:»). Клиента oRPC на сервере нет — тесты читают поток так же, как его видит браузер.

/** Одно событие потока; comment — строка-комментарий (keepalive), у неё нет event и data. */
export interface SseEvent {
  readonly event?: string;
  readonly data?: string;
  readonly comment?: true;
}

/** События потока по порядку; заканчивается вместе с телом ответа. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | undefined;
  let data: string[] = [];
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end = buffer.indexOf("\n");
    while (end !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/, "");
      buffer = buffer.slice(end + 1);
      end = buffer.indexOf("\n");
      if (line === "") {
        if (event !== undefined || data.length > 0) {
          yield {
            ...(event === undefined ? {} : { event }),
            ...(data.length === 0 ? {} : { data: data.join("\n") }),
          };
        }
        event = undefined;
        data = [];
      } else if (line.startsWith(":")) {
        yield { comment: true };
      } else {
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        if (field === "data") data.push(value);
      }
    }
  }
}
