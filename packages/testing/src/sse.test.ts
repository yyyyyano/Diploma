import { describe, expect, it } from "vitest";
import { readSse, type SseEvent } from "./sse.ts";

function body(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function all(stream: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of readSse(stream)) events.push(event);
  return events;
}

describe("readSse — поток Server-Sent Events", () => {
  it("событие, комментарий keepalive и done по порядку", async () => {
    expect(
      await all(
        body(":\n\n", 'event: message\ndata: {"a":1}\n\n', ":\n\n", 'event: done\ndata: "x"\n\n'),
      ),
    ).toEqual([
      { comment: true },
      { event: "message", data: '{"a":1}' },
      { comment: true },
      { event: "done", data: '"x"' },
    ]);
  });

  it("событие, разрезанное между кусками и с CRLF, собирается целиком", async () => {
    expect(await all(body("event: mess", "age\r\ndata: 1\r\n", "data: 2\r\n\r\n"))).toEqual([
      { event: "message", data: "1\n2" },
    ]);
  });

  it("неполное событие в конце тела не отдаётся", async () => {
    expect(await all(body("event: message\ndata: 1\n"))).toEqual([]);
  });
});
