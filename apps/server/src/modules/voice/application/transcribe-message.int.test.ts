// VOICE-01, SEC-02, SEC-03: фасад voice.transcribe для голосовых сообщений бота проверяет частоту и размер, как процедура
// сайта (раньше шлюз звался без проверок), и принимает OGG/Opus Telegram по заголовку, а не по заявленному типу.
import { makeScope, type Scope } from "@kosht/kernel";
import { makeWav, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  composeOnTestDb,
  waitForAppConnectionsClosed,
  type TestComposition,
} from "../../../main/__fixtures__/compose-on-test-db.ts";
import { VOICE_RATE_PER_MINUTE } from "../settings.ts";
import { makeTranscribeMessage } from "./transcribe-message.ts";

const TRANSCRIPT = "тестовая расшифровка";

let db: TestDb;
let stand: TestComposition;
let household = 1900;

beforeAll(async () => {
  db = await createTestDb();
  stand = await composeOnTestDb(db, "api");
});
afterAll(async () => {
  await stand.close();
  await waitForAppConnectionsClosed(db);
  await db.drop();
});

function user(): Scope {
  household += 1;
  return makeScope(testScope({ user: household, household }));
}

function voice() {
  const platform = stand.composition.platform;
  const llm = stand.composition.modules.find((m) => m.id === "llm")?.facade as never;
  return {
    transcribe: makeTranscribeMessage({ llm, platform }),
    scoped: (scope: Scope) => platform.scoped(scope),
  };
}

/** Заголовок OGG-страницы: так начинается голосовое сообщение Telegram (OGG/Opus). */
const ogg = (size = 2000) => {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("OggS"));
  return bytes;
};

describe("VOICE-01: голосовое сообщение бота → текст", () => {
  it("OGG/Opus → текст из шлюза", async () => {
    const app = voice();
    expect(await app.transcribe(app.scoped(user()), ogg())).toBe(TRANSCRIPT);
  });

  it("WAV 16 кГц тоже принимается", async () => {
    const app = voice();
    expect(await app.transcribe(app.scoped(user()), makeWav({ seconds: 2 }))).toBe(TRANSCRIPT);
  });

  it("не запись (заголовок не OGG и не WAV) — FILE_TYPE_NOT_ALLOWED", async () => {
    const app = voice();
    const fake = new TextEncoder().encode("это текст, а не голос");
    await expect(app.transcribe(app.scoped(user()), fake)).rejects.toMatchObject({
      code: "FILE_TYPE_NOT_ALLOWED",
    });
  });

  it("больше 4 МБ — FILE_TOO_LARGE ещё до обращения к модели", async () => {
    const app = voice();
    await expect(app.transcribe(app.scoped(user()), ogg(4_000_001))).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
  });
});

describe("SEC-02: частота распознавания у бота общая с сайтом", () => {
  it("сверх предела в минуту — RATE_LIMITED; другой пользователь не затронут", async () => {
    const app = voice();
    await stand.composition.platform.settings.set(VOICE_RATE_PER_MINUTE, 2);
    try {
      const s = app.scoped(user());
      await app.transcribe(s, ogg());
      await app.transcribe(s, ogg());
      await expect(app.transcribe(s, ogg())).rejects.toMatchObject({ code: "RATE_LIMITED" });
      expect(await app.transcribe(app.scoped(user()), ogg())).toBe(TRANSCRIPT);
    } finally {
      await stand.composition.platform.settings.reset(VOICE_RATE_PER_MINUTE);
    }
  });
});
