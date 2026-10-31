// Вкладка «Законы» администрирования (LAW-40, ADM-10): сводка и расписание, список актов, журналы, очередь кандидатов, настройки,
// исключение акта, справочники. Администратор правит общую базу — данных пользователей здесь нет (PRIV-07). Что требует сети
// (проверка, добавление по ссылке, проверка текста), здесь только ставится задачей: запросы к pravo.by идут из worker (LAW-35).
import {
  LAW_ACT_PAGE_SIZE,
  type LawAdminActs,
  type LawCandidate,
  type LawDictionary,
  type LawFetchEntry,
  type LawMoment,
  type LawsOverview,
  type LawUpdateEntry,
} from "@kosht/contract";
import { LocalDate, type Clock, type TimeZone } from "@kosht/kernel";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Settings } from "../../../platform/settings/settings.ts";
import { parseActLinks } from "../domain/act-links.ts";
import { ADMIN_STATUSES, adminStatusOf, type AdminStatus } from "../domain/admin-status.ts";
import { checkSchedule, localTime } from "../domain/schedule.ts";
import {
  adminActRows,
  decideQueued,
  excludeAct,
  fetchLogRows,
  lastCheckRow,
  queuedCandidates,
  updateLogRows,
} from "../infrastructure/db/admin.repo.ts";
import { findAct, logUpdate } from "../infrastructure/db/catalog.repo.ts";
import { userAgentFor } from "../infrastructure/pravo-by/polite-fetcher.ts";
import {
  AUTO_UPDATE,
  CHECK_TIME,
  LOADER_CONTACT,
  NEW_ACTS_MODE,
  WINDOW_FROM,
  WINDOW_TO,
} from "../settings.ts";
import type { Dictionaries } from "./dictionaries.ts";
import type { Embedder } from "./embed.ts";
import type { StartCatalog } from "./start-catalog.ts";

/** Строк в журналах. */
const LOG_LIMIT = 100;
const DAY_MS = 86_400_000;

type SetInput = Readonly<{
  autoUpdate?: boolean | undefined;
  newActsMode?: "auto" | "suggest" | undefined;
  loaderContact?: string | undefined;
  checkTime?: string | undefined;
  windowFrom?: string | undefined;
  windowTo?: string | undefined;
}>;

export interface LawsAdminDeps {
  readonly system: SystemDb;
  readonly settings: Pick<Settings, "get" | "set">;
  readonly timeZone: () => Promise<TimeZone>;
  readonly clock: Clock;
  readonly startCatalog: Pick<StartCatalog, "progress">;
  readonly embedder: Pick<Embedder, "progress">;
  readonly dictionaries: Dictionaries;
}

/** Что ставится задачами worker: владелец задачи — вошедший администратор (его `s`), данных он не касается. */
export interface LawsAdminJobs<S> {
  checkNow(s: S, pravoId: string | null): Promise<void>;
  addActs(s: S, pravoIds: readonly string[]): Promise<void>;
}

const nextDay = (day: string): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

const isDetail = (value: unknown): value is string | number =>
  typeof value === "string" || typeof value === "number";

/** Подробности записи журнала → только строки и числа (в БД — jsonb: форма не гарантирована). */
function detailsOf(raw: unknown): Record<string, string | number> {
  if (typeof raw !== "object" || raw === null) return {};
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string | number] => isDetail(entry[1])),
  );
}

