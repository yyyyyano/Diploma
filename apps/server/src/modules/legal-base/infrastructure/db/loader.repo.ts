// Состояние вежливого загрузчика в БД (LAW-35…38): очередь слотов под pg_advisory_xact_lock (пауза 3–5 с общая для всех
// процессов и переживает перезапуск), остановка цикла, кэш robots.txt, журнал запросов и счётчики цикла. Только
// SystemDb модуля; HTTP внутри транзакций нет — слот занимается коротко, ожидание и запрос идут снаружи.
import type { LocalDate } from "@kosht/kernel";
import { eq, sql } from "drizzle-orm";
import { one } from "./rows.ts";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import type {
  LoaderState,
  LoaderStopReason,
  LoaderStore,
  RequestRecord,
} from "../../application/ports.ts";
import { legalFetchLog, legalLoaderState } from "./schema.ts";

/** Ключ консультативной блокировки очереди запросов (вторая часть ключа — хост: очередь на каждый сайт своя). */
const LOADER_LOCK_KEY = 8_340_034;

const REASONS: readonly string[] = ["LOADER_BLOCKED", "LOADER_TOO_MANY_ERRORS"];

function toReason(value: string | null): LoaderStopReason | null {
  return value !== null && REASONS.includes(value) ? (value as LoaderStopReason) : null;
}

/**
 * Состояние загрузчика для одного сайта: у каждого хоста своя строка — своя пауза, остановка цикла и robots.txt (LAW-15:
 * ведомственные сайты — тот же порядок вежливых запросов, но отдельно на хост). По умолчанию — pravo.by (строка id = 1).
 */
export function makeLoaderStore(db: SystemDb, host = "pravo.by"): LoaderStore {
  let ensured: Promise<unknown> | undefined;
  /** Строка хоста заводится при первом обращении (pravo.by создаёт миграция). */
  const ensure = () =>
    (ensured ??= db.insert(legalLoaderState).values({ host }).onConflictDoNothing());
  async function row() {
    await ensure();
    return one(
      await db.select().from(legalLoaderState).where(eq(legalLoaderState.host, host)),
      "legal_loader_state",
    );
  }

  return {
    async reserveSlot(now, pauseMs) {
      await ensure();
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${LOADER_LOCK_KEY}, hashtext(${host}))`);
        const rows = await tx
          .select({ next: legalLoaderState.nextRequestAt })
          .from(legalLoaderState)
          .where(eq(legalLoaderState.host, host));
        const next = rows[0]?.next ?? null;
        const slot = next !== null && next.getTime() > now.getTime() ? next : now;
        await tx
          .update(legalLoaderState)
          .set({
            lastRequestAt: slot,
            nextRequestAt: new Date(slot.getTime() + pauseMs),
          })
          .where(eq(legalLoaderState.host, host));
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
      await ensure();
      await db
        .update(legalLoaderState)
        .set({ stoppedOn: day, stopReason: reason })
        .where(eq(legalLoaderState.host, host));
    },

    async resume() {
      await ensure();
      await db
        .update(legalLoaderState)
        .set({ stoppedOn: null, stopReason: null })
        .where(eq(legalLoaderState.host, host));
    },

    async saveRobots(text, at) {
      await ensure();
      await db
        .update(legalLoaderState)
        .set({ robotsTxt: text, robotsFetchedAt: at })
        .where(eq(legalLoaderState.host, host));
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
        await tx.execute(sql`select pg_advisory_xact_lock(${LOADER_LOCK_KEY}, hashtext(${host}))`);
        const current = one(
          await tx.select().from(legalLoaderState).where(eq(legalLoaderState.host, host)),
          "legal_loader_state",
        );
        const sameDay = current.cycleDay === day;
        const requests = (sameDay ? current.cycleRequests : 0) + 1;
        const errors = (sameDay ? current.cycleErrors : 0) + (entry.isError ? 1 : 0);
        await tx
          .update(legalLoaderState)
          .set({ cycleDay: day, cycleRequests: requests, cycleErrors: errors })
          .where(eq(legalLoaderState.host, host));
        return { requests, errors };
      });
    },
  };
}
