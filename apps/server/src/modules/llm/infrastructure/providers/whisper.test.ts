// VOICE-03: адаптер whisper.cpp — запрос multipart на /inference и разбор ответа; сеть — подмена fetch (офлайн, NFR-11).
import { describe, expect, it } from "vitest";
import { createWhisperAdapter } from "./whisper.ts";

const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]);

function modelOf(adapter: ReturnType<typeof createWhisperAdapter>, id = "m") {
  const model = adapter.transcriptionModel?.(id);
  if (model === undefined) throw new Error("у адаптера нет модели речи");
  return model;
}

function adapterWith(reply: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const adapter = createWhisperAdapter({
    baseUrl: async () => "http://127.0.0.1:8143/",
    fetch: (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: url.toString(), init: init ?? {} });
      return reply();
    }) as typeof fetch,
  });
  return { adapter, calls };
}

describe("VOICE-03: whisper.cpp", () => {
  it("запись уходит на /inference файлом с response_format=json, текст приходит без пробелов по краям", async () => {
    const { adapter, calls } = adapterWith(() =>
      Response.json({ text: " потратил пятнадцать рублей на кофе\n" }),
    );
    const result = await modelOf(adapter, "large-v3-turbo-q5_0").doGenerate({
      audio: WAV,
      mediaType: "audio/wav",
    });
    expect(result.text).toBe("потратил пятнадцать рублей на кофе");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://127.0.0.1:8143/inference");
    const form = calls[0]?.init.body as FormData;
    expect(form.get("response_format")).toBe("json");
    const file = form.get("file") as File;
    expect(file.name).toBe("audio.wav");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(WAV);
  });

  it("запись в base64 раскодируется в те же байты", async () => {
    const { adapter, calls } = adapterWith(() => Response.json({ text: "ок" }));
    await modelOf(adapter).doGenerate({
      audio: Buffer.from(WAV).toString("base64"),
      mediaType: "audio/wav",
    });
    const form = calls[0]?.init.body as FormData;
    const file = form.get("file") as File;
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(WAV);
  });

  it("ответ сервера не 2xx — ошибка со статусом, без тела ответа", async () => {
    const { adapter } = adapterWith(() => new Response("секрет запроса", { status: 500 }));
    const call = modelOf(adapter).doGenerate({ audio: WAV, mediaType: "audio/wav" });
    await expect(call).rejects.toMatchObject({ name: "RemoteStatusError", status: 500 });
    await expect(call).rejects.not.toHaveProperty("message", expect.stringContaining("секрет"));
  });

  it("ответ не по форме ({} без text) — ошибка, а не пустой текст", async () => {
    const { adapter } = adapterWith(() => Response.json({}));
    await expect(
      modelOf(adapter).doGenerate({ audio: WAV, mediaType: "audio/wav" }),
    ).rejects.toThrow(/text/);
  });

  it("локальный провайдер без ключа: всегда настроен, не облачный, чату не отвечает", async () => {
    const { adapter } = adapterWith(() => Response.json({ text: "" }));
    expect(adapter.cloud).toBe(false);
    expect(await adapter.isConfigured?.()).toBe(true);
    expect(() => adapter.languageModel("m")).toThrow("не отвечает на чат");
  });
});
