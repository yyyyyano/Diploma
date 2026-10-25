import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryLogger, type MemoryLog } from "../logging/__fixtures__/memory-logger.ts";
import { createApp } from "./app.ts";
import { createListeners, LAN_CHECK_MS, ListenError, type Listeners } from "./listeners.ts";

const LOOPBACK = "127.0.0.1";
const started: Listeners[] = [];
const blockers: Server[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(started.splice(0).map(async (listeners) => listeners.stop(0)));
  await Promise.all(
    blockers.splice(0).map(async (server) => new Promise((done) => server.close(done))),
  );
});

/** Занять порт, чтобы проверить «порт занят». */
async function occupyPort(): Promise<number> {
  const server = createServer();
  blockers.push(server);
  await new Promise<void>((done) => server.listen(0, LOOPBACK, done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("нет адреса");
  return address.port;
}

interface Setup {
  readonly listeners: Listeners;
  readonly memory: MemoryLog;
  /** Запрос /slow дошёл до обработчика. */
  readonly arrived: Promise<void>;
  /** Запрос /slow ждёт, пока тест не отпустит его. */
  readonly release: () => void;
}

function setup(
  allowLan: () => Promise<boolean>,
  ports: { local?: number; lan?: number } = {},
): Setup {
  const memory = memoryLogger();
  let release: () => void = () => {};
  let arrive: () => void = () => {};
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const listeners = createListeners({
    local: { host: LOOPBACK, port: ports.local ?? 0 },
    lan: { host: LOOPBACK, port: ports.lan ?? 0 },
    allowLan,
    log: memory.log,
    fetch: (listener) =>
      createApp({
        listener,
        trustedOrigins: [],
        log: memory.log,
        ready: async () => {},
        routes: (app) => {
          app.get("/slow", async (c) => {
            arrive();
            await gate;
            return c.json({ done: true });
          });
        },
      }).fetch,
  });
  started.push(listeners);
  return { listeners, memory, arrived, release: () => release() };
}

function url(listeners: Listeners, listener: "local" | "lan", path: string): string {
  const port = listeners.address(listener)?.port;
  if (port === undefined) throw new Error(`слушатель ${listener} закрыт`);
  return `http://${LOOPBACK}:${port}${path}`;
}

describe("NFR-24: слушатели local и lan", () => {
  it("local открыт на порту 0 (свободный), lan по умолчанию закрыт", async () => {
    const { listeners } = setup(async () => false);
    await listeners.start();
    const port = listeners.address("local")?.port ?? 0;
    expect(port).toBeGreaterThan(0);
    expect([8140, 8141]).not.toContain(port);
    expect((await fetch(url(listeners, "local", "/healthz"))).status).toBe(200);
    expect(listeners.address("lan")).toBeUndefined();
  });

  it("строка http.listening — с именем слушателя и настоящим портом", async () => {
    const { listeners, memory } = setup(async () => true);
    await listeners.start();
    const lines = memory.lines().filter((line) => line["msg"] === "http.listening");
    expect(lines).toEqual([
      expect.objectContaining({ listener: "local", port: listeners.address("local")?.port }),
      expect.objectContaining({ listener: "lan", port: listeners.address("lan")?.port }),
    ]);
  });

  it("сверка с настройкой — каждую секунду: включили — lan открылся, выключили — закрылся", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let allow = false;
    const allowLan = vi.fn<() => Promise<boolean>>(async () => allow);
    const { listeners } = setup(allowLan);
    await listeners.start();
    expect(allowLan).toHaveBeenCalledTimes(1);

    allow = true;
    await vi.advanceTimersByTimeAsync(LAN_CHECK_MS);
    await listeners.reconcile();
    expect(allowLan).toHaveBeenCalledTimes(3);
    const lanUrl = url(listeners, "lan", "/healthz");
    expect((await fetch(lanUrl)).status).toBe(200);

    allow = false;
    await vi.advanceTimersByTimeAsync(LAN_CHECK_MS);
    await listeners.reconcile();
    expect(listeners.address("lan")).toBeUndefined();
    await expect(fetch(lanUrl)).rejects.toThrow("fetch failed");
  });

  it("занятый локальный порт — понятная ошибка с переменной и портом", async () => {
    const port = await occupyPort();
    const { listeners } = setup(async () => false, { local: port });
    const error: unknown = await listeners.start().catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ListenError);
    expect((error as Error).message).toContain(`${LOOPBACK}:${port}`);
    expect((error as Error).message).toContain("LISTEN_LOCAL_PORT");
    expect((error as Error).message).toContain("порт занят");
  });

  it("занятый сетевой порт — процесс не падает: http.lan-failed и повтор на следующей сверке", async () => {
    const port = await occupyPort();
    const { listeners, memory } = setup(async () => true, { lan: port });
    await listeners.start();
    expect(listeners.address("lan")).toBeUndefined();
    expect(memory.lines()).toContainEqual(
      expect.objectContaining({
        msg: "http.lan-failed",
        code: "EADDRINUSE",
        listener: "lan",
        port,
      }),
    );

    const blocker = blockers.pop();
    await new Promise((done) => blocker?.close(done));
    await listeners.reconcile();
    expect(listeners.address("lan")?.port).toBe(port);
  });

  it("сбой чтения настройки — строка в логе, lan не трогается", async () => {
    const { listeners, memory } = setup(async () => {
      throw new Error("БД недоступна");
    });
    await listeners.start();
    expect(listeners.address("local")).toBeDefined();
    expect(memory.lines()).toContainEqual(
      expect.objectContaining({ msg: "http.lan-check-failed", setting: "network.allow-lan" }),
    );
  });
});

describe("остановка: запрос в полёте доводится, новые соединения не принимаются", () => {
  it("stop ждёт запрос в полёте, а новое соединение отвергается сразу", async () => {
    const { listeners, arrived, release } = setup(async () => false);
    await listeners.start();
    const healthz = url(listeners, "local", "/healthz");
    const inFlight = fetch(url(listeners, "local", "/slow"));
    await arrived;

    const stopping = listeners.stop(10_000);
    await vi.waitFor(async () => {
      await expect(fetch(healthz, { headers: { connection: "close" } })).rejects.toThrow(
        "fetch failed",
      );
    });
    release();
    const response = await inFlight;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ done: true });
    await stopping;
  });

  it("запрос дольше graceMs обрывается, и остановка завершается", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const { listeners, arrived } = setup(async () => false);
    await listeners.start();
    const inFlight = fetch(url(listeners, "local", "/slow")).then(
      () => "ответ",
      () => "оборван",
    );
    await arrived;

    const stopping = listeners.stop(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await stopping;
    expect(await inFlight).toBe("оборван");
  });
});
