// Мини-контракт и роутер для тестов platform/http: в боевом контракте ещё нет процедур localOnly и admin, а у
// проверок ошибок нужны процедуры, которые ломаются нарочно. Процедуры собираются теми же middleware, что и боевые.
import { pickErrors } from "@kosht/contract";
import { oc } from "@orpc/contract";
import { implement } from "@orpc/server";
import { z } from "zod";
import { AppError } from "../../errors/app-error.ts";
import { requireAdmin, requireLocal, requireSession, type HttpContext } from "../procedures.ts";

export const miniContract = {
  echo: oc
    .route({ method: "POST", path: "/fx/echo" })
    .input(z.strictObject({ name: z.string().max(20) }))
    .output(z.strictObject({ name: z.string() })),
  whoami: oc
    .route({ method: "GET", path: "/fx/whoami" })
    .output(z.strictObject({ userId: z.string(), householdId: z.string(), role: z.string() })),
  firstRun: oc
    .route({ method: "POST", path: "/fx/first-run" })
    .output(z.strictObject({ ok: z.literal(true) })),
  adminOnly: oc
    .route({ method: "GET", path: "/fx/admin" })
    .output(z.strictObject({ ok: z.literal(true) })),
  badOutput: oc
    .route({ method: "GET", path: "/fx/bad-output" })
    .output(z.strictObject({ count: z.int() })),
  crash: oc
    .route({ method: "GET", path: "/fx/crash" })
    .output(z.strictObject({ ok: z.literal(true) })),
  setCookies: oc
    .route({ method: "POST", path: "/fx/set-cookies" })
    .output(z.strictObject({ ok: z.literal(true) })),
  conflict: oc
    .route({ method: "GET", path: "/fx/conflict" })
    .output(z.strictObject({ ok: z.literal(true) }))
    .errors(pickErrors("CONFLICT")),
};

const base = implement(miniContract).$context<HttpContext>();
const authed = base.use(requireSession);

/** Текст ошибки с ПД — канарейка: ни в ответ, ни в лог он попасть не должен. */
export const CRASH_TEXT = "не найден пользователь ivan.petrov@mail.by";

export const miniRouter = base.router({
  echo: base.echo.handler(({ input }) => ({ name: input.name })),
  whoami: authed.whoami.handler(({ context }) => ({
    userId: context.s.scope.userId,
    householdId: context.s.scope.householdId,
    role: context.role,
  })),
  firstRun: base.use(requireLocal).firstRun.handler(() => ({ ok: true as const })),
  adminOnly: authed.use(requireAdmin).adminOnly.handler(() => ({ ok: true as const })),
  // Нарочно не по схеме выхода: строка вместо целого.
  badOutput: base.badOutput.handler(
    () => JSON.parse('{"count":"ivan.petrov@mail.by"}') as { count: number },
  ),
  crash: base.crash.handler(() => {
    throw new Error(CRASH_TEXT);
  }),
  // Две cookie разом: Set-Cookie не склеиваются в один заголовок (вход Better Auth ставит несколько).
  setCookies: base.setCookies.handler(({ context }) => {
    context.resHeaders?.append("set-cookie", "fx_a=1; Path=/; HttpOnly");
    context.resHeaders?.append("set-cookie", "fx_b=2; Path=/; HttpOnly");
    return { ok: true as const };
  }),
  conflict: base.conflict.handler(() => {
    throw new AppError("CONFLICT", { receiptId: "r-1" });
  }),
});
