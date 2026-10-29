// PRIV-06, OBS-05: удаление трасс пользователя в Langfuse — поиск traceId через Observations API v2 окнами по 30 дней,
// удаление пачками до 1000; Langfuse отвечает не 2xx — ошибка (вызывающий ставит в очередь повторов). Сеть не нужна:
// fetch подменён записывающим поддельным Langfuse.
import { FakeClock } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { createLangfuseTraceDeleter, LangfuseApiError, PAGE_LIMIT } from "./langfuse-traces.ts";

const NOW = "2026-10-26T09:00:00Z";
const target = {
  baseUrl: "http://127.0.0.1:3001/",
  publicKey: "pk-lf-test",
  secretKey: () => "sk-lf-test",
};

interface Observation {
  readonly traceId: string;
  readonly startTime: number;
  readonly userId: string;
}

/** Поддельный Langfuse: наблюдения в памяти, страницы по курсору, запись удалений и заголовков. */
function fakeLangfuse(observations: readonly Observation[], status = 200) {
  const deleted: string[][] = [];
  const requests: { method: string; path: string; authorization: string | null }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers);
    requests.push({
      method: init?.method ?? "GET",
      path: url.pathname,
      authorization: headers.get("authorization"),
    });
    if (status !== 200) return new Response("{}", { status });
    if (init?.method === "DELETE") {
      deleted.push(
        (JSON.parse(typeof init.body === "string" ? init.body : "{}") as { traceIds: string[] })
          .traceIds,
      );
      return Response.json({ message: "ok" });
    }
    const from = Date.parse(url.searchParams.get("fromStartTime") ?? "");
    const to = Date.parse(url.searchParams.get("toStartTime") ?? "");
    const limit = Number(url.searchParams.get("limit"));
    const offset = Number(url.searchParams.get("cursor") ?? "0");
    const matching = observations.filter(
      (o) =>
        (url.searchParams.get("userId") === null || o.userId === url.searchParams.get("userId")) &&
        o.startTime >= from &&
        o.startTime < to,
    );
    const page = matching.slice(offset, offset + limit);
    const next = offset + limit < matching.length ? String(offset + limit) : null;
    return Response.json({
      data: page.map((o) => ({ id: `obs-${o.traceId}`, traceId: o.traceId })),
      meta: { cursor: next },
    });
  };
  return { fetch, deleted, requests };
}

const DAY = 86_400_000;
const now = Date.parse(NOW);

