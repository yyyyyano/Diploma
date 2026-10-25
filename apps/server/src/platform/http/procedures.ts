// Процедуры по доступу (ARCHITECTURE §9, ADR-0005, .claude/rules/api-contract.md): реализация контракта
// @kosht/contract всегда начинается с одной из четырёх — выбор осознанный и записывается в паспорт модуля:
// - publicProc — гость (вход, «База законов», проба health);
// - authed — сессия: context.s (ScopedDb домохозяйства) и context.role; нет сессии — UNAUTHORIZED;
// - localOnly — только локальный слушатель (первый запуск, почтовый ящик, демо-вход; R40, NFR-24): признак — имя
//   слушателя, замкнутое в createApp, а не IP и не Host. На lan такой процедуры «нет» — NOT_FOUND, как у
//   несуществующей: так из сети не узнать, что она есть. Сессию localOnly не требует — комбинируется явно;
// - admin — сессия с ролью admin, иначе FORBIDDEN.
// Проверки стоят на уровне роутера (до проверки входа схемой): отказ в доступе не раскрывает формат входа.
import { contract } from "@kosht/contract";
import { implement, os } from "@orpc/server";
import { AppError } from "../errors/app-error.ts";
import { withLogContext } from "../logging/context.ts";
import type { ListenerName } from "./guard.ts";
import type { Session } from "./session.ts";

/** Контекст каждой процедуры: собирает createApp на запрос. */
export interface HttpContext {
  readonly requestId: string;
  /** Слушатель, на который пришло соединение, — из замыкания createApp, а не из запроса. */
  readonly listener: ListenerName;
  /** Сессия запроса (лениво: publicProc её не открывает). */
  readonly session: () => Promise<Session | undefined>;
  /** Процесс останавливается (SIGTERM): долгие потоки (SSE) завершаются, чтобы не держать остановку. */
  readonly shutdownSignal: AbortSignal;
}

const base = os.$context<HttpContext>();

/** Сессия обязательна: в контекст — s и role; uid — в контекст лога (OBS-01). */
export const requireSession = base.middleware(async ({ context, next }) => {
  const session = await context.session();
  if (session === undefined) throw new AppError("UNAUTHORIZED");
  return withLogContext({ uid: session.s.scope.userId }, () =>
    next({ context: { s: session.s, role: session.role } }),
  );
});

/** Только локальный слушатель; на сетевом процедуры нет (NOT_FOUND). */
export const requireLocal = base.middleware(async ({ context, next }) => {
  if (context.listener !== "local") throw new AppError("NOT_FOUND");
  return next();
});

/** Только администратор (после requireSession). */
export const requireAdmin = os
  .$context<HttpContext & Pick<Session, "role">>()
  .middleware(async ({ context, next }) => {
    if (context.role !== "admin") throw new AppError("FORBIDDEN");
    return next();
  });

const implementer = implement(contract).$context<HttpContext>();

export const publicProc = implementer;
export const authed = implementer.use(requireSession);
export const localOnly = implementer.use(requireLocal);
export const admin = implementer.use(requireSession).use(requireAdmin);
