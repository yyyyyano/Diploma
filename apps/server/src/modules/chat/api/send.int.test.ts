// CHAT-02, AGT-01, NFR-21: чат целиком на кассете chat/accounts (агент → list_accounts → ответ) через корень
// композиции и процедуры: поток кусков с метаданными запуска, ответ сохраняется частями UI-сообщения, запуск не
// привязан к соединению (вкладку закрыли — ответ дописан), «Стоп» — только своего домохозяйства, остановка процесса
// доводит ответ. Перезапись кассеты — make ai-record SCENARIO=chat/accounts (тестовый провайдер, без сети).
import { contract, type ChatMessage } from "@kosht/contract";
import { makeScope, type Scope } from "@kosht/kernel";
import { cassetteFile, cassetteMode, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import type { ContractRouterClient } from "@orpc/contract";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  composeOnTestDb,
  type TestComposition,
} from "../../../main/__fixtures__/compose-on-test-db.ts";
import type { HttpContext } from "../../../platform/http/procedures.ts";

const SCENARIO = "chat/accounts";
// Кассета ключуется последним сообщением, а в нём — блок <context> с сегодняшним днём и «вчера» (AGT-03): без
// замороженной даты запись «устаревает» на следующий день. Замораживаем только Date: таймеры и сокеты БД идут как идут.
const RECORDED_AT = new Date("2026-10-31T09:00:00Z");
const QUESTION = "Какие у меня счета?";

let db: TestDb;
/** Повтор кассеты без пауз (быстро) и с паузами записи (виден поток — для «Стоп» и остановки). */
let fast: TestComposition;
let paced: TestComposition;
let a: { scope: Scope; accountId: string };
let b: { scope: Scope };

const cassette = (mode: "record" | "replay", delays: boolean) => ({
  LLM_MODE: mode,
  LLM_CASSETTE: cassetteFile(import.meta.url, SCENARIO),
  LLM_CASSETTE_DELAYS: delays ? "1" : "0",
});

/** Метаданные запуска из первого куска (start). */
function metaOf(chunk: Chunk | undefined): { runId: string; conversationId: string } {
  const meta = chunk?.["messageMetadata"] as { runId: string; conversationId: string } | undefined;
  if (meta === undefined) throw new Error("нет метаданных запуска");
  return meta;
}

async function seed(n: number): Promise<{ scope: Scope; accountId: string }> {
  const scope = testScope({ user: n, household: n });
  const { rows } = await db.owner.query<{ id: string }>(
    "insert into accounts (household_id, user_id, kind) values ($1, $2, 'cash') returning id",
    [scope.householdId, scope.userId],
  );
  return { scope: makeScope(scope), accountId: rows[0]?.id ?? "" };
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: RECORDED_AT });
  db = await createTestDb();
  a = await seed(1);
  b = await seed(2);
  // make ai-record SCENARIO=chat/accounts: один полный запуск пишет кассету с паузами тестового провайдера
  // (их повторяет e2e), дальше все тесты — повтор записи.
  if (cassetteMode(SCENARIO) === "record") {
    const recorder = await composeOnTestDb(db, "api", cassette("record", false));
    await collect(await client(recorder, a.scope).chat.send({ text: QUESTION }));
    await recorder.close();
  }
  fast = await composeOnTestDb(db, "api", cassette("replay", false));
  paced = await composeOnTestDb(db, "api", cassette("replay", true));
});

afterAll(async () => {
  vi.useRealTimers();
  await fast.close();
  await paced.close().catch(() => undefined);
  await db.drop();
});

function client(composition: TestComposition, scope: Scope) {
  const context: HttpContext = {
    requestId: "chat-test",
    listener: "local",
    session: async () => ({ s: composition.composition.platform.scoped(scope), role: "user" }),
    shutdownSignal: new AbortController().signal,
  };
  // Ветки модулей приходят реестром (запись по строковому ключу): тип клиента — по контракту.
  return createRouterClient(composition.composition.router, {
    context,
  }) as unknown as ContractRouterClient<typeof contract>;
}

type Chunk = { type: string } & Record<string, unknown>;

