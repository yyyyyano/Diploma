// VOICE-02, VOICE-03, SEC-02, SEC-03: распознавание записи через настоящий корень композиции — шлюз с тестовым
// провайдером (фиксированный текст), проверка записи по заголовку, ограничение частоты по пользователю.
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
import { makeTranscribeRecording } from "./transcribe.ts";

/** Фиксированный текст тестового провайдера llm: в тестах речь «расшифровывается» им же. */
const TRANSCRIPT = "тестовая расшифровка";

let db: TestDb;
let stand: TestComposition;
let household = 900;

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
    transcribe: makeTranscribeRecording({ llm, platform }),
    scoped: (scope: Scope) => platform.scoped(scope),
  };
}

const wav = (options?: Parameters<typeof makeWav>[0]) =>
  new Blob([makeWav(options).buffer as ArrayBuffer], { type: "audio/wav" });

describe("VOICE-02, VOICE-03: запись → текст", () => {
  it("WAV 16 кГц → текст из шлюза (в тестах — фиксированный тестового провайдера)", async () => {
    const app = voice();
    expect(await app.transcribe(app.scoped(user()), wav({ seconds: 3 }))).toEqual({
      text: TRANSCRIPT,
    });
  });

  it("не WAV, названный wav, — FILE_TYPE_NOT_ALLOWED; MP3 по заголовку — тоже", async () => {
    const app = voice();
    const s = app.scoped(user());
    const fake = new Blob([new TextEncoder().encode("ID3 это не запись")], { type: "audio/wav" });
    await expect(app.transcribe(s, fake)).rejects.toMatchObject({ code: "FILE_TYPE_NOT_ALLOWED" });
    await expect(app.transcribe(s, wav({ sampleRate: 44_100 }))).rejects.toMatchObject({
      code: "FILE_TYPE_NOT_ALLOWED",
    });
  });

  it("длиннее 60 секунд и больше 4 МБ — FILE_TOO_LARGE", async () => {
    const app = voice();
    const s = app.scoped(user());
    await expect(app.transcribe(s, wav({ seconds: 70 }))).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
    await expect(app.transcribe(s, new Blob([new Uint8Array(4_000_001)]))).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
  });
});

describe("SEC-02: ограничение частоты распознавания", () => {
  it("сверх предела в минуту — RATE_LIMITED; другой пользователь не затронут", async () => {
    const app = voice();
    await stand.composition.platform.settings.set(VOICE_RATE_PER_MINUTE, 2);
    try {
      const s = app.scoped(user());
      await app.transcribe(s, wav());
      await app.transcribe(s, wav());
      await expect(app.transcribe(s, wav())).rejects.toMatchObject({ code: "RATE_LIMITED" });
      expect(await app.transcribe(app.scoped(user()), wav())).toEqual({ text: TRANSCRIPT });
    } finally {
      await stand.composition.platform.settings.reset(VOICE_RATE_PER_MINUTE);
    }
  });
});
