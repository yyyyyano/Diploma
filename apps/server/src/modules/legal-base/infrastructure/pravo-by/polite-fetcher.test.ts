// LAW-35…38 на поддельном fetch, FakeClock и памяти вместо БД: пауза 3–5 с, честный User-Agent, пустой контакт, robots.txt
// (КП LAW), лесенка повторов, остановка на 403/429 и при более 20% ошибок. Сеть не используется.
import { LocalDate } from "@kosht/kernel";
import { FakeClock } from "@kosht/testing";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { memoryLogger } from "../../../../platform/logging/__fixtures__/memory-logger.ts";
import {
  LoaderStopped,
  RobotsDenied,
  SourceUnavailable,
  type LoaderState,
  type LoaderStore,
  type RequestRecord,
} from "../../application/ports.ts";
import {
  createPoliteFetcher,
  decodeBody,
  RETRY_LADDER_MS,
  userAgentFor,
} from "./polite-fetcher.ts";

const robotsTxt = readFileSync(
  new URL("../../__fixtures__/pravo-by/robots.txt", import.meta.url),
  "utf8",
);
const DOC = "https://pravo.by/document/?guid=3871&p0=H10200090";
const CONTACT = "operator@example.test";

/** Память вместо БД: те же правила аренды очереди и счётчиков, что у loader.repo.ts (его проверяет int-тест). */
function memoryStore(): LoaderStore & { log: RequestRecord[]; state: LoaderState } {
  let state: LoaderState = {
    stoppedOn: null,
    stopReason: null,
    robotsTxt: null,
    robotsFetchedAt: null,
    cycleDay: null,
    cycleRequests: 0,
    cycleErrors: 0,
  };
  let next: Date | null = null;
  let holder: Date | null = null;
  const log: RequestRecord[] = [];
  return {
    log,
    get state() {
      return state;
    },
    async tryAcquire(now, leaseMs) {
      if (next !== null && next.getTime() > now.getTime()) return next;
      holder = now;
      next = new Date(now.getTime() + leaseMs);
      return null;
    },
    async release(acquiredAt, end, pauseMs) {
      if (holder?.getTime() === acquiredAt.getTime()) next = new Date(end.getTime() + pauseMs);
    },
    async read() {
      return state;
    },
    async stop(day, reason) {
      state = { ...state, stoppedOn: day, stopReason: reason };
    },
    async resume() {
      state = { ...state, stoppedOn: null, stopReason: null };
    },
    async saveRobots(text, at) {
      state = { ...state, robotsTxt: text, robotsFetchedAt: at };
    },
    async record(entry, day) {
      log.push(entry);
      if (entry.outcome === "robots-denied") {
        return { requests: state.cycleRequests, errors: state.cycleErrors };
      }
      const same = state.cycleDay === day;
      state = {
        ...state,
        cycleDay: day,
        cycleRequests: (same ? state.cycleRequests : 0) + 1,
        cycleErrors: (same ? state.cycleErrors : 0) + (entry.isError ? 1 : 0),
      };
      return { requests: state.cycleRequests, errors: state.cycleErrors };
    },
  };
}

type Reply = { status: number; body?: string; headers?: Record<string, string> } | "timeout";

/** Поддельный fetch: ответы по порядку, запросы записываются вместе с заголовками. */
function fakeFetch(replies: (url: string) => Reply) {
  const calls: { url: string; headers: Record<string, string>; at: number }[] = [];
  return {
    calls,
    make(clock: FakeClock): typeof fetch {
      return (async (input: URL | string, init?: RequestInit) => {
        const url = String(input);
        calls.push({
          url,
          headers: init?.headers as Record<string, string>,
          at: clock.now().getTime(),
        });
        const reply = replies(url);
        if (reply === "timeout") throw new DOMException("timeout", "TimeoutError");
        return new Response(reply.body ?? "", {
          status: reply.status,
          ...(reply.headers === undefined ? {} : { headers: reply.headers }),
        });
      }) as typeof fetch;
    },
  };
}

