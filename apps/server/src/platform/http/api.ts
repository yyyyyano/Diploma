// Процедуры oRPC под /api (ADR-0005): OpenAPIHandler отдаёт дерево контракта как REST (сайт, curl, тесты).
// Перевод ошибок — в одном месте (ARCHITECTURE §9, OBS-02): каждая ошибка процедуры становится ORPCError с кодом
// каталога, `message` = код и `data: { requestId, params }` — без текста исключения, стека и issues со значениями:
// - вход не прошёл схему → VALIDATION (без issues: в них значения из запроса);
// - AppError → его код (toErrorBody);
// - выход не прошёл схему, ISOLATION_VIOLATION и всё прочее → INTERNAL, а стек — в лог (http.error);
// - запрос не разобран (битый JSON) — до вызова процедуры → VALIDATION.
// Ловят два перехватчика oRPC: clientInterceptors — вокруг вызова процедуры (middleware, схемы, обработчик),
// interceptors — вокруг всего запроса (разбор тела до процедуры, кодирование ответа после неё).
import { ERRORS, ErrorData, type ErrorCode } from "@kosht/contract";
import type { AnyContractRouter } from "@orpc/contract";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { ORPCError, ValidationError, type Router } from "@orpc/server";
import { RequestHeadersPlugin, ResponseHeadersPlugin } from "@orpc/server/plugins";
import { AppError } from "../errors/app-error.ts";
import type { Logger } from "../logging/logger.ts";
import { httpErrorBody } from "./error-response.ts";
import type { HttpContext } from "./procedures.ts";

/** Префикс процедур: GET /api/system/health. */
export const API_PREFIX = "/api";

export interface ApiHandler {
  /** Ответ процедуры или undefined, если такой процедуры нет. */
  handle(request: Request, context: HttpContext): Promise<Response | undefined>;
}

/** Ошибка уже в нашей форме: код каталога, его статус, message = код, данные по ErrorData. */
function isMapped(error: unknown): error is ORPCError<ErrorCode, unknown> {
  return (
    error instanceof ORPCError &&
    Object.hasOwn(ERRORS, error.code) &&
    error.message === error.code &&
    error.status === ERRORS[error.code as ErrorCode].status &&
    ErrorData.safeParse(error.data).success
  );
}

function rpcError(error: unknown, requestId: string): ORPCError<ErrorCode, unknown> {
  const body = httpErrorBody(error, requestId);
  return new ORPCError(body.code, {
    status: body.status,
    message: body.message,
    data: body.data,
  });
}

/** Ошибка процедуры → ORPCError каталога; INTERNAL пишется в лог со стеком. */
export function mapProcedureError(
  error: unknown,
  requestId: string,
  log: Logger,
): ORPCError<ErrorCode, unknown> {
  if (isMapped(error)) return error;
  if (
    error instanceof ORPCError &&
    error.code === "BAD_REQUEST" &&
    error.cause instanceof ValidationError
  ) {
    return rpcError(new AppError("VALIDATION"), requestId);
  }
  const mapped = rpcError(error, requestId);
  if (mapped.code === "INTERNAL") log.error({ err: error, code: mapped.code }, "http.error");
  return mapped;
}

export function createApiHandler(
  router: Router<AnyContractRouter, HttpContext>,
  log: Logger,
): ApiHandler {
  // Запросы, дошедшие до вызова процедуры: ошибка «до» — разбор запроса (клиент), «после» — кодирование (сервер).
  const called = new WeakSet<HttpContext>();
  const handler = new OpenAPIHandler<HttpContext>(router, {
    // context.reqHeaders и context.resHeaders: вход и выход читают cookie запроса и отдают Set-Cookie сессии
    // (T-009, ADR-0016).
    plugins: [new RequestHeadersPlugin(), new ResponseHeadersPlugin()],
    clientInterceptors: [
      async (options) => {
        const { context } = options;
        called.add(context);
        try {
          return await options.next();
        } catch (error) {
          throw mapProcedureError(error, context.requestId, log);
        }
      },
    ],
    interceptors: [
      async (options) => {
        const { context } = options;
        try {
          return await options.next();
        } catch (error) {
          if (isMapped(error)) throw error;
          if (!called.has(context)) throw rpcError(new AppError("VALIDATION"), context.requestId);
          throw mapProcedureError(error, context.requestId, log);
        }
      },
    ],
  });
  return {
    async handle(request, context) {
      const result = await handler.handle(request, { prefix: API_PREFIX, context });
      return result.matched ? result.response : undefined;
    },
  };
}
