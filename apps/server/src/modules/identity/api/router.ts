// Процедуры identity (contract.identity.*): тонко — вход контрактом, сценарий, cookie в ответ. Доступ:
// status, signIn, signOut — publicProc (гость); setup — localOnly (R40: на сетевом входе процедуры нет); me — authed.
import { authed, localOnly, publicProc } from "../../../platform/http/procedures.ts";
import type { makeSignIn, makeSignOut } from "../application/sign-in.ts";
import type { makeSetup } from "../application/setup.ts";
import type { makeMe, makeStatus } from "../application/status.ts";

export interface IdentityUseCases {
  readonly status: ReturnType<typeof makeStatus>;
  readonly setup: ReturnType<typeof makeSetup>;
  readonly signIn: ReturnType<typeof makeSignIn>;
  readonly signOut: ReturnType<typeof makeSignOut>;
  readonly me: ReturnType<typeof makeMe>;
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
    signOut: publicProc.identity.signOut.handler(async ({ context }) => {
      setCookies(context.resHeaders, await uc.signOut(context.reqHeaders ?? new Headers()));
      return { ok: true as const };
    }),
    me: authed.identity.me.handler(({ context }) => uc.me(context.s)),
  };
}
