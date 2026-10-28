// AGT-03 «профиль», PROF-04, PROF-06: инструменты агента на Postgres — запись факта «чат» с undoToken и чтение фактов,
// оценённых на сегодня.
import { testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb } from "../../../platform/db/scoped-db.ts";
import { factsWithJournal } from "../application/__fixtures__/facts-with-journal.ts";
import { profileTools } from "./tools.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

describe("AGT-03: инструменты профиля", () => {
  it("upsert_profile_fact пишет факт «чат» с undoToken, read_profile_facts — оценённые на сегодня", async () => {
    const s = createScopedDb(db.pool, testScope({ user: 1, household: 1 }));
    const { facts, clock } = factsWithJournal();
    const [read, upsert] = profileTools(facts, clock);
    const ctx = { s, requestId: "test", channel: "web" as const };
    if (read?.kind !== "read" || upsert?.kind !== "write") throw new Error("инструменты");
    const saved = await upsert.execute(ctx, {
      value: {
        key: "children",
        children: [{ age: 4, name: null, birthDate: null, disability: false }],
      },
    });
    expect(saved).toMatchObject({ fact: { source: "chat" }, undoToken: expect.any(String) });
    expect(await read.execute(ctx, { keys: ["children"] })).toMatchObject({
      onDate: "2026-10-28",
      facts: [{ evaluation: { childrenUnder18: 1 } }],
    });
    expect((await read.execute(ctx, {})).facts).toHaveLength(1);
    expect((await read.execute(ctx, { keys: ["largeFamily"] })).facts).toEqual([]);
  });
});
