// Факты профиля (PROF-01…06, AUTH-07, P5): запись, подтверждение и удаление с «Отменить», чтение с оценкой на дату
// вопроса и анкета. Каждое изменение — одна транзакция: ревизия «до действия», сам факт, запись в журнал отмены
// (actions), событие profile.facts-changed и сигнал сайту. «Отменить» восстанавливает факт из ревизии — в журнале
// только id ревизии. Удалённый факт помечается и больше никому не возвращается (PROF-05).
import {
  FactId,
  FactValue,
  type FactSource,
  type FactStatus,
  type FactValueInput,
  type OnboardingAnswers,
  type ProfileFact,
} from "@kosht/contract";
import { LocalDate } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { ActionsFacade } from "../../actions/index.ts";
import { evaluate, toStoredValue, topicOf } from "../domain/facts.ts";
import { factsChanged } from "../events.ts";
import {
  findRevision,
  insertFact,
  insertRevision,
  listLiveFacts,
  lockFact,
  lockFactByKey,
  markOnboardingDone,
  onboardingDone,
  updateFact,
  type FactRow,
} from "../infrastructure/db/profile.repo.ts";

/** Обработчик «Отменить» модуля: восстановить факт из ревизии. */
export const RESTORE_HANDLER = "profile.restore";

export type Channel = "web" | "telegram";

export interface FactsDeps {
  readonly platform: Pick<Platform, "clock" | "events" | "realtime" | "log">;
  readonly actions: Pick<ActionsFacade, "record">;
}

/** Что пишется: значение, откуда и насколько уверены. */
interface Write {
  readonly value: FactValue;
  readonly source: FactSource;
  readonly sourceRef: string | null;
  readonly status: FactStatus;
}

export function toDto(row: FactRow, onDate: LocalDate): ProfileFact {
  const value = FactValue.parse(row.value);
  return {
    id: FactId.parse(row.id),
    topic: topicOf(value),
    value,
    source: row.source as FactSource,
    sourceRef: row.sourceRef,
    status: row.status as FactStatus,
    recordedOn: LocalDate.parse(row.recordedOn),
    evaluation: evaluate(value, onDate),
  };
}

function stateOf(row: FactRow) {
  return {
    value: row.value,
    source: row.source,
    sourceRef: row.sourceRef,
    status: row.status,
    recordedOn: row.recordedOn,
    deletedAt: row.deletedAt,
  };
}

