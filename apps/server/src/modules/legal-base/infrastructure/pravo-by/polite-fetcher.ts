// Вежливый загрузчик pravo.by (LAW-35…38, ADR-0012): один поток, 3–5 с между запросами (очередь слотов в БД — пауза
// переживает перезапуск и общая для всех процессов), сжатие, честный User-Agent с контактом оператора, robots.txt раз в
// сутки и проверка каждого адреса, лесенка повторов 30 с / 2 мин / 10 мин, остановка цикла до следующих суток при
// 403/429 или более 20% ошибок. Время — только Clock, ожидание — порт sleep (тесты двигают FakeClock).
// Контакт в лог и журнал не пишется (OBS-04): он только в заголовке User-Agent.
import type { Clock } from "@kosht/kernel";
import type { Logger } from "../../../../platform/logging/logger.ts";
import { parseRobots } from "./robots.ts";
import {
  LoaderStopped,
  PageTooLarge,
  RobotsDenied,
  SourceUnavailable,
  type LoaderStore,
  type RequestRecord,
} from "../../application/ports.ts";

/** Версия загрузчика в User-Agent. */
export const LOADER_VERSION = "0.1";
/** Лесенка повторов при 5xx и таймаутах (LAW-38). */
export const RETRY_LADDER_MS: readonly number[] = [30_000, 120_000, 600_000];
/** Доля ошибок за цикл, выше которой цикл останавливается (LAW-38), и минимум запросов, с которого она считается. */
export const MAX_ERROR_SHARE = 0.2;
export const MIN_REQUESTS_FOR_SHARE = 10;
/** robots.txt обновляется раз в сутки (LAW-37). */
const ROBOTS_TTL_MS = 24 * 3_600_000;
const MAX_REDIRECTS = 3;

export interface FetcherSettings {
  /** Пауза между запросами, мс: выбирается случайно в этих пределах (LAW-35: 3–5 с). */
  readonly pauseMinMs: number;
  readonly pauseMaxMs: number;
  readonly timeoutMs: number;
  readonly maxPageBytes: number;
}

export interface PoliteFetcherDeps {
  readonly fetch: typeof fetch;
  readonly clock: Clock;
  /** Ожидание: боевое — таймер с отменой по signal, тестовое — сдвиг FakeClock. */
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly random: () => number;
  /** Контакт оператора (LAW-36): читается при каждом запросе — смена действует сразу. */
  readonly contact: () => Promise<string>;
  readonly settings: () => Promise<FetcherSettings>;
  readonly store: LoaderStore;
  readonly log: Logger;
}

export interface Fetched {
  readonly status: number;
  readonly body: string;
  readonly fetchedAt: Date;
}

/** «Kosht/0.1 (+mailto:admin@example.org)» — для email; адрес сайта — как есть. Под браузер не маскируемся. */
export function userAgentFor(contact: string): string {
  const value = contact.trim();
  const ref = /^https?:\/\//iu.test(value) ? value : `mailto:${value}`;
  return `Kosht/${LOADER_VERSION} (+${ref})`;
}

