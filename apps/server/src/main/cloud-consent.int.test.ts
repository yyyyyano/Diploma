// PRIV-02 сквозь HTTP и цепочку llm: пользователь с облачным согласием получает облачную модель; отозвал согласие на
// вкладке «Конфиденциальность» — следующий же вызов модели идёт только в локальную (строки журнала расхода — только
// локальной модели). Облачная запись реестра — тестовый провайдер с флагом cloud: сеть не нужна (NFR-11).
import { CONSENT_VERSIONS } from "@kosht/i18n";
import { makeScope, type Scope } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LlmFacade } from "../modules/llm/index.ts";
import { registerUser, startHttpStack, type HttpStack } from "./__fixtures__/http-stack.ts";

let db: TestDb;
let stack: HttpStack;
beforeAll(async () => {
  db = await createTestDb();
  stack = await startHttpStack(db);
  await db.owner.query(
    `insert into llm_models (id, provider, model_id, cloud, capabilities, priority, context_tokens)
     values ('test/cloud', 'test', 'cloud', true, array['text', 'tools', 'structured'], 1, 8192)`,
  );
  // Облачную модель администратор разрешил выбирать в чате (LLM-10).
  await db.owner.query(
    "update llm_models set user_selectable = true where id in ('test/cloud', 'test/scripted')",
  );
});
afterAll(async () => {
  await stack.close();
  await db.drop();
});

function llm(): LlmFacade {
  const module = stack.api.modules.find((m) => m.id === "llm");
  if (module === undefined) throw new Error("нет модуля llm");
  return module.facade as LlmFacade;
}

/** Один вызов модели чата от имени пользователя: какая модель ответила (по журналу расхода). */
async function callChat(scope: Scope): Promise<string> {
  const { model } = await llm().model(scope, "chat");
  await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "Привет" }] }],
  });
  const { rows } = await db.owner.query<{ model: string }>(
    "select model from llm_usage order by created_at desc, id desc limit 1",
  );
  return rows[0]?.model ?? "";
}

describe("PRIV-02: отзыв облачного согласия действует на следующий вызов модели", () => {
  it("с согласием — облачная модель; после отзыва в настройках — только локальная", async () => {
    const user = await registerUser(stack, db, "cloud@example.test", { cloud: true });
    const scope = makeScope(user);
    expect(await callChat(scope)).toBe("cloud");

    const revoked = await stack.call("local", "/privacy/cloud-consent", {
      cookie: user.cookie,
      body: { granted: false, version: CONSENT_VERSIONS.cloud },
    });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({
      cloud: { granted: false, since: null, outdated: false },
    });

    expect(await callChat(scope)).toBe("scripted");
    expect(await callChat(scope)).toBe("scripted");

    const state = await (await stack.call("local", "/privacy", { cookie: user.cookie })).json();
    expect(state).toMatchObject({
      cloud: { granted: false },
      history: [
        { kind: "cloud", granted: false },
        { kind: "cloud", granted: true },
        { kind: "personal-data", granted: true },
      ],
    });
  });

  it("дал согласие снова — облачная модель со следующего вызова", async () => {
    const user = await registerUser(stack, db, "local@example.test");
    const scope = makeScope(user);
    expect(await callChat(scope)).toBe("scripted");
    const granted = await stack.call("local", "/privacy/cloud-consent", {
      cookie: user.cookie,
      body: { granted: true, version: CONSENT_VERSIONS.cloud },
    });
    expect(await granted.json()).toMatchObject({ cloud: { granted: true } });
    expect(await callChat(scope)).toBe("cloud");
  });
});

describe("LLM-10, PRIV-02: выбранная облачная модель после отзыва согласия не используется", () => {
  async function chooseHttp(cookie: string, modelId: string | null) {
    return stack.call("local", "/llm/preferred-model", { cookie, body: { modelId } });
  }

  it("с согласием выбор принят и отвечает облачная модель; отзыв — «Авто» и только локальная, вернули — снова облачная", async () => {
    const user = await registerUser(stack, db, "chooser@example.test", { cloud: true });
    const scope = makeScope(user);
    const chosen = await chooseHttp(user.cookie, "test/cloud");
    expect(chosen.status).toBe(200);
    expect(await chosen.json()).toMatchObject({ selected: "test/cloud" });
    expect(await callChat(scope)).toBe("cloud");

    await stack.call("local", "/privacy/cloud-consent", {
      cookie: user.cookie,
      body: { granted: false, version: CONSENT_VERSIONS.cloud },
    });
    const view = (await (
      await stack.call("local", "/llm/models", { cookie: user.cookie })
    ).json()) as { selected: string | null; items: { id: string }[] };
    expect(view).toMatchObject({ selected: null });
    expect(view.items.map((item) => item.id)).toEqual(["test/scripted"]);
    expect(await callChat(scope)).toBe("scripted");
    expect((await chooseHttp(user.cookie, "test/cloud")).status).toBe(400);

    await stack.call("local", "/privacy/cloud-consent", {
      cookie: user.cookie,
      body: { granted: true, version: CONSENT_VERSIONS.cloud },
    });
    expect(await callChat(scope)).toBe("cloud");
  });

  it("облачное согласие по прежнему тексту не действует: чат идёт локально, выбор — «Авто»", async () => {
    const user = await registerUser(stack, db, "old-terms@example.test", { cloud: true });
    await chooseHttp(user.cookie, "test/cloud");
    await db.owner.query(
      "update privacy_consents set text_version = '2026-10-26' where user_id = $1 and kind = 'cloud'",
      [user.userId],
    );
    expect(await callChat(makeScope(user))).toBe("scripted");
    expect(
      await (await stack.call("local", "/llm/models", { cookie: user.cookie })).json(),
    ).toMatchObject({
      selected: null,
    });
  });

  it("выбор одного пользователя другому не виден", async () => {
    const a = await registerUser(stack, db, "pick-a@example.test", { cloud: true });
    const b = await registerUser(stack, db, "pick-b@example.test", { cloud: true });
    await chooseHttp(a.cookie, "test/cloud");
    expect(
      await (await stack.call("local", "/llm/models", { cookie: b.cookie })).json(),
    ).toMatchObject({
      selected: null,
    });
  });
});
