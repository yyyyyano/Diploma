// LLM-10, PRIV-02, ROLE-01: выбор модели пользователем на Postgres — список только из разрешённых администратором
// и допустимых облачным согласием; выбор хранится у пользователя и не виден другому; выбранная, но ставшая
// недоступной модель показывается как «Авто».
import { testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createScopedDb, type ScopedDb } from "../../../platform/db/scoped-db.ts";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { makePreferences } from "./preferences.ts";

let db: TestDb;
let a: ScopedDb;
let b: ScopedDb;
beforeAll(async () => {
  db = await createTestDb();
  a = createScopedDb(db.pool, testScope({ user: 1, household: 1 }));
  b = createScopedDb(db.pool, testScope({ user: 2, household: 2 }));
});
afterAll(async () => {
  await db.drop();
});

async function seedModels() {
  await db.owner.query("delete from llm_preferences");
  await db.owner.query("delete from llm_models where provider <> 'test'");
  await db.owner.query(
    `insert into llm_models (id, provider, model_id, cloud, capabilities, priority, enabled, context_tokens, user_selectable) values
     ('groq/big', 'groq', 'big', true, array['text','tools','structured'], 1, true, 8192, true),
     ('groq/hidden', 'groq', 'hidden', true, array['text','tools'], 2, true, 8192, false),
     ('groq/off', 'groq', 'off', true, array['text','tools'], 3, false, 8192, true),
     ('groq/vision', 'groq', 'vision', true, array['images','structured'], 4, true, 8192, true),
     ('llama/small', 'llama', 'small', false, array['text','tools'], 90, true, 8192, true)`,
  );
}
beforeEach(seedModels);

function setup(cloud: { value: boolean }) {
  return makePreferences({
    system: createSystemDb(db.pool),
    consent: { cloudAllowed: async () => cloud.value },
  });
}

describe("LLM-10: список моделей для выбора", () => {
  it("с облачным согласием: разрешённые, включённые, умеющие чат — облачные и локальные", async () => {
    const view = await setup({ value: true }).view(a);
    expect(view.items.map((item) => item.id)).toEqual(["groq/big", "llama/small"]);
    expect(view.selected).toBeNull();
  });

  it("PRIV-02: без согласия — только локальные модели", async () => {
    const view = await setup({ value: false }).view(a);
    expect(view.items.map((item) => item.id)).toEqual(["llama/small"]);
  });
});

describe("LLM-10: выбор и «Авто»", () => {
  it("выбранная модель запоминается; повторный выбор заменяет; null возвращает «Авто»", async () => {
    const uc = setup({ value: true });
    expect((await uc.choose(a, "groq/big")).selected).toBe("groq/big");
    expect((await uc.choose(a, "llama/small")).selected).toBe("llama/small");
    expect((await db.owner.query("select model_id from llm_preferences")).rows).toEqual([
      { model_id: "llama/small" },
    ]);
    expect((await uc.choose(a, null)).selected).toBeNull();
    expect((await db.owner.query("select 1 from llm_preferences")).rowCount).toBe(0);
  });

  it("модель вне списка (не разрешена, выключена, без чата, нет такой) — VALIDATION, выбор не меняется", async () => {
    const uc = setup({ value: true });
    await uc.choose(a, "groq/big");
    for (const id of ["groq/hidden", "groq/off", "groq/vision", "nobody/none"]) {
      await expect(uc.choose(a, id)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect((await uc.view(a)).selected).toBe("groq/big");
  });

  it("облачную модель без согласия выбрать нельзя", async () => {
    await expect(setup({ value: false }).choose(a, "groq/big")).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("PRIV-02: после отзыва согласия выбранная облачная модель — «Авто»; вернули согласие — снова выбрана", async () => {
    const consent = { value: true };
    const uc = setup(consent);
    await uc.choose(a, "groq/big");
    consent.value = false;
    expect((await uc.view(a)).selected).toBeNull();
    consent.value = true;
    expect((await uc.view(a)).selected).toBe("groq/big");
  });

  it("ROLE-01: выбор одного пользователя другой не видит и не меняет", async () => {
    const uc = setup({ value: true });
    await uc.choose(a, "groq/big");
    expect((await uc.view(b)).selected).toBeNull();
    await uc.choose(b, "llama/small");
    expect((await uc.view(a)).selected).toBe("groq/big");
    expect(await uc.preferredOf(b)).toBe("llama/small");
  });
});
