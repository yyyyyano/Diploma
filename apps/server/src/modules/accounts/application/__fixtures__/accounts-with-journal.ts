// Сценарии счетов с настоящими actions (журнал «Отменить», решения «Да/Нет») и explain; курсы НБРБ — из карты в памяти
// (без сети, NFR-11). События и сигналы сайту записываются в списки — тест проверяет, что ушло.
import type { LocalDate } from "@kosht/kernel";
import { FakeClock } from "@kosht/testing";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import type { EventDef } from "../../../../platform/events/define-event.ts";
import { memoryLogger } from "../../../../platform/logging/__fixtures__/memory-logger.ts";
import type { Platform } from "../../../../platform/module/define-module.ts";
import type { Realtime } from "../../../../platform/realtime/realtime.ts";
import { createActionsModule } from "../../../actions/index.ts";
import { createExplainModule } from "../../../explain/index.ts";
import type { FxRate } from "../../../fx-rates/index.ts";
import { DELETE_HANDLER, makeAccounts, RESTORE_HANDLER, type Accounts } from "../accounts.ts";

export function accountsWithJournal(
  rates: Readonly<Record<string, Omit<FxRate, "id" | "currency">>> = {},
  clock = new FakeClock("2026-10-28T09:00:00Z"),
) {
  const published: { name: string; ids: readonly string[] }[] = [];
  const signals: { entity: string; ids: readonly string[] }[] = [];
  const rateCalls: string[] = [];
  const log = memoryLogger().log;
  const realtime: Realtime = {
    changed: async (_s, signal) => {
      signals.push({ entity: signal.entity, ids: signal.ids });
    },
    progress: async () => {},
  };
  let accounts: Accounts | undefined;
  const ready = (): Accounts => {
    if (accounts === undefined) throw new Error("счета ещё не собраны");
    return accounts;
  };
  const platform = {
    clock,
    log,
    actionHandlers: () => ({
      undo: new Map([[RESTORE_HANDLER, (s: ScopedDb, p: unknown) => ready().restore(s, p)]]),
      confirm: new Map([
        [DELETE_HANDLER, (s: ScopedDb, p: unknown) => ready().confirmDelete(s, p)],
      ]),
    }),
  } as unknown as Platform;
  const actions = createActionsModule({ platform, facades: {} }).facade;
  const explain = createExplainModule({ platform, facades: {} }).facade;
  accounts = makeAccounts({
    platform: {
      clock,
      log,
      realtime,
      events: {
        publish: async (_tx, event: EventDef, payload) => {
          published.push({ name: event.name, ids: payload.ids });
        },
      },
    },
    actions,
    explain,
    fxRates: {
      rateOn: async (currency: string, day: LocalDate) => {
        rateCalls.push(`${currency}:${day}`);
        const rate = rates[currency];
        return rate === undefined ? undefined : { id: `fx-${currency}-${day}`, currency, ...rate };
      },
    },
  });
  return { accounts, actions, explain, published, signals, rateCalls, clock };
}
