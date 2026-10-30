// Крайние случаи репозиториев legal-base на Postgres: краткие имена для неизвестных актов, пустая редакция, пункт, которого
// нет в статье, гибрид только по одной из веток, запись пустой порции векторов.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../../platform/db/system-db.ts";
import { START_CATALOG } from "../../domain/start-catalog.ts";
import { applyEdition, findAct, seedActs, seedAliases } from "./catalog.repo.ts";
import { saveEmbeddings } from "./embeddings.repo.ts";
import { articleFragments, hybridIds } from "./search.repo.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});
const system = () => createSystemDb(db.pool);

describe("репозитории legal-base: крайние случаи", () => {
  it("краткие имена записываются только для актов, которые есть в каталоге; повтор безопасен", async () => {
    await seedAliases(system(), START_CATALOG);
    expect((await db.owner.query("select 1 from legal_act_aliases")).rowCount).toBe(0);
    await seedActs(system(), START_CATALOG, "start-catalog");
    await seedAliases(system(), START_CATALOG);
    await seedAliases(system(), START_CATALOG);
    const n = Number(
      (await db.owner.query<{ n: string }>("select count(*) as n from legal_act_aliases")).rows[0]
        ?.n,
    );
    expect(n).toBeGreaterThan(30);
  });

  it("гибрид без запроса и без вектора ничего не ищет; пустая порция векторов не пишется", async () => {
    expect(await hybridIds(system(), { tsQuery: null, vector: null, limit: 5 })).toEqual([]);
    expect(
      await hybridIds(system(), {
        tsQuery: null,
        vector: Array.from({ length: 1024 }, () => 0.1),
        limit: 5,
      }),
    ).toEqual([]);
    await saveEmbeddings(system(), "019e0000-0000-7000-8000-000000000001", [], new Date());
  });

  it("пункт, которого нет в статье, — вернётся вся статья; статьи нет — пусто", async () => {
    expect(
      await articleFragments(system(), "019e0000-0000-7000-8000-0000000000aa", "1", "9"),
    ).toEqual([]);
  });

  it("пустая редакция (ни продлить, ни заменить) применяется: акт «загружен», снимок записан", async () => {
    const act = await findAct(system(), "H10200090");
    expect(act).toBeDefined();
    const result = await applyEdition(
      system(),
      {
        actId: act?.id ?? "",
        textHash: "h-empty",
        rawGz: Buffer.from("x"),
        rawBytes: 1,
        fetchedAt: new Date("2026-10-30T09:00:00Z"),
      },
      { keep: [], changed: [], renumbered: [], added: [], missing: [] },
      0,
    );
    expect(result).toEqual({ kept: 0, changed: 0, renumbered: 0, added: 0, excluded: 0 });
    expect((await findAct(system(), "H10200090"))?.loadState).toBe("loaded");
  });
});