export function makeFacts(d: FactsDeps) {
  const { clock, events, realtime, log } = d.platform;

  async function changed(tx: ScopedDb, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await events.publish(tx, factsChanged, { ids: [...ids] });
    await realtime.changed(tx, { entity: "profile-fact", ids: [...ids] });
  }

  /** Живой факт по id под блокировкой; удалённый, чужой, неизвестный — NOT_FOUND (неотличимы). */
  async function liveFact(tx: ScopedDb, id: string): Promise<FactRow> {
    const row = await lockFact(tx, id);
    if (row === undefined || row.deletedAt !== null) throw new AppError("NOT_FOUND");
    return row;
  }

  /**
   * Записать факт в транзакции: ключ PROF-01 — строка ключа (и удалённая — она оживает), заметка — по id или новая.
   * keepConfirmed — вывод системы не перетирает подтверждённое человеком (PROF-03): тогда ничего не меняется.
   * Итог — id факта и ревизии «до» (для «Отменить») или undefined, если ничего не изменилось.
   */
  async function write(
    tx: ScopedDb,
    input: Write & { readonly id?: string; readonly keepConfirmed?: boolean },
  ): Promise<{ factId: string; revisionId: string } | undefined> {
    const now = clock.now();
    const today = clock.today();
    const { value } = input;
    let current: FactRow | undefined;
    if (value.key === "note") {
      current = input.id === undefined ? undefined : await liveFact(tx, input.id);
      if (current !== undefined && current.key !== "note") throw new AppError("NOT_FOUND");
    } else {
      current = await lockFactByKey(tx, value.key);
      if (input.id !== undefined && current?.id !== input.id) throw new AppError("NOT_FOUND");
    }
    const live = current !== undefined && current.deletedAt === null;
    if (input.keepConfirmed === true && live && current?.status === "confirmed") return undefined;
    const next = {
      value,
      topic: topicOf(value),
      source: input.source,
      sourceRef: input.sourceRef,
      status: input.status,
      recordedOn: today,
    };
    if (current === undefined) {
      const id = await insertFact(tx, { key: value.key, ...next });
      if (id !== undefined) {
        const revisionId = await insertRevision(tx, id, {
          existed: false,
          ...next,
          deletedAt: null,
        });
        return { factId: id, revisionId };
      }
      // Ключ записали параллельно: правим его строку.
      current = await lockFactByKey(tx, value.key);
      if (current === undefined) throw new Error("profile_facts: строка ключа пропала.");
    }
    const revisionId = await insertRevision(tx, current.id, {
      existed: current.deletedAt === null,
      ...stateOf(current),
    });
    await updateFact(tx, current.id, { ...next, deletedAt: null }, now);
    return { factId: current.id, revisionId };
  }

  async function record(
    tx: ScopedDb,
    change: { factId: string; revisionId: string },
    channel: Channel,
  ): Promise<string> {
    return d.actions.record(tx, {
      handler: RESTORE_HANDLER,
      payload: { revisionId: change.revisionId },
      subject: `profile-fact:${change.factId}`,
      channel,
    });
  }

  async function readOne(tx: ScopedDb, id: string): Promise<ProfileFact> {
    const row = await lockFact(tx, id);
    if (row === undefined) throw new Error("profile_facts: факт пропал после записи.");
    return toDto(row, clock.today());
  }

  /** PROF-05: все действующие факты, оценённые на сегодня. */
  async function list(s: ScopedDb): Promise<{ onDate: LocalDate; facts: ProfileFact[] }> {
    const onDate = clock.today();
    return { onDate, facts: (await listLiveFacts(s)).map((row) => toDto(row, onDate)) };
  }

  /** Фасад (PROF-06): факты этих ключей, оценённые на дату вопроса; удалённых нет. */
  async function getFacts(
    s: ScopedDb,
    keys: readonly string[],
    onDate: LocalDate,
  ): Promise<ProfileFact[]> {
    return (await listLiveFacts(s, keys)).map((row) => toDto(row, onDate));
  }

  /** Добавить или исправить факт человеком (страница, агент) — «подтверждён», с «Отменить». */
  async function set(
    s: ScopedDb,
    input: {
      readonly id?: string;
      readonly value: FactValueInput;
      readonly source: FactSource;
      readonly sourceRef?: string | null;
      readonly channel: Channel;
    },
  ): Promise<{ fact: ProfileFact; undoToken: string }> {
    return s.transaction(async (tx) => {
      const change = await write(tx, {
        ...(input.id === undefined ? {} : { id: input.id }),
        value: toStoredValue(input.value, clock.today()),
        source: input.source,
        sourceRef: input.sourceRef ?? null,
        status: "confirmed",
      });
      if (change === undefined) throw new Error("Запись человека не может быть пропущена.");
      const undoToken = await record(tx, change, input.channel);
      await changed(tx, [change.factId]);
      log.info({ factId: change.factId, reason: input.source }, "profile.fact-saved");
      return { fact: await readOne(tx, change.factId), undoToken };
    });
  }

  /** PROF-03: предположение подтверждено человеком. */
  async function confirm(
    s: ScopedDb,
    id: string,
    channel: Channel,
  ): Promise<{ fact: ProfileFact; undoToken: string }> {
    return s.transaction(async (tx) => {
      const current = await liveFact(tx, id);
      const revisionId = await insertRevision(tx, id, { existed: true, ...stateOf(current) });
      await updateFact(tx, id, { status: "confirmed", recordedOn: clock.today() }, clock.now());
      const undoToken = await record(tx, { factId: id, revisionId }, channel);
      await changed(tx, [id]);
      return { fact: await readOne(tx, id), undoToken };
    });
  }

  /** PROF-05: удалить факт (с «Отменить»); удалённый больше не используется. */
  async function remove(s: ScopedDb, id: string, channel: Channel): Promise<string> {
    return s.transaction(async (tx) => {
      const current = await liveFact(tx, id);
      const revisionId = await insertRevision(tx, id, { existed: true, ...stateOf(current) });
      await updateFact(tx, id, { deletedAt: clock.now() }, clock.now());
      const undoToken = await record(tx, { factId: id, revisionId }, channel);
      await changed(tx, [id]);
      log.info({ factId: id }, "profile.fact-deleted");
      return undoToken;
    });
  }

  /** «Отменить» (реестр undo): факт снова такой, каким был до действия; не было — снова нет. */
  async function restore(tx: ScopedDb, payload: unknown): Promise<void> {
    const revisionId = (payload as { revisionId?: unknown } | null)?.revisionId;
    const revision =
      typeof revisionId === "string" ? await findRevision(tx, revisionId) : undefined;
    if (revision === undefined) throw new Error("profile.restore: нет ревизии из журнала.");
    const now = clock.now();
    const { factId, existed, ...state } = revision;
    await lockFact(tx, factId);
    const patch = existed
      ? { ...state, topic: topicOf(FactValue.parse(state.value)) }
      : { deletedAt: now };
    await updateFact(tx, factId, patch, now);
    await changed(tx, [factId]);
  }

  /** Фасад (PROF-03): вывод системы — «предположение»; подтверждённое человеком не перетирает. */
  async function upsertDerivedFact(
    s: ScopedDb,
    input: {
      readonly value: FactValueInput;
      readonly source: "statements" | "system";
      readonly sourceRef?: string | null;
    },
  ): Promise<FactId | undefined> {
    return s.transaction(async (tx) => {
      const change = await write(tx, {
        value: toStoredValue(input.value, clock.today()),
        source: input.source,
        sourceRef: input.sourceRef ?? null,
        status: "assumed",
        keepConfirmed: true,
      });
      if (change === undefined) return undefined;
      await changed(tx, [change.factId]);
      return FactId.parse(change.factId);
    });
  }

  /** Фасад (PROF-04, AGT-06): ответ на дозапрос — факт «чат» со ссылкой на сообщение, с «Отменить». */
  async function recordAnswer(
    s: ScopedDb,
    input: {
      readonly value: FactValueInput;
      readonly messageId: string;
      readonly channel: Channel;
    },
  ): Promise<{ fact: ProfileFact; undoToken: string }> {
    return set(s, {
      value: input.value,
      source: "chat",
      sourceRef: input.messageId,
      channel: input.channel,
    });
  }

  /** AUTH-07: показывать ли анкету. */
  async function onboarding(s: ScopedDb): Promise<{ status: "pending" | "done" }> {
    return { status: (await onboardingDone(s)) ? "done" : "pending" };
  }

  /** AUTH-07, PROF-02: ответы анкеты — факты «анкета»; пропущенные вопросы не трогаются; анкета больше не нужна. */
  async function completeOnboarding(
    s: ScopedDb,
    answers: OnboardingAnswers,
  ): Promise<{ facts: ProfileFact[] }> {
    const today = clock.today();
    const values: FactValueInput[] = [
      ...(answers.employment ? [{ key: "employment" as const, types: answers.employment }] : []),
      ...(answers.children ? [{ key: "children" as const, children: answers.children }] : []),
      ...(answers.housingQueue
        ? [{ key: "housingQueue" as const, status: answers.housingQueue, since: null }]
        : []),
      ...(answers.benefitCategory === undefined
        ? []
        : [{ key: "benefitCategory" as const, value: answers.benefitCategory }]),
      ...(answers.youngSpecialist === undefined
        ? []
        : [{ key: "youngSpecialist" as const, value: answers.youngSpecialist, until: null }]),
      ...(answers.familyStatus
        ? [{ key: "familyStatus" as const, statuses: answers.familyStatus }]
        : []),
    ];
    return s.transaction(async (tx) => {
      const ids: string[] = [];
      for (const value of values) {
        const change = await write(tx, {
          value: toStoredValue(value, today),
          source: "questionnaire",
          sourceRef: null,
          status: "confirmed",
        });
        if (change !== undefined) ids.push(change.factId);
      }
      await markOnboardingDone(tx, clock.now());
      await changed(tx, ids);
      log.info({ count: ids.length }, "profile.onboarding-completed");
      return {
        facts: (await listLiveFacts(tx))
          .filter((row) => ids.includes(row.id))
          .map((row) => toDto(row, today)),
      };
    });
  }

  return {
    list,
    getFacts,
    set,
    confirm,
    remove,
    restore,
    upsertDerivedFact,
    recordAnswer,
    onboarding,
    completeOnboarding,
  };
}

export type Facts = ReturnType<typeof makeFacts>;