function setup(opts: { replies: (url: string) => Reply; contact?: string; random?: () => number }) {
  const clock = new FakeClock("2026-10-30T09:00:00Z");
  const store = memoryStore();
  const fetcher = fakeFetch(opts.replies);
  const sleeps: number[] = [];
  const logger = memoryLogger();
  const loader = createPoliteFetcher({
    fetch: fetcher.make(clock),
    clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
    },
    random: opts.random ?? (() => 0),
    contact: async () => opts.contact ?? CONTACT,
    settings: async () => ({
      pauseMinMs: 3000,
      pauseMaxMs: 5000,
      timeoutMs: 1000,
      maxPageBytes: 2_000_000,
    }),
    store,
    log: logger.log,
  });
  return { clock, store, fetcher, sleeps, loader, logger };
}

const ok = (url: string): Reply =>
  url.endsWith("/robots.txt") ? { status: 200, body: robotsTxt } : { status: 200, body: "<html>" };

describe("LAW-35: пауза и поток", () => {
  it("между запросами проходит от 3 до 5 секунд", async () => {
    const t = setup({ replies: ok, random: () => 0.999 });
    await t.loader.get(new URL(DOC));
    await t.loader.get(new URL(`${DOC.slice(0, -1)}1`));
    const times = t.fetcher.calls.map((c) => c.at);
    // robots.txt, страница, страница: каждый следующий запрос — через паузу предыдущего слота.
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(3000);
    expect(times[1]! - times[0]!).toBeLessThanOrEqual(5000);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(3000);
    expect(times[2]! - times[1]!).toBeLessThanOrEqual(5000);
  });

  it("запрос просит сжатие и называется честным User-Agent с контактом", async () => {
    const t = setup({ replies: ok });
    await t.loader.get(new URL(DOC));
    const headers = t.fetcher.calls[1]?.headers;
    expect(headers?.["User-Agent"]).toBe(`Kosht/0.1 (+mailto:${CONTACT})`);
    expect(headers?.["Accept-Encoding"]).toContain("gzip");
    expect(userAgentFor("https://example.test/about")).toBe(
      "Kosht/0.1 (+https://example.test/about)",
    );
  });

  it("контакт не попадает ни в журнал запросов, ни в лог", async () => {
    const t = setup({ replies: ok });
    await t.loader.get(new URL(DOC));
    expect(JSON.stringify(t.store.log)).not.toContain(CONTACT);
    expect(t.logger.text()).not.toContain(CONTACT);
  });
});

describe("LAW-36: контакт оператора", () => {
  it("пустой контакт останавливает загрузчик: запросов нет", async () => {
    const t = setup({ replies: ok, contact: "  " });
    await expect(t.loader.get(new URL(DOC))).rejects.toMatchObject({
      reason: "LOADER_CONTACT_EMPTY",
    });
    expect(t.fetcher.calls).toHaveLength(0);
  });
});

describe("LAW-37: robots.txt", () => {
  it("запрещённый адрес поиска не запрашивается, адрес документа разрешён (КП LAW)", async () => {
    const t = setup({ replies: ok });
    const denied = new URL(
      "https://pravo.by/pravovaya-informatsiya/pravovye-akty-po-temam/poisk-v-tbd/?category=7",
    );
    await expect(t.loader.get(denied)).rejects.toBeInstanceOf(RobotsDenied);
    expect(t.fetcher.calls.map((c) => c.url)).toEqual(["https://pravo.by/robots.txt"]);
    await expect(t.loader.get(new URL(DOC))).resolves.toMatchObject({ status: 200 });
  });

  it("PDF официального опубликования запрещён", async () => {
    const t = setup({ replies: ok });
    await expect(
      t.loader.get(new URL("https://pravo.by/upload/docs/op/C22200062_1.pdf")),
    ).rejects.toBeInstanceOf(RobotsDenied);
  });

  it("robots.txt берётся раз в сутки: второй адрес за день его не запрашивает, на следующий день — снова", async () => {
    const t = setup({ replies: ok });
    await t.loader.get(new URL(DOC));
    await t.loader.get(new URL(DOC));
    expect(t.fetcher.calls.filter((c) => c.url.endsWith("/robots.txt"))).toHaveLength(1);
    t.clock.advance(25 * 3_600_000);
    await t.loader.get(new URL(DOC));
    expect(t.fetcher.calls.filter((c) => c.url.endsWith("/robots.txt"))).toHaveLength(2);
  });
});