/** Кодировка тела: из Content-Type, затем из <meta> первых 2 КБ, иначе UTF-8 (сломанную увидит карантин, LAW-39). */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const header = /charset=["']?([\w-]+)/iu.exec(contentType ?? "")?.[1];
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const meta = /<meta[^>]+charset=["']?([\w-]+)/iu.exec(head)?.[1];
  for (const label of [header, meta]) {
    if (label === undefined) continue;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // Неизвестная кодировка в заголовке — пробуем следующий источник, затем UTF-8.
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** Адрес в журнал: путь и p0 страницы — без остальных параметров. */
export function loggedUrl(url: URL): string {
  const p0 = url.searchParams.get("p0");
  return `${url.pathname}${p0 === null ? "" : `?p0=${p0}`}`;
}

export function createPoliteFetcher(deps: PoliteFetcherDeps) {
  const { clock, store, log } = deps;

  async function readCapped(response: Response, max: number): Promise<Uint8Array> {
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > max) throw new PageTooLarge();
    const reader = response.body?.getReader();
    if (reader === undefined) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new PageTooLarge();
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.byteLength;
    }
    return out;
  }

  /** Одна попытка: слот в очереди → ожидание → запрос → запись в журнал; 403/429 и доля ошибок останавливают цикл. */
  async function attempt(
    url: URL,
    userAgent: string,
    settings: FetcherSettings,
    signal?: AbortSignal,
  ): Promise<
    { response: Response; bytes: Uint8Array } | { transient: true; status: number | null }
  > {
    const pause =
      settings.pauseMinMs +
      Math.floor(deps.random() * (settings.pauseMaxMs - settings.pauseMinMs + 1));
    const slot = await store.reserveSlot(clock.now(), pause);
    const wait = slot.getTime() - clock.now().getTime();
    if (wait > 0) await deps.sleep(wait, signal);
    const started = clock.now();
    let response: Response | undefined;
    let bytes: Uint8Array | undefined;
    let outcome = "ok";
    try {
      response = await deps.fetch(url, {
        redirect: "manual",
        headers: {
          "User-Agent": userAgent,
          "Accept-Encoding": "gzip, br",
          Accept: "text/html,text/plain;q=0.9",
        },
        signal:
          signal === undefined
            ? AbortSignal.timeout(settings.timeoutMs)
            : AbortSignal.any([signal, AbortSignal.timeout(settings.timeoutMs)]),
      });
      bytes =
        response.status >= 300 && response.status < 400
          ? new Uint8Array()
          : await readCapped(response, settings.maxPageBytes);
    } catch (error) {
      if (error instanceof PageTooLarge) outcome = "too-large";
      else if (signal?.aborted === true) throw error;
      else outcome = "network";
      if (error instanceof PageTooLarge) {
        await finish(url, started, response?.status ?? null, null, outcome, false);
        throw error;
      }
    }
    const status = response?.status ?? null;
    if (status !== null && status >= 500) outcome = "http-5xx";
    const transient = outcome === "network" || outcome === "http-5xx";
    const isError = transient || status === 403 || status === 429;
    if (status === 403 || status === 429) outcome = status === 403 ? "http-403" : "http-429";
    await finish(url, started, status, bytes?.byteLength ?? null, outcome, isError);
    if (status === 403 || status === 429) {
      await store.stop(clock.today(), "LOADER_BLOCKED");
      log.warn({ httpStatus: status }, "law.loader.blocked");
      throw new LoaderStopped("LOADER_BLOCKED");
    }
    if (transient || response === undefined || bytes === undefined)
      return { transient: true, status };
    return { response, bytes };
  }

  async function finish(
    url: URL,
    started: Date,
    httpStatus: number | null,
    bytes: number | null,
    outcome: string,
    isError: boolean,
  ): Promise<void> {
    const entry: RequestRecord = {
      at: started,
      url: loggedUrl(url),
      httpStatus,
      bytes,
      ms: clock.now().getTime() - started.getTime(),
      outcome,
      isError,
    };
    const { requests, errors } = await store.record(entry, clock.today());
    if (requests >= MIN_REQUESTS_FOR_SHARE && errors / requests > MAX_ERROR_SHARE) {
      await store.stop(clock.today(), "LOADER_TOO_MANY_ERRORS");
      log.warn({ count: errors, total: requests }, "law.loader.too-many-errors");
      throw new LoaderStopped("LOADER_TOO_MANY_ERRORS");
    }
  }

  /** Проверки перед запросом: контакт, остановка цикла. */
  async function ready(): Promise<string> {
    const contact = (await deps.contact()).trim();
    if (contact === "") {
      log.warn({}, "law.loader.contact-empty");
      throw new LoaderStopped("LOADER_CONTACT_EMPTY");
    }
    const state = await store.read();
    if (state.stoppedOn !== null && state.stopReason !== null) {
      if (state.stoppedOn === clock.today()) throw new LoaderStopped(state.stopReason);
      await store.resume();
    }
    return userAgentFor(contact);
  }

  /** robots.txt: из БД, не старше суток; иначе — запрос (сам он robots не проверяет). */
  async function robotsFor(
    site: URL,
    userAgent: string,
    settings: FetcherSettings,
    signal?: AbortSignal,
  ) {
    const state = await store.read();
    const fresh =
      state.robotsFetchedAt !== null &&
      clock.now().getTime() - state.robotsFetchedAt.getTime() < ROBOTS_TTL_MS;
    let text = state.robotsTxt ?? "";
    if (!fresh) {
      const got = await requestWithRetries(
        new URL("/robots.txt", site),
        userAgent,
        settings,
        signal,
      );
      // 404 — правил нет, всё разрешено; другие не-2xx до этого места не доходят (повтор или остановка).
      text = got.status === 200 ? got.body : "";
      await store.saveRobots(text, clock.now());
    }
    return parseRobots(new URL("/robots.txt", site).href, text);
  }

  async function requestWithRetries(
    url: URL,
    userAgent: string,
    settings: FetcherSettings,
    signal?: AbortSignal,
  ): Promise<Fetched> {
    let target = url;
    for (let hops = 0; hops <= MAX_REDIRECTS; hops += 1) {
      let result = await attempt(target, userAgent, settings, signal);
      for (const delay of RETRY_LADDER_MS) {
        if (!("transient" in result)) break;
        log.info({ ms: delay }, "law.loader.retry");
        await deps.sleep(delay, signal);
        result = await attempt(target, userAgent, settings, signal);
      }
      if ("transient" in result) throw new SourceUnavailable();
      const { response, bytes } = result;
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location !== null) {
        target = new URL(location, target);
        continue;
      }
      return {
        status: response.status,
        body: decodeBody(bytes, response.headers.get("content-type")),
        fetchedAt: clock.now(),
      };
    }
    throw new SourceUnavailable();
  }

  return {
    /** GET страницы с проверкой robots.txt; ответ любого кода, кроме 403/429/5xx, возвращается как есть (404 решает вызывающий). */
    async get(url: URL, signal?: AbortSignal): Promise<Fetched> {
      const userAgent = await ready();
      const settings = await deps.settings();
      const robots = await robotsFor(url, userAgent, settings, signal);
      if (robots.isAllowed(url.href, userAgent) === false) {
        await store.record(
          {
            at: clock.now(),
            url: loggedUrl(url),
            httpStatus: null,
            bytes: null,
            ms: 0,
            outcome: "robots-denied",
            isError: false,
          },
          clock.today(),
        );
        throw new RobotsDenied();
      }
      return requestWithRetries(url, userAgent, settings, signal);
    },
  };
}

export type PoliteFetcher = ReturnType<typeof createPoliteFetcher>;