async function collect(iterator: AsyncIterable<Chunk>, until?: (chunk: Chunk) => boolean) {
  const chunks: Chunk[] = [];
  for await (const chunk of iterator) {
    chunks.push(chunk);
    if (until?.(chunk) === true) break;
  }
  return chunks;
}

const lastAnswer = async (composition: TestComposition, scope: Scope): Promise<ChatMessage> => {
  const { messages } = await client(composition, scope).chat.history();
  const answer = messages.at(-1);
  if (answer?.role !== "assistant") throw new Error("нет ответа ассистента");
  return answer;
};

describe("CHAT-02: поток ответа на кассете", () => {
  it("start с runId и диалогом → шаг list_accounts с «Наличными» A → текст → finish; ответ сохранён", async () => {
    const chunks = await collect(await client(fast, a.scope).chat.send({ text: QUESTION }));
    expect(chunks[0]).toMatchObject({
      type: "start",
      messageMetadata: { runId: expect.any(String), conversationId: expect.any(String) },
    });
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: "tool-input-available", toolName: "list_accounts" }),
    );
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-output-available",
        output: expect.objectContaining({
          items: [expect.objectContaining({ id: a.accountId, kind: "cash" })],
        }),
      }),
    );
    expect(
      chunks
        .filter((c) => c.type === "text-delta")
        .map((c) => c["delta"])
        .join(""),
    ).toBe("Вот ваши счета: остаток каждого — на карточке ниже.");
    expect(chunks.at(-1)).toMatchObject({ type: "finish" });
    const answer = await lastAnswer(fast, a.scope);
    expect(answer.status).toBe("complete");
    expect(answer.parts.map((p) => p.type)).toEqual(
      expect.arrayContaining(["tool-list_accounts", "text"]),
    );
  });

  it("вкладку закрыли после первого куска — ответ дописан в БД и виден в истории", async () => {
    const stream = await client(fast, a.scope).chat.send({ text: QUESTION });
    await collect(stream, () => true);
    await stream.return?.(undefined);
    await vi.waitFor(
      async () => expect((await lastAnswer(fast, a.scope)).status).toBe("complete"),
      {
        timeout: 10_000,
        interval: 100,
      },
    );
    expect((await lastAnswer(fast, a.scope)).parts).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: "Вот ваши счета: остаток каждого — на карточке ниже.",
      }),
    );
  });

  it("продолжение диалога: чужой conversationId — NOT_FOUND, свой — тот же диалог", async () => {
    const first = await collect(await client(fast, a.scope).chat.send({ text: QUESTION }));
    const meta = metaOf(first[0]);
    const foreign = client(fast, b.scope).chat.send({
      conversationId: meta.conversationId as never,
      text: QUESTION,
    });
    await expect(foreign).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { conversationId } = await client(fast, a.scope).chat.history();
    expect(conversationId).toBe(meta.conversationId);
  });
});

describe("CHAT-02: «Стоп» и остановка процесса", () => {
  it("«Стоп» по runId: чужой домохозяйство — NOT_FOUND; своё — поток кончается, ответ «оборван»", async () => {
    const stream = await client(paced, a.scope).chat.send({ text: QUESTION });
    const [start] = await collect(stream, () => true);
    const { runId } = metaOf(start);
    await expect(client(paced, b.scope).chat.stop({ runId: runId as never })).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
      },
    );
    expect(await client(paced, a.scope).chat.stop({ runId: runId as never })).toEqual({ ok: true });
    await collect(stream);
    await vi.waitFor(
      async () => expect((await lastAnswer(paced, a.scope)).status).toBe("interrupted"),
      {
        timeout: 10_000,
        interval: 100,
      },
    );
    await expect(client(paced, a.scope).chat.stop({ runId: runId as never })).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
      },
    );
  });

  it("остановка процесса (close) доводит идущий ответ и сохраняет его", async () => {
    const stream = await client(paced, a.scope).chat.send({ text: QUESTION });
    await collect(stream, () => true);
    await paced.close();
    expect((await lastAnswer(fast, a.scope)).status).toBe("complete");
  });
});