describe("PRIV-06, OBS-05: удаление трасс пользователя в Langfuse", () => {
  it("1200 трасс по 2 наблюдения — две пачки удаления 1000 + 200, чужие трассы не тронуты", async () => {
    const own = Array.from({ length: 1200 }, (_, i) => [
      { traceId: `t-${String(i)}`, startTime: now - 1000 - i, userId: "user-a" },
      { traceId: `t-${String(i)}`, startTime: now - 2000 - i, userId: "user-a" },
    ]).flat();
    const foreign = { traceId: "t-foreign", startTime: now - 1000, userId: "user-b" };
    const langfuse = fakeLangfuse([...own, foreign]);
    const deleter = createLangfuseTraceDeleter(target, {
      clock: new FakeClock(NOW),
      fetch: langfuse.fetch,
    });

    expect(await deleter.deleteUserTraces("user-a")).toBe(1200);
    expect(langfuse.deleted.map((batch) => batch.length)).toEqual([1000, 200]);
    expect(langfuse.deleted.flat()).not.toContain("t-foreign");
    expect(new Set(langfuse.deleted.flat()).size).toBe(1200);
    // 2400 наблюдений текущего окна — три страницы по курсору, затем пустое прошлое окно.
    expect(own.length).toBeGreaterThan(2 * PAGE_LIMIT);
    expect(langfuse.requests.filter((r) => r.method === "GET")).toHaveLength(4);
  });

  it("трассы старше первого окна находятся; первое пустое окно после текущего — конец поиска", async () => {
    const langfuse = fakeLangfuse([
      { traceId: "t-old", startTime: now - 40 * DAY, userId: "user-a" },
      { traceId: "t-very-old", startTime: now - 200 * DAY, userId: "user-a" },
    ]);
    const deleter = createLangfuseTraceDeleter(target, {
      clock: new FakeClock(NOW),
      fetch: langfuse.fetch,
    });
    expect(await deleter.deleteUserTraces("user-a")).toBe(1);
    expect(langfuse.deleted).toEqual([["t-old"]]);
    // Окна: текущее (пусто), прошлое (t-old), позапрошлое (пусто) — стоп.
    expect(langfuse.requests.filter((r) => r.method === "GET")).toHaveLength(3);
  });

  it("трасс нет — два окна запроса и ни одного удаления; заголовок — Basic с ключами проекта", async () => {
    const langfuse = fakeLangfuse([]);
    const deleter = createLangfuseTraceDeleter(target, {
      clock: new FakeClock(NOW),
      fetch: langfuse.fetch,
    });
    expect(await deleter.deleteUserTraces("user-a")).toBe(0);
    expect(langfuse.requests).toEqual([
      expect.objectContaining({ method: "GET", path: "/api/public/v2/observations" }),
      expect.objectContaining({ method: "GET", path: "/api/public/v2/observations" }),
    ]);
    expect(langfuse.requests[0]?.authorization).toBe(
      `Basic ${Buffer.from("pk-lf-test:sk-lf-test").toString("base64")}`,
    );
  });

  it("Langfuse отвечает 503 — LangfuseApiError без ключей и данных в тексте", async () => {
    const langfuse = fakeLangfuse([], 503);
    const deleter = createLangfuseTraceDeleter(target, {
      clock: new FakeClock(NOW),
      fetch: langfuse.fetch,
    });
    const error = await deleter.deleteUserTraces("user-a").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LangfuseApiError);
    expect(String(error)).not.toMatch(/sk-lf|user-a/);
  });
});

describe("OBS-05: трассы старше срока хранения", () => {
  it("удаляются трассы всех пользователей старше момента, свежие остаются", async () => {
    const cutoff = now - 30 * DAY;
    const langfuse = fakeLangfuse([
      { traceId: "старая-1", startTime: cutoff - 2 * DAY, userId: "u1" },
      { traceId: "старая-2", startTime: cutoff - 3 * DAY, userId: "u2" },
      { traceId: "свежая", startTime: cutoff + DAY, userId: "u1" },
    ]);
    const deleter = createLangfuseTraceDeleter(target, {
      clock: new FakeClock(NOW),
      fetch: langfuse.fetch,
    });
    expect(await deleter.deleteTracesBefore(new Date(cutoff))).toBe(2);
    expect(langfuse.deleted.flat().toSorted()).toEqual(["старая-1", "старая-2"]);
  });

  it("пачки удаления не больше 1000 трасс", async () => {
    const cutoff = now - 30 * DAY;
    const many = Array.from({ length: 2300 }, (_, i) => ({
      traceId: `t${String(i)}`,
      startTime: cutoff - DAY,
      userId: "u1",
    }));
    const langfuse = fakeLangfuse(many);
    const deleter = createLangfuseTraceDeleter(target, {
      clock: new FakeClock(NOW),
      fetch: langfuse.fetch,
    });
    expect(await deleter.deleteTracesBefore(new Date(cutoff))).toBe(2300);
    expect(langfuse.deleted.map((batch) => batch.length)).toEqual([1000, 1000, 300]);
  });

  it("Langfuse не ответил — ошибка наружу (ночная задача повторит завтра)", async () => {
    const deleter = createLangfuseTraceDeleter(target, {
      clock: new FakeClock(NOW),
      fetch: fakeLangfuse([], 500).fetch,
    });
    await expect(deleter.deleteTracesBefore(new Date(now))).rejects.toBeInstanceOf(
      LangfuseApiError,
    );
  });
});
