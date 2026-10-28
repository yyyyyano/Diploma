// PRIV-05 на Postgres: «Скачать все мои данные» — заявка ставит одну сборку (повтор и две заявки разом — та же
// заявка), сборка пишет потоковый ZIP по реестру владельцев: manifest, JSON каждой таблицы реестра (только своё
// домохозяйство, длинная таблица — целиком по страницам) и исходные файлы; архив — файл домохозяйства, заявка
// готова, событие и сигнал. Новая заявка удаляет прежний архив; оборванная сборка — «не удалось» без файла; зависшая —
// повторяется; повтор доставки задачи ничего не делает.
import { CONSENT_VERSIONS } from "@kosht/i18n";
import { FileId, type Scope } from "@kosht/kernel";
import { FakeClock, MemoryBlobStore, readZip, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeFiles } from "../../files/application/files.ts";
import { filesUserData } from "../../files/user-data.ts";
import { createScopedDb, type ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineUserData, type UserDataOwner } from "../../../platform/db/user-data.ts";
import type { EventDef } from "../../../platform/events/define-event.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { privacyConsents, privacyExports } from "../infrastructure/db/schema.ts";
import { makeDataExport } from "./data-export.ts";
import { makeRecordRegistrationConsents } from "./record-registration-consents.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const privacyOwner: UserDataOwner = {
  module: "privacy",
  data: defineUserData({ tables: [privacyExports, privacyConsents] }),
};

function setup(extraOwners: readonly UserDataOwner[] = []) {
  const clock = new FakeClock("2026-10-28T09:00:00Z");
  const blobs = new MemoryBlobStore();
  const log = memoryLogger().log;
  const files = makeFiles({ blobs, clock, log });
  const owners: UserDataOwner[] = [
    { module: "files", data: filesUserData(files) },
    privacyOwner,
    ...extraOwners,
  ];
  const published: { name: string; payload: unknown }[] = [];
  const signals: { entity: string; ids: readonly string[] }[] = [];
  const enqueued: string[] = [];
  const exports = makeDataExport({
    clock,
    log,
    events: {
      publish: async (_tx: unknown, event: EventDef, payload: unknown) => {
        published.push({ name: event.name, payload });
      },
    },
    realtime: {
      changed: async (_s, signal) => {
        signals.push({ entity: signal.entity, ids: signal.ids });
      },
      progress: async () => undefined,
    },
    userData: () => owners,
    files,
    enqueueBuild: async (_tx, exportId) => {
      enqueued.push(exportId);
    },
  });
  return { clock, blobs, files, exports, published, signals, enqueued };
}

const consents = makeRecordRegistrationConsents({
  clock: new FakeClock("2026-10-27T09:00:00Z"),
  events: { publish: async () => undefined },
});

async function seedConsents(s: ScopedDb): Promise<void> {
  await consents(s, {
    personalData: { accepted: true, version: CONSENT_VERSIONS.personalData },
    cloud: { accepted: false, version: CONSENT_VERSIONS.cloud },
  });
}

const text = (data: Uint8Array | undefined) => new TextDecoder().decode(data);
const rowsOf = (data: Uint8Array | undefined) =>
  JSON.parse(text(data)) as Record<string, unknown>[];

async function archiveOf(
  files: ReturnType<typeof makeFiles>,
  s: ScopedDb,
  fileId: string | undefined,
) {
  if (fileId === undefined) throw new Error("у заявки нет файла");
  const opened = await files.open(s, FileId.parse(fileId));
  return { opened, entries: await readZip(new Uint8Array(await opened.blob.arrayBuffer())) };
}

function scoped(scope: Scope) {
  return createScopedDb(db.pool, scope);
}

