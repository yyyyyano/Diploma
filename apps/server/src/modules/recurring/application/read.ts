// Чтение регулярных платежей (REC-02, REC-03, REC-04, EXPL-01): список с суммами `Calc` для соседей и экрана, ближайшие
// платежи на период, «Откуда эта цифра?» и признак «регулярный» для строк «Операций».
import type { Calc } from "@kosht/calc";
import { LocalDate, Money, type TraceId } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { stepAfter } from "../domain/dates.ts";
import type { Flow } from "../domain/detect.ts";
import type { Section } from "../domain/rules.ts";
import { listItems, lockItem, markedOperations } from "../infrastructure/db/recurring.repo.ts";
import type { Deps } from "./deps.ts";
import { toDto } from "./mapping.ts";
import { averageOf, occurrencesOf, toEntry, totalsOf, type RecurringEntry } from "./view.ts";
import { RECURRING_SECTIONS, type RecurringList } from "@kosht/contract";

/** Ближайший платёж: когда, сколько и откуда (средняя сумма с основаниями) — для fin, dashboard, calendar, afford. */
export interface UpcomingPayment {
  readonly id: string;
  readonly name: string;
  readonly flow: Flow;
  readonly section: Section;
  readonly on: LocalDate;
  readonly amount: Calc<Money>;
}

/** Не больше стольких шагов вперёд: недельный платёж на год — 52. */
const MAX_STEPS = 400;

export function makeRead(d: Pick<Deps, "platform" | "explain">) {
  /** Платежи без исключённых, на дату `onDate` (просрочка считается от неё); `sections` — только эти разделы. */
  async function list(
    s: ScopedDb,
    input: { sections?: readonly Section[]; onDate: LocalDate },
  ): Promise<RecurringEntry[]> {
    const rows = await listItems(s);
    return rows
      .filter((row) => row.state !== "excluded")
      .filter(
        (row) => input.sections === undefined || input.sections.includes(row.section as Section),
      )
      .map((row) => toEntry(row, input.onDate));
  }

  /** Экран «Регулярные платежи» (REC-02): платежи и итоги разделов; раздел — фильтр вкладки (итоги — по всем). */
  async function page(
    s: ScopedDb,
    input: { section?: Section | undefined },
  ): Promise<RecurringList> {
    const onDate = d.platform.clock.today();
    const all = await list(s, { onDate });
    return {
      onDate,
      items: all
        .filter((e) => input.section === undefined || e.section === input.section)
        .map(toDto),
      totals: RECURRING_SECTIONS.map((section) => {
        const { monthly, yearly } = totalsOf(all, section);
        return { section, monthly: monthly?.value ?? null, yearly: yearly?.value ?? null };
      }),
    };
  }

  /** REC-03: ожидаемые платежи за период `from…to` (включительно) — действующие и «возможно прекращён». */
  async function upcoming(
    s: ScopedDb,
    input: { from: LocalDate; to: LocalDate },
  ): Promise<UpcomingPayment[]> {
    const found: UpcomingPayment[] = [];
    const entries = await list(s, { onDate: input.from });
    for (const entry of entries) {
      if (entry.state !== "active" && entry.state !== "maybe-ended") continue;
      let on = entry.nextExpectedOn;
      for (let step = 0; on <= input.to && step < MAX_STEPS; step += 1) {
        if (on >= input.from) {
          found.push({
            id: entry.id,
            name: entry.name,
            flow: entry.flow,
            section: entry.section,
            on,
            amount: entry.average,
          });
        }
        on = stepAfter(entry.period, on, entry.anchorDay);
      }
    }
    return found.toSorted((a, b) => a.on.localeCompare(b.on) || a.id.localeCompare(b.id));
  }

  /** EXPL-01: сохранить расчёт средней суммы платежа (с операциями-основаниями) и вернуть traceId. */
  async function explain(s: ScopedDb, id: string): Promise<TraceId> {
    return s.transaction(async (tx) => {
      const row = await lockItem(tx, id);
      if (row === undefined || row.state === "excluded") throw new AppError("NOT_FOUND");
      const occurrences = occurrencesOf(row);
      const first = occurrences[0];
      const last = occurrences.at(-1);
      const period =
        first === undefined || last === undefined
          ? undefined
          : { from: LocalDate.parse(first.on), to: LocalDate.parse(last.on) };
      return d.explain.save(tx, averageOf(row).calc, period === undefined ? {} : { period });
    });
  }

  /** Какие из операций страницы входят в регулярный платёж (признак в «Операциях», ≤ 100 строк за раз). */
  async function markers(s: ScopedDb, ids: readonly string[]): Promise<string[]> {
    return markedOperations(s, ids);
  }

  return { list, page, upcoming, explain, markers };
}

export type Read = ReturnType<typeof makeRead>;
