// HTTP-приложение одного слушателя (ADR-0005, NFR-24, R40): Hono — тонкая оболочка на веб-стандартах. На каждый
// слушатель — своё приложение createApp({ listener }): имя слушателя замкнуто здесь и попадает в контекст процедур,
// поэтому «это локальный вход» решается портом, на который пришло соединение, а не заголовками запроса.
// Порядок для каждого запроса: request-id и контекст лога → Host и CSRF (guard.ts) → маршрут → заголовки
// безопасности и строка http.request — на любом ответе, включая отказы и ошибки.
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AppError } from "../errors/app-error.ts";
import { withLogContext } from "../logging/context.ts";
import type { Logger } from "../logging/logger.ts";
import { API_PREFIX, type ApiHandler } from "./api.ts";
import { errorResponse, httpErrorBody } from "./error-response.ts";
import {
  isAllowedHost,
  isSameSiteRequest,
  requestIdFrom,
  SECURITY_HEADERS,
  type ListenerName,
} from "./guard.ts";
import type { Session } from "./session.ts";
import { siteResponse } from "./static-site.ts";

/** Переменные запроса Hono. */
export interface HttpEnv {
  readonly Variables: { readonly requestId: string };
}

export type HttpApp = Hono<HttpEnv>;

/** Приём файлов: единственная процедура, чьё тело — файлы, а не JSON (свой предел, SEC-03). */
export const UPLOAD_PATH = `${API_PREFIX}/files`;

/** /readyz ждёт ответа БД не дольше: зависшая база — «не готов», а не висящая проба контейнера. */
export const READY_TIMEOUT_MS = 2_000;

export interface ApiOptions {
  readonly handler: ApiHandler;
  /** Сессия по заголовкам запроса (openSession с реестром и пулом процесса). */
  readonly session: (headers: Headers) => Promise<Session | undefined>;
  /** Сигнал остановки процесса — в контекст процедур (долгие потоки завершаются). */
  readonly shutdownSignal: AbortSignal;
  /** Предел тела запроса процедур, байт (настройка BODY_LIMIT, body-limit.ts). */
  readonly bodyLimit: () => Promise<number>;
  /** Предел тела приёма файлов POST /api/files, байт (UPLOAD_BODY_LIMIT); не задан — действует bodyLimit. */
  readonly uploadBodyLimit?: () => Promise<number>;
}

export interface AppOptions {
  readonly listener: ListenerName;
  /** Origin, которым доверяют изменяющие запросы сверх своего Host (TRUSTED_ORIGINS). */
  readonly trustedOrigins: readonly string[];
  readonly log: Logger;
  /** Готовность к работе (БД отвечает); не готов — исключение. */
  readonly ready: () => Promise<void>;
  /** Процедуры oRPC под /api; без них /api отвечает NOT_FOUND. */
  readonly api?: ApiOptions;
  /** Корень собранного сайта (WEB_DIST_DIR); без него статики нет. */
  readonly webDistDir?: string;
  /** Дополнительные маршруты процесса — до статики сайта. */
  readonly routes?: (app: HttpApp) => void;
}

export function createApp(options: AppOptions): HttpApp {
  const { listener, log } = options;
  const app = new Hono<HttpEnv>();

  app.use(async (c, next) => {
    const started = performance.now();
    const requestId = requestIdFrom(c.req.header("x-request-id"));
    c.set("requestId", requestId);
    await withLogContext({ requestId, source: "http" }, async () => {
      const host = c.req.header("host");
      const allowed =
        isAllowedHost(host, listener) &&
        isSameSiteRequest({
          method: c.req.method,
          host,
          origin: c.req.header("origin"),
          secFetchSite: c.req.header("sec-fetch-site"),
          trustedOrigins: options.trustedOrigins,
        });
      if (allowed) {
        await next();
      } else {
        c.res = errorResponse(new AppError("FORBIDDEN"), requestId);
        log.warn({ method: c.req.method, listener }, "http.forbidden");
      }
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(name, value);
      c.res.headers.set("x-request-id", requestId);
      log.info(
        {
          method: c.req.method,
          httpStatus: c.res.status,
          ms: Math.round(performance.now() - started),
          listener,
        },
        "http.request",
      );
    });
  });

  // Проба живости контейнера: процесс отвечает — без БД.
  app.get("/healthz", (c) => c.json({ status: "ok" }));

  // Проба готовности: миграции применены до открытия слушателей, остаётся спросить БД. Детали сбоя — только в лог.
  app.get("/readyz", async (c) => {
    try {
      await withTimeout(options.ready(), READY_TIMEOUT_MS);
      return c.json({ status: "ok" });
    } catch (error) {
      log.warn({ err: error }, "http.not-ready");
      return errorResponse(new AppError("UNAVAILABLE"), c.get("requestId"));
    }
  });

  // Процедуры: имя слушателя — из замыкания, сессия — лениво и один раз на запрос. Неизвестная — NOT_FOUND в общей
  // форме ошибки, а не HTML и не страница сайта.
  const api = async (c: Context<HttpEnv>) => {
    const requestId = c.get("requestId");
    const notFound = () => errorResponse(new AppError("NOT_FOUND"), requestId);
    if (options.api === undefined) return notFound();
    const { handler, session, shutdownSignal } = options.api;
    let opened: Promise<Session | undefined> | undefined;
    const response = await handler.handle(c.req.raw, {
      requestId,
      listener,
      shutdownSignal,
      session: () => (opened ??= session(c.req.raw.headers)),
    });
    return response ?? notFound();
  };
  // Предел тела — до разбора процедурой: больше предела — VALIDATION через app.onError (тело не читается целиком).
  const limitBody = async (c: Context<HttpEnv>, next: () => Promise<void>) => {
    if (options.api === undefined) return next();
    const upload = c.req.method === "POST" && c.req.path === UPLOAD_PATH;
    const maxSize = await (upload && options.api.uploadBodyLimit !== undefined
      ? options.api.uploadBodyLimit()
      : options.api.bodyLimit());
    return bodyLimit({
      maxSize,
      onError: () => {
        throw new AppError("VALIDATION");
      },
    })(c, next);
  };
  app.use(API_PREFIX, limitBody);
  app.use(`${API_PREFIX}/*`, limitBody);
  app.all(API_PREFIX, api);
  app.all(`${API_PREFIX}/*`, api);

  options.routes?.(app);

  // Статика и SPA-fallback — только GET и HEAD (Hono отвечает на HEAD обработчиком GET без тела).
  const site = options.webDistDir;
  if (site !== undefined) {
    app.get("*", async (c) => {
      const response = await siteResponse(site, new URL(c.req.url).pathname);
      return response ?? errorResponse(new AppError("NOT_FOUND"), c.get("requestId"));
    });
  }

  app.notFound((c) => errorResponse(new AppError("NOT_FOUND"), c.get("requestId")));

  // Всё непредвиденное — INTERNAL без текста наружу; стек — в лог (OBS-02).
  app.onError((error, c) => {
    const body = httpErrorBody(error, c.get("requestId"));
    if (body.code === "INTERNAL") log.error({ err: error, code: body.code }, "http.error");
    return Response.json(body, { status: body.status });
  });

  return app;
}

function withTimeout(work: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