describe("PRIV-05: заявка на архив «Мои данные»", () => {
  it("заявка ставит одну сборку; повторная, пока архив готовится, — та же заявка без новой задачи", async () => {
    const { exports, enqueued, signals } = setup();
    const s = scoped(testScope({ user: 1, household: 1 }));
    expect(await exports.state(s)).toEqual({
      status: "none",
      requestedAt: undefined,
      finishedAt: undefined,
      file: undefined,
    });
    const first = await exports.request(s);
    expect(first).toMatchObject({
      status: "pending",
      requestedAt: new Date("2026-10-28T09:00:00Z"),
      file: undefined,
    });
    expect(await exports.request(s)).toEqual(first);
    expect(enqueued).toHaveLength(1);
    expect(signals).toEqual([{ entity: "data-export", ids: enqueued }]);
  });

  it("две заявки разом — одна готовящаяся заявка и одна задача", async () => {
    const { exports, enqueued } = setup();
    const s = scoped(testScope({ user: 2, household: 2 }));
    const [a, b] = await Promise.all([exports.request(s), exports.request(s)]);
    expect(a).toEqual(b);
    expect(enqueued).toHaveLength(1);
    const { rows } = await db.owner.query(
      "select status from privacy_exports where household_id = $1",
      [s.scope.householdId],
    );
    expect(rows).toEqual([{ status: "pending" }]);
  });
});

