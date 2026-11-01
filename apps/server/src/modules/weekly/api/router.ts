// Процедуры weekly (contract.weekly.*): тонко — authed (домохозяйство из сессии) → сценарий.
import { authed } from "../../../platform/http/procedures.ts";
import type { Read } from "../application/read.ts";

export function weeklyRouter(read: Read) {
  return {
    latest: authed.weekly.latest.handler(async ({ context }) => ({
      summary: await read.latest(context.s),
    })),
    history: authed.weekly.history.handler(async ({ context }) => ({
      items: await read.history(context.s, 52),
    })),
    preferences: authed.weekly.preferences.handler(({ context }) => read.preferences(context.s)),
    setPreferences: authed.weekly.setPreferences.handler(({ input, context }) =>
      read.setPreferences(context.s, input),
    ),
  };
}
