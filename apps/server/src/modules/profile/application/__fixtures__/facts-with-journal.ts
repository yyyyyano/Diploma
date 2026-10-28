// Сценарии фактов с настоящим журналом отмены actions (P5): «Отменить» в тестах идёт через actions.undo, как на сайте.
// События и сигналы сайту записываются в списки — тест проверяет, что ушло.
import { FakeClock } from "@kosht/testing";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import type { EventDef } from "../../../../platform/events/define-event.ts";
import { memoryLogger } from "../../../../platform/logging/__fixtures__/memory-logger.ts";
import type { Platform } from "../../../../platform/module/define-module.ts";
import type { Realtime } from "../../../../platform/realtime/realtime.ts";
import { createActionsModule } from "../../../actions/index.ts";
import { makeFacts, RESTORE_HANDLER, type Facts } from "../facts.ts";

export function factsWithJournal(clock = new FakeClock("2026-10-28T09:00:00Z")) {
  const published: { name: string; ids: readonly string[] }[] = [];
  const signals: { entity: string; ids: readonly string[] }[] = [];
  const log = memoryLogger().log;
  const realtime: Realtime = {
    changed: async (_s, signal) => {
      signals.push({ entity: signal.entity, ids: signal.ids });
    },
    progress: async () => {},
  };
  let facts: Facts | undefined;
  const restore = (s: ScopedDb, p: unknown) => {
    if (facts === undefined) throw new Error("факты ещё не собраны");
    return facts.restore(s, p);
  };
  const actions = createActionsModule({
    platform: {
      clock,
      log,
      actionHandlers: () => ({
        undo: new Map([[RESTORE_HANDLER, restore]]),
        confirm: new Map(),
      }),
    } as unknown as Platform,
    facades: {},
  }).facade;
  facts = makeFacts({
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
  });
  return { facts, actions, published, signals, clock };
}