describe("PRIV-05: сборка архива", () => {
  it("архив: manifest, JSON каждой таблицы реестра только своего домохозяйства и исходные файлы; заявка готова, событие и сигнал", async () => {
    const { exports, files, enqueued, published, signals, clock } = setup();
    const a = scoped(testScope({ user: 3, household: 3 }));
    const b = scoped(testScope({ user: 4, household: 4 }));
    await seedConsents(a);
    await seedConsents(b);
    const photo = await files.save(a, {
      kind: "receipt-photo",
      name: "чек.jpg",
      mime: "image/jpeg",
      content: new TextEncoder().encode("jpeg-байты"),
    });
    await files.save(b, {
      kind: "statement",
      name: "чужая.csv",
      mime: "text/csv",
      content: new TextEncoder().encode("чужое"),
    });
    await exports.request(a);
    const exportId = enqueued[0] ?? "";
    clock.advance(5_000);
    await exports.build(a, exportId);

    const state = await exports.state(a);
    expect(state).toMatchObject({
      status: "ready",
      finishedAt: new Date("2026-10-28T09:00:05Z"),
      file: { name: "kosht-my-data-2026-10-28.zip" },
    });
    const { opened, entries } = await archiveOf(files, a, state.file?.id);
    expect(opened).toMatchObject({ kind: "data-export", mime: "application/zip" });
    expect(state.file?.size).toBe(opened.size);
    expect([...entries.keys()]).toEqual([
      "manifest.json",
      "data/files/files.json",
      "data/privacy/privacy_exports.json",
      "data/privacy/privacy_consents.json",
      `files/files/${photo.id}-чек.jpg`,
    ]);
    expect(JSON.parse(text(entries.get("manifest.json")))).toEqual({
      format: "kosht-my-data",
      version: 1,
      exportedAt: "2026-10-28T09:00:05.000Z",
      tables: [
        "data/files/files.json",
        "data/privacy/privacy_exports.json",
        "data/privacy/privacy_consents.json",
      ],
    });
    const consentRows = rowsOf(entries.get("data/privacy/privacy_consents.json"));
    expect(consentRows.map((row) => [row["kind"], row["granted"], row["textVersion"]])).toEqual(
      expect.arrayContaining([
        ["personal-data", true, CONSENT_VERSIONS.personalData],
        ["cloud", false, CONSENT_VERSIONS.cloud],
      ]),
    );
    const allRows = [...entries.entries()]
      .filter(([path]) => path.startsWith("data/"))
      .flatMap(([, data]) => rowsOf(data));
    expect(allRows.length).toBeGreaterThan(0);
    expect(allRows.every((row) => row["householdId"] === a.scope.householdId)).toBe(true);
    expect(rowsOf(entries.get("data/files/files.json")).map((row) => row["name"])).toEqual([
      "чек.jpg",
    ]);
    expect(text(entries.get(`files/files/${photo.id}-чек.jpg`))).toBe("jpeg-байты");
    expect(published).toEqual([{ name: "privacy.export-ready", payload: { ids: [exportId] } }]);
    expect(signals.at(-1)).toEqual({ entity: "data-export", ids: [exportId] });
    expect(await exports.isReady(a, exportId)).toBe(true);
    expect(await exports.isReady(b, exportId)).toBe(false);
  });

  it("таблица длиннее страницы выгружается целиком, без повторов и пропусков", async () => {
    const { exports, files, enqueued } = setup();
    const s = scoped(testScope({ user: 5, household: 5 }));
    await db.owner.query(
      `insert into privacy_consents (household_id, user_id, kind, granted, text_version)
       select $1, $2, 'cloud', n % 2 = 0, '2026-10-26' from generate_series(1, 1203) as n`,
      [s.scope.householdId, s.scope.userId],
    );
    await exports.request(s);
    await exports.build(s, enqueued[0] ?? "");
    const { entries } = await archiveOf(files, s, (await exports.state(s)).file?.id);
    const ids = rowsOf(entries.get("data/privacy/privacy_consents.json")).map((row) => row["id"]);
    expect(ids).toHaveLength(1203);
    expect(new Set(ids).size).toBe(1203);
  });

  it("повтор доставки задачи после готовности ничего не делает: второго архива и события нет", async () => {
    const { exports, enqueued, published } = setup();
    const s = scoped(testScope({ user: 6, household: 6 }));
    await exports.request(s);
    const exportId = enqueued[0] ?? "";
    await exports.build(s, exportId);
    const ready = await exports.state(s);
    await exports.build(s, exportId);
    expect(await exports.state(s)).toEqual(ready);
    expect(published).toHaveLength(1);
    const { rows } = await db.owner.query(
      "select count(*)::int as n from files where household_id = $1 and kind = 'data-export'",
      [s.scope.householdId],
    );
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("новая заявка удаляет прежний архив — и строку, и файл", async () => {
    const { exports, enqueued, blobs } = setup();
    const s = scoped(testScope({ user: 7, household: 7 }));
    await exports.request(s);
    await exports.build(s, enqueued[0] ?? "");
    const old = (await exports.state(s)).file?.id ?? "";
    await exports.request(s);
    expect(await exports.state(s)).toMatchObject({ status: "pending", file: undefined });
    expect(await blobs.open(s.scope.householdId, FileId.parse(old))).toBeUndefined();
    const { rows } = await db.owner.query(
      "select count(*)::int as n from files where household_id = $1",
      [s.scope.householdId],
    );
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("источник оборвался — заявка «не удалось», файла архива нет, ошибка уходит в журнал задачи", async () => {
    const broken: UserDataOwner = {
      module: "broken",
      data: defineUserData({
        tables: [],
        export: async () => {
          throw new Error("хук выгрузки упал");
        },
      }),
    };
    const { exports, enqueued, published, blobs } = setup([broken]);
    const s = scoped(testScope({ user: 8, household: 8 }));
    await exports.request(s);
    await expect(exports.build(s, enqueued[0] ?? "")).rejects.toThrow("хук выгрузки упал");
    expect(await exports.state(s)).toMatchObject({ status: "failed", file: undefined });
    expect(published).toEqual([]);
    expect(blobs.size).toBe(0);
  });

  it("заявка, зависшая дольше срока сборки, показывается «не удалось» и повторяется новой задачей", async () => {
    const { exports, enqueued, clock } = setup();
    const s = scoped(testScope({ user: 9, household: 9 }));
    await exports.request(s);
    clock.advance(16 * 60 * 1000);
    expect((await exports.state(s)).status).toBe("failed");
    expect((await exports.request(s)).status).toBe("pending");
    expect(enqueued).toHaveLength(2);
    // Запоздавшая задача старой заявки ничего не делает: заявки уже нет.
    await exports.build(s, enqueued[0] ?? "");
    expect((await exports.state(s)).status).toBe("pending");
  });
});