describe("LAW-38: повторы и остановка", () => {
  it("5xx — повторы через 30 с, 2 мин, 10 мин, затем акт откладывается", async () => {
    const t = setup({ replies: (u) => (u.endsWith("/robots.txt") ? ok(u) : { status: 503 }) });
    await expect(t.loader.get(new URL(DOC))).rejects.toBeInstanceOf(SourceUnavailable);
    expect(t.sleeps.filter((ms) => RETRY_LADDER_MS.includes(ms))).toEqual([...RETRY_LADDER_MS]);
    expect(t.fetcher.calls.filter((c) => c.url === DOC)).toHaveLength(4);
  });

  it("таймаут повторяется, а удачный повтор возвращает страницу", async () => {
    let n = 0;
    const t = setup({
      replies: (u) => (u.endsWith("/robots.txt") ? ok(u) : ++n === 1 ? "timeout" : ok(u)),
    });
    await expect(t.loader.get(new URL(DOC))).resolves.toMatchObject({ status: 200 });
    expect(t.sleeps).toContain(30_000);
  });

  it.each([403, 429])("ответ %i останавливает цикл до следующих суток", async (status) => {
    const t = setup({ replies: (u) => (u.endsWith("/robots.txt") ? ok(u) : { status }) });
    await expect(t.loader.get(new URL(DOC))).rejects.toMatchObject({ reason: "LOADER_BLOCKED" });
    const before = t.fetcher.calls.length;
    await expect(t.loader.get(new URL(DOC))).rejects.toBeInstanceOf(LoaderStopped);
    expect(t.fetcher.calls).toHaveLength(before);
    // Следующие сутки по поясу системы: запросы снова идут.
    t.clock.advance(24 * 3_600_000);
    expect(LocalDate.compare(t.clock.today(), t.store.state.stoppedOn as LocalDate)).toBe(1);
  });

  it("после 403 в новый день загрузчик продолжает", async () => {
    let blocked = true;
    const t = setup({
      replies: (u) =>
        u.endsWith("/robots.txt") ? ok(u) : { status: blocked ? 403 : 200, body: "x" },
    });
    await expect(t.loader.get(new URL(DOC))).rejects.toBeInstanceOf(LoaderStopped);
    blocked = false;
    t.clock.advance(24 * 3_600_000);
    await expect(t.loader.get(new URL(DOC))).resolves.toMatchObject({ status: 200 });
    expect(t.store.state.stoppedOn).toBeNull();
  });

  it("больше 20% ошибок за цикл останавливают загрузчик, 20% ровно — ещё нет", async () => {
    let fail = 0;
    const t = setup({
      replies: (u) => {
        if (u.endsWith("/robots.txt")) return ok(u);
        return fail-- > 0 ? { status: 503 } : { status: 200, body: "x" };
      },
    });
    // 8 успехов и 2 ошибки из 10 запросов (+ robots = 11 записей): доля ниже предела — цикл идёт.
    for (let i = 0; i < 8; i += 1) await t.loader.get(new URL(DOC));
    expect(t.store.state.cycleErrors).toBe(0);
    fail = 3;
    await expect(t.loader.get(new URL(DOC))).rejects.toMatchObject({
      reason: "LOADER_TOO_MANY_ERRORS",
    });
  });
});

describe("кодировка ответа", () => {
  it("windows-1251 из заголовка и из <meta> читается верно", () => {
    const bytes = Uint8Array.from([0xd1, 0xf2, 0xe0, 0xf2, 0xfc, 0xff]);
    expect(decodeBody(bytes, "text/html; charset=windows-1251")).toBe("Статья");
    const withMeta = new Uint8Array([
      ...new TextEncoder().encode('<meta charset="windows-1251">'),
      ...bytes,
    ]);
    expect(decodeBody(withMeta, "text/html")).toContain("Статья");
    expect(decodeBody(new TextEncoder().encode("Статья"), null)).toBe("Статья");
  });
});
