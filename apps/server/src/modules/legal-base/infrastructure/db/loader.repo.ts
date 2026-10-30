// Состояние вежливого загрузчика в БД (LAW-35…38): очередь слотов под pg_advisory_xact_lock (пауза 3–5 с общая для всех
// процессов и переживает перезапуск), остановка цикла, кэш robots.txt, журнал запросов и счётчики цикла. Только
// SystemDb модуля; HTTP внутри транзакций нет — слот занимается коротко, ожидание и запрос идут снаружи.
import type { LocalDate } from "@kosht/kernel";
import { eq, sql } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import type {
  LoaderState,
  LoaderStopReason,
  LoaderStore,
  RequestRecord,
} from "../../application/ports.ts";
import { legalFetchLog, legalLoaderState } from "./schema.ts";

/** Ключ консультативной блокировки очереди запросов к pravo.by (один на систему). */
const LOADER_LOCK_KEY = 8_340_034;

const REASONS: readonly string[] = ["LOADER_BLOCKED", "LOADER_TOO_MANY_ERRORS"];

function toReason(value: string | null): LoaderStopReason | null {
  return value !== null && REASONS.includes(value) ? (value as LoaderStopReason) : null;
}

export function makeLoaderStore(db: SystemDb): LoaderStore {
  async function row() {
    const rows = await db.select().from(legalLoaderState).where(eq(legalLoaderState.id, 1));
    const found = rows[0];
    if (found === undefined)
      throw new Error("legal_loader_state: строки состояния нет (миграция).");
    return found;
  }

  return {
    async reserveSlot(now, pauseMs) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${LOADER_LOCK_KEY})`);
        const rows = await tx
          .select({ next: legalLoaderState.nextRequestAt })
          .from(legalLoaderState)
          .where(eq(legalLoaderState.id, 1));
        const next = rows[0]?.next ?? null;
        const slot = next !== null && next.getTime() > now.getTime() ? next : now;
        await tx
          .update(legalLoaderState)
          .set({
            lastRequestAt: slot,
            nextRequestAt: new Date(slot.getTime() + pauseMs),
          })
          .where(eq(legalLoaderState.id, 1));
        return slot;
      });
    },

    async read(): Promise<LoaderState> {
      const r = await row();
      return {
        stoppedOn: r.stoppedOn as LocalDate | null,
        stopReason: toReason(r.stopReason),
        robotsTxt: r.robotsTxt,
        robotsFetchedAt: r.robotsFetchedAt,
        cycleDay: r.cycleDay as LocalDate | null,
        cycleRequests: r.cycleRequests,
        cycleErrors: r.cycleErrors,
      };
    },

    async stop(day, reason) {
      await db
        .update(legalLoaderState)
        .set({ stoppedOn: day, stopReason: reason })
        .where(eq(legalLoaderState.id, 1));
    },

    async resume() {
      await db
        .update(legalLoaderState)
        .set({ stoppedOn: null, stopReason: null })
        .where(eq(legalLoaderState.id, 1));
    },

    async saveRobots(text, at) {
      await db
        .update(legalLoaderState)
        .set({ robotsTxt: text, robotsFetchedAt: at })
        .where(eq(legalLoaderState.id, 1));
    },

    async record(entry: RequestRecord, day: LocalDate) {
      await db.insert(legalFetchLog).values({
        at: entry.at,
        url: entry.url,
        httpStatus: entry.httpStatus,
        bytes: entry.bytes,
        ms: entry.ms,
        outcome: entry.outcome,
      });
      // Отказ по robots.txt — не запрос к сайту: в счётчики цикла (доля ошибок) не идёт.
      if (entry.outcome === "robots-denied") {
        const r = await row();
        return { requests: r.cycleRequests, errors: r.cycleErrors };
      }
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${LOADER_LOCK_KEY})`);
        const rows = await tx.select().from(legalLoaderState).where(eq(legalLoaderState.id, 1));
        const current = rows[0];
        const sameDay = current?.cycleDay === day;
        const requests = (sameDay ? (current?.cycleRequests ?? 0) : 0) + 1;
        const errors = (sameDay ? (current?.cycleErrors ?? 0) : 0) + (entry.isError ? 1 : 0);
        await tx
          .update(legalLoaderState)
          .set({ cycleDay: day, cycleRequests: requests, cycleErrors: errors })
          .where(eq(legalLoaderState.id, 1));
        return { requests, errors };
      });
    },
  };
}