export function makeLawsAdmin<S>(d: LawsAdminDeps, jobs: LawsAdminJobs<S>) {
  async function moment(at: Date): Promise<LawMoment> {
    const timeZone = await d.timeZone();
    return {
      day: LocalDate.fromInstant(at, timeZone).toString(),
      time: localTime(at, timeZone),
    };
  }

  async function overview(modelReady: boolean): Promise<LawsOverview> {
    const rows = await adminActRows(d.system);
    const states = rows.map((r) => adminStatusOf(r));
    const count = (status: AdminStatus) => states.filter((s) => s === status).length;
    const vectors = await d.embedder.progress(modelReady);
    const checkTime = await d.settings.get(CHECK_TIME);
    const autoUpdate = await d.settings.get(AUTO_UPDATE);
    const last = await lastCheckRow(d.system);
    const lastDetails = detailsOf(last?.details);
    const timeZone = await d.timeZone();
    const today = d.clock.today().toString();
    const soon = localTime(d.clock.now(), timeZone) < checkTime;
    const contact = await d.settings.get(LOADER_CONTACT);
    return {
      summary: {
        inIndex: count("active") + count("has-changes"),
        cardOnly: count("card-only"),
        repealed: count("repealed"),
        candidates: (await queuedCandidates(d.system)).length,
        withChanges: count("has-changes"),
        quarantined: count("quarantined"),
        failed: count("failed"),
      },
      startup: await d.startCatalog.progress(),
      vectors: {
        state:
          vectors.state === "working"
            ? "working"
            : vectors.state === "idle"
              ? "idle"
              : "waiting-model",
        total: vectors.total,
        embedded: vectors.embedded,
        model: vectors.model,
      },
      schedule: {
        autoUpdate,
        checkTime,
        windowFrom: await d.settings.get(WINDOW_FROM),
        windowTo: await d.settings.get(WINDOW_TO),
        lastCheck:
          last === undefined
            ? null
            : {
                at: await moment(last.at),
                ok: last.event === "daily-check",
                updated: Number(lastDetails["updated"] ?? 0),
                problems:
                  Number(lastDetails["failed"] ?? 0) + Number(lastDetails["quarantined"] ?? 0),
                stopReason:
                  typeof lastDetails["reason"] === "string" ? lastDetails["reason"] : null,
              },
        nextCheck: autoUpdate ? { day: soon ? today : nextDay(today), time: checkTime } : null,
      },
      newActsMode: await d.settings.get(NEW_ACTS_MODE),
      loaderContact: contact,
      userAgent: userAgentFor(contact),
    };
  }

  async function acts(filter: AdminStatus | undefined, page: number): Promise<LawAdminActs> {
    const rows = (await adminActRows(d.system)).map((row) => ({ row, status: adminStatusOf(row) }));
    const counts = {
      all: rows.length,
      ...Object.fromEntries(ADMIN_STATUSES.map((s) => [s, 0])),
    } as LawAdminActs["counts"];
    for (const { status } of rows) counts[status] += 1;
    const matching = rows.filter(({ status }) => filter === undefined || status === filter);
    const items = matching
      .slice((page - 1) * LAW_ACT_PAGE_SIZE, page * LAW_ACT_PAGE_SIZE)
      .map(({ row, status }) => ({
        pravoId: row.pravoId,
        title: row.title,
        topic: row.topic,
        status,
        problem: status === "failed" || status === "quarantined" ? row.lastProblem : null,
        pendingChanges: row.pending,
        repealedOn: row.repealedOn,
        editionOn: row.editionAt === null ? null : row.editionAt.toISOString().slice(0, 10),
        checkedOn: row.cardCheckedAt === null ? null : row.cardCheckedAt.toISOString().slice(0, 10),
      }));
    return { items, total: matching.length, counts, page, pageSize: LAW_ACT_PAGE_SIZE };
  }

  async function updates(): Promise<LawUpdateEntry[]> {
    const rows = await updateLogRows(d.system, LOG_LIMIT);
    return Promise.all(
      rows.map(async (r) => ({
        at: await moment(r.at),
        event: r.event,
        pravoId: r.pravoId,
        title: r.title,
        details: detailsOf(r.details),
      })),
    );
  }

  async function fetches(): Promise<LawFetchEntry[]> {
    const rows = await fetchLogRows(d.system, LOG_LIMIT);
    return Promise.all(rows.map(async (r) => ({ ...r, at: await moment(r.at) })));
  }

  async function candidates(): Promise<LawCandidate[]> {
    return queuedCandidates(d.system);
  }

  /** «Добавить» — кандидат уходит в добавление по ссылке (задача worker), «Отклонить» — больше не предлагается (LAW-17). */
  async function decide(s: S, id: string, decision: "add" | "reject"): Promise<LawCandidate[]> {
    const pravoId = await decideQueued(
      d.system,
      id,
      decision === "add" ? "added" : "rejected",
      d.clock.now(),
    );
    if (pravoId === null) throw new AppError("NOT_FOUND");
    await logUpdate(d.system, {
      at: d.clock.now(),
      actId: null,
      event: decision === "add" ? "candidate-approved" : "candidate-rejected",
      details: { pravoId },
    });
    if (decision === "add") await jobs.addActs(s, [pravoId]);
    return candidates();
  }

  /**
   * Настройки вкладки. Время проверки лежит внутри ночного окна и оставляет в нём место проходу пополнения (LAW-35): иначе
   * `VALIDATION` с названием поля, ничего не записывается.
   */
  async function setSettings(input: SetInput): Promise<void> {
    const next = {
      checkTime: input.checkTime ?? (await d.settings.get(CHECK_TIME)),
      windowFrom: input.windowFrom ?? (await d.settings.get(WINDOW_FROM)),
      windowTo: input.windowTo ?? (await d.settings.get(WINDOW_TO)),
    };
    const invalid = checkSchedule(next);
    if (invalid !== null) {
      throw new AppError("VALIDATION", {
        field: invalid === "window-empty" ? "windowTo" : "checkTime",
        reason: invalid,
      });
    }
    if (input.checkTime !== undefined) await d.settings.set(CHECK_TIME, next.checkTime);
    if (input.windowFrom !== undefined) await d.settings.set(WINDOW_FROM, next.windowFrom);
    if (input.windowTo !== undefined) await d.settings.set(WINDOW_TO, next.windowTo);
    if (input.autoUpdate !== undefined) await d.settings.set(AUTO_UPDATE, input.autoUpdate);
    if (input.newActsMode !== undefined) await d.settings.set(NEW_ACTS_MODE, input.newActsMode);
    if (input.loaderContact !== undefined)
      await d.settings.set(LOADER_CONTACT, input.loaderContact);
  }

  /** Ссылки и ID → задача добавления; не распознанные строки возвращаются, из пустого списка задачи нет. */
  async function addActs(
    s: S,
    lines: readonly string[],
  ): Promise<{ accepted: number; rejected: string[] }> {
    const { ids, rejected } = parseActLinks(lines);
    if (ids.length > 0) await jobs.addActs(s, ids);
    return { accepted: ids.length, rejected: [...rejected] };
  }

  /** «Проверить, появился ли текст»: только у акта-карточки (текст берётся только с pravo.by, LEGAL-06). */
  async function checkText(s: S, pravoId: string): Promise<void> {
    const act = await findAct(d.system, pravoId);
    if (act === undefined) throw new AppError("NOT_FOUND");
    if (act.hasText) throw new AppError("VALIDATION", { field: "pravoId", reason: "has-text" });
    await jobs.checkNow(s, pravoId);
  }

  async function exclude(pravoId: string): Promise<void> {
    if (!(await excludeAct(d.system, pravoId))) throw new AppError("NOT_FOUND");
    await logUpdate(d.system, {
      at: d.clock.now(),
      actId: null,
      event: "act-excluded",
      details: { pravoId },
    });
  }

  const dictionary = (view: Awaited<ReturnType<Dictionaries["list"]>>): LawDictionary => ({
    kind: view.kind,
    fields: view.fields.map((f) => ({
      name: f.name,
      type: f.type,
      required: f.required,
      ...(f.options === undefined ? {} : { options: [...f.options] }),
    })),
    rows: view.rows.map((r) => ({ id: r.id, values: { ...r.values } })),
  });

  return {
    overview,
    acts,
    updates,
    fetches,
    candidates,
    decide,
    setSettings,
    addActs,
    checkNow: (s: S) => jobs.checkNow(s, null),
    checkText,
    exclude,
    dictionaries: {
      list: async (kind: Parameters<Dictionaries["list"]>[0]) =>
        dictionary(await d.dictionaries.list(kind)),
      upsert: async (
        kind: Parameters<Dictionaries["list"]>[0],
        id: string | null,
        values: Readonly<Record<string, string>>,
      ) => dictionary(await d.dictionaries.upsert(kind, id, values)),
      remove: async (kind: Parameters<Dictionaries["list"]>[0], id: string) =>
        dictionary(await d.dictionaries.remove(kind, id)),
    },
  };
}

export type LawsAdmin<S> = ReturnType<typeof makeLawsAdmin<S>>;
