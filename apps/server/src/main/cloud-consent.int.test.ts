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
    expect(await revoked.json()).toMatchObject({ cloud: { granted: false, since: null } });

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
