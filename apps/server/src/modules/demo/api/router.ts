// Процедуры demo (contract.demo.*): вход демо-пользователем — localOnly (R40, NFR-24: на сетевом слушателе процедуры «нет»;
// DEMO-04 «только с localhost»). Демо-пользователь создаётся при первом входе, если его ещё нет; пароль человеку не нужен.
import { localOnly } from "../../../platform/http/procedures.ts";
import type { IdentityFacade } from "../../identity/index.ts";
import type { Demo } from "../application/demo.ts";

export interface DemoUseCases {
  readonly demo: Pick<Demo, "ensure">;
  readonly identity: Pick<IdentityFacade, "signInDemo">;
}

export function demoRouter(uc: DemoUseCases) {
  return {
    signIn: localOnly.demo.signIn.handler(async ({ context }) => {
      await uc.demo.ensure();
      const { user, cookies } = await uc.identity.signInDemo(context.reqHeaders ?? new Headers());
      for (const cookie of cookies) context.resHeaders?.append("set-cookie", cookie);
      return user;
    }),
  };
}
