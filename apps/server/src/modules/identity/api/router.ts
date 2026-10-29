// Процедуры identity (contract.identity.*): тонко — вход контрактом, сценарий, cookie в ответ. Доступ:
// status, signIn, register, verifyEmail, requestPasswordReset, resetPassword, recoverWithCode, signOut — publicProc
// (гость); setup — localOnly (R40: на сетевом входе процедуры нет); me, resendVerification, recoveryCodeStatus,
// createRecoveryCode, changePassword, deleteAccount, adminResetNotice, acknowledgeAdminReset — authed. Адрес ссылок в письмах — по настройкам,
// не по Host запроса (NFR-24, link-origin.ts).
import { authed, localOnly, publicProc } from "../../../platform/http/procedures.ts";
import type { EmailVerification } from "../application/email-verification.ts";
import type { makeRegister } from "../application/register.ts";
import type { makeResendVerification } from "../application/resend-verification.ts";
import type { makeChangePassword } from "../application/change-password.ts";
import type { makeDeleteAccount } from "../application/delete-account.ts";
import type { PasswordReset } from "../application/password-reset.ts";
import type { RecoveryCodes } from "../application/recovery-code.ts";
import type { makeSignIn, makeSignOut } from "../application/sign-in.ts";
import type { makeSetup } from "../application/setup.ts";
import type { makeMe, makeStatus } from "../application/status.ts";
import type { makeAdminResetNotice } from "../application/admin-users.ts";

export interface IdentityUseCases {
  readonly status: ReturnType<typeof makeStatus>;
  readonly setup: ReturnType<typeof makeSetup>;
  readonly signIn: ReturnType<typeof makeSignIn>;
  readonly signOut: ReturnType<typeof makeSignOut>;
  readonly me: ReturnType<typeof makeMe>;
  readonly adminResetNotice: ReturnType<typeof makeAdminResetNotice>;
  readonly register: ReturnType<typeof makeRegister>;
  readonly verifyEmail: EmailVerification["verify"];
  readonly resendVerification: ReturnType<typeof makeResendVerification>;
  readonly passwordReset: PasswordReset;
  readonly recoveryCodes: Pick<RecoveryCodes, "create" | "status" | "recover">;
  readonly changePassword: ReturnType<typeof makeChangePassword>;
  readonly deleteAccount: ReturnType<typeof makeDeleteAccount>;
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
    setup: localOnly.identity.setup.handler(async ({ input }) => ({
      ok: true as const,
      ...(await uc.setup(input)),
    })),
    signIn: publicProc.identity.signIn.handler(async ({ input, context }) => {
      const { user, cookies } = await uc.signIn(input, context.reqHeaders ?? new Headers());
      setCookies(context.resHeaders, cookies);
      return user;
    }),
    register: publicProc.identity.register.handler(async ({ input, context }) => {
      const headers = context.reqHeaders ?? new Headers();
      const { user, cookies } = await uc.register(input, { headers });
      setCookies(context.resHeaders, cookies);
      return user;
    }),
    verifyEmail: publicProc.identity.verifyEmail.handler(async ({ input }) => {
      await uc.verifyEmail(input.token);
      return { ok: true as const };
    }),
    resendVerification: authed.identity.resendVerification.handler(async ({ context }) => {
      await uc.resendVerification(context.s);
      return { ok: true as const };
    }),
    requestPasswordReset: publicProc.identity.requestPasswordReset.handler(async ({ input }) => {
      await uc.passwordReset.request(input.email);
      return { ok: true as const };
    }),
    resetPassword: publicProc.identity.resetPassword.handler(async ({ input }) => {
      await uc.passwordReset.reset(input.token, input.password);
      return { ok: true as const };
    }),
    recoverWithCode: publicProc.identity.recoverWithCode.handler(async ({ input, context }) => {
      const { user, recoveryCode, cookies } = await uc.recoveryCodes.recover(
        input,
        context.reqHeaders ?? new Headers(),
      );
      setCookies(context.resHeaders, cookies);
      return { user, recoveryCode };
    }),
    recoveryCodeStatus: authed.identity.recoveryCodeStatus.handler(async ({ context }) => {
      const createdAt = await uc.recoveryCodes.status(context.s);
      return { createdAt: createdAt?.toISOString() ?? null };
    }),
    createRecoveryCode: authed.identity.createRecoveryCode.handler(async ({ context }) => {
      const { code, createdAt } = await uc.recoveryCodes.create(context.s);
      return { recoveryCode: code, createdAt: createdAt.toISOString() };
    }),
    changePassword: authed.identity.changePassword.handler(async ({ input, context }) => {
      const cookies = await uc.changePassword(
        context.s,
        input,
        context.reqHeaders ?? new Headers(),
      );
      setCookies(context.resHeaders, cookies);
      return { ok: true as const };
    }),
    deleteAccount: authed.identity.deleteAccount.handler(async ({ input, context }) => {
      setCookies(context.resHeaders, await uc.deleteAccount(context.s, input.password));
      return { ok: true as const };
    }),
    signOut: publicProc.identity.signOut.handler(async ({ context }) => {
      setCookies(context.resHeaders, await uc.signOut(context.reqHeaders ?? new Headers()));
      return { ok: true as const };
    }),
    me: authed.identity.me.handler(({ context }) => uc.me(context.s)),
    adminResetNotice: authed.identity.adminResetNotice.handler(async ({ context }) => ({
      at: (await uc.adminResetNotice.get(context.s.scope.userId))?.toISOString() ?? null,
    })),
    acknowledgeAdminReset: authed.identity.acknowledgeAdminReset.handler(async ({ context }) => {
      await uc.adminResetNotice.acknowledge(context.s.scope.userId);
      return { ok: true as const };
    }),
  };
}
