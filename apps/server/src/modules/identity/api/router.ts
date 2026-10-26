// Процедуры identity (contract.identity.*): тонко — вход контрактом, сценарий, cookie в ответ. Доступ:
// status, signIn, register, verifyEmail, signOut — publicProc (гость); setup — localOnly (R40: на сетевом входе
// процедуры нет); me, resendVerification — authed. Адрес ссылок в письмах — по слушателю и Host запроса (NFR-24).
import { authed, localOnly, publicProc } from "../../../platform/http/procedures.ts";
import type { HttpContext } from "../../../platform/http/procedures.ts";
import type { LinkRequest } from "../../../platform/http/link-origin.ts";
import type { EmailVerification } from "../application/email-verification.ts";
import type { makeRegister } from "../application/register.ts";
import type { makeResendVerification } from "../application/resend-verification.ts";
import type { makeSignIn, makeSignOut } from "../application/sign-in.ts";
import type { makeSetup } from "../application/setup.ts";
import type { makeMe, makeStatus } from "../application/status.ts";

export interface IdentityUseCases {
  readonly status: ReturnType<typeof makeStatus>;
  readonly setup: ReturnType<typeof makeSetup>;
  readonly signIn: ReturnType<typeof makeSignIn>;
  readonly signOut: ReturnType<typeof makeSignOut>;
  readonly me: ReturnType<typeof makeMe>;
  readonly register: ReturnType<typeof makeRegister>;
  readonly verifyEmail: EmailVerification["verify"];
  readonly resendVerification: ReturnType<typeof makeResendVerification>;
}

/** Откуда пришёл запрос — для адреса ссылок в письмах. */
function linkRequest(context: HttpContext): LinkRequest {
  return { listener: context.listener, host: context.reqHeaders?.get("host") ?? undefined };
}

/** Set-Cookie сессии — в заголовки ответа процедуры (ResponseHeadersPlugin). */
function setCookies(resHeaders: Headers | undefined, cookies: readonly string[]): void {
  for (const cookie of cookies) resHeaders?.append("set-cookie", cookie);
}

export function identityRouter(uc: IdentityUseCases) {
  return {
    status: publicProc.identity.status.handler(({ context }) =>
      uc.status(context.listener === "local"),
    ),
    setup: localOnly.identity.setup.handler(async ({ input }) => {
      await uc.setup(input);
      return { ok: true as const };
    }),
    signIn: publicProc.identity.signIn.handler(async ({ input, context }) => {
      const { user, cookies } = await uc.signIn(input, context.reqHeaders ?? new Headers());
      setCookies(context.resHeaders, cookies);
      return user;
    }),
    register: publicProc.identity.register.handler(async ({ input, context }) => {
      const headers = context.reqHeaders ?? new Headers();
      const { user, cookies } = await uc.register(input, { ...linkRequest(context), headers });
      setCookies(context.resHeaders, cookies);
      return user;
    }),
    verifyEmail: publicProc.identity.verifyEmail.handler(async ({ input }) => {
      await uc.verifyEmail(input.token);
      return { ok: true as const };
    }),
    resendVerification: authed.identity.resendVerification.handler(async ({ context }) => {
      await uc.resendVerification(context.s, linkRequest(context));
      return { ok: true as const };
    }),
    signOut: publicProc.identity.signOut.handler(async ({ context }) => {
      setCookies(context.resHeaders, await uc.signOut(context.reqHeaders ?? new Headers()));
      return { ok: true as const };
    }),
    me: authed.identity.me.handler(({ context }) => uc.me(context.s)),
  };
}
