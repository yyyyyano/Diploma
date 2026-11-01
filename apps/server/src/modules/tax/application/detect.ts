// Поиск оснований для вычетов по операциям и профилю (TAX-20, AGT-06): по `transactions.changed` и `profile.facts-changed`.
// Основания: оплата обучения (категория «Образование» + получатель — учреждение образования, словарь настройки) → социальный
// вычет с суммой калькулятора T-045; дети до 18 лет в профиле → напоминание о стандартном вычете; платежи по кредитам при учёте
// нуждающихся → имущественный вычет (учёт не отмечен — один вопрос, ответ — факт профиля). Запись одна на основание (операцию,
// факт): повтор события дубль не создаёт, отклонённое «Не моё» не возвращается. Просматриваются операции текущего и прошлого года.
import type { DeductionResult } from "@kosht/contract";
import type { LocalDate } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { NotificationsFacade } from "../../notifications/index.ts";
import type { ProfileFacade } from "../../profile/index.ts";
import type { TransactionsFacade } from "../../transactions/index.ts";
import { isEducationPayee } from "../domain/education-payee.ts";
import {
  findByBasis,
  insertFound,
  refreshAmount,
  removeActive,
  setReason,
  type FoundRow,
  type NewFound,
} from "../infrastructure/db/found.repo.ts";
import { EDUCATION_PAYEE_WORDS } from "../settings.ts";
import type { Calculate } from "./calculate.ts";

const PAGE_SIZE = 100;
/** Операций «Образования» и кредитов за два года на человека хватает с запасом; больше — обработаем при следующем событии. */
const MAX_PAGES = 3;

export interface DetectDeps {
  readonly platform: Pick<Platform, "clock" | "log" | "settings" | "realtime">;
  readonly profile: Pick<ProfileFacade, "getFacts">;
  readonly transactions: Pick<TransactionsFacade, "list">;
  readonly notifications: Pick<NotificationsFacade, "notify">;
  readonly calculate: Calculate;
}

type Operation = Awaited<ReturnType<TransactionsFacade["list"]>>["items"][number];

export function makeDetect(d: DetectDeps) {
  const { clock, log, settings, realtime } = d.platform;

  /** Расходы категории за прошлый и текущий год, свежие первыми не гарантируются — порядок не важен. */
  async function operationsOf(
    s: ScopedDb,
    categoryCode: "education" | "loans",
    from: string,
    to: string,
  ): Promise<Operation[]> {
    const found: Operation[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await d.transactions.list(s, {
        categoryCode,
        type: "expense",
        from: from as LocalDate,
        to: to as LocalDate,
        page,
        pageSize: PAGE_SIZE,
      });
      found.push(...result.items.filter((op) => !op.pending));
      if (page * PAGE_SIZE >= result.total) break;
    }
    return found;
  }

  /** Новая запись + уведомление «найден вычет» — одной транзакцией: повтор доставки второго уведомления не шлёт. */
  async function create(
    s: ScopedDb,
    row: NewFound,
    notify: { amountMinor: number | null } | null,
  ): Promise<boolean> {
    const id = await s.transaction(async (tx) => {
      const inserted = await insertFound(tx, row);
      if (inserted === undefined) return undefined;
      if (notify !== null) {
        await d.notifications.notify(tx, {
          kind: "deduction",
          key: `${inserted}:found`,
          objectRef: { entity: "deduction", id: inserted },
          params: {
            kind: row.kind,
            ...(notify.amountMinor === null ? {} : { amount: notify.amountMinor }),
          },
        });
      }
      await realtime.changed(tx, { entity: "deduction", ids: [inserted] });
      return inserted;
    });
    if (id !== undefined) log.info({ foundId: id, reason: row.kind }, "tax.found-created");
    return id !== undefined;
  }

  /** Социальный вычет за каждую оплату учреждению образования; сумма — калькулятор, заново не считается. */
  async function education(s: ScopedDb, today: LocalDate): Promise<number> {
    const year = Number(today.slice(0, 4));
    const words = await settings.get(EDUCATION_PAYEE_WORDS);
    const ops = await operationsOf(s, "education", `${String(year - 1)}-01-01`, today);
    let created = 0;
    for (const op of ops) {
      if (!isEducationPayee([op.merchantName, op.description], words)) continue;
      const basisKey = `tx:${op.id}`;
      if ((await findByBasis(s, "education", basisKey)) !== undefined) continue;
      const paid = op.amountInByn ?? (op.amount.currency === "BYN" ? op.amount : null);
      if (paid === null || paid.minor <= 0) continue;
      const result: DeductionResult = await d.calculate(s, { kind: "education", paid });
      if (result.status !== "ok" || result.savingTotal === null) continue;
      const inserted = await create(
        s,
        {
          kind: "education",
          basisKey,
          operationId: op.id,
          year: Number(op.occurredOn.slice(0, 4)),
          reason: null,
          amountMinor: result.savingTotal.amount.minor,
          traceId: result.savingTotal.traceId,
          basisOn: op.occurredOn,
          basisMinor: paid.minor,
          payee: op.merchantName,
          foundOn: today,
        },
        { amountMinor: result.savingTotal.amount.minor },
      );
      if (inserted) created += 1;
    }
    return created;
  }

  /** Стандартный вычет на детей: напоминание, пока в профиле есть дети до 18 лет; нет детей — активное напоминание убирается. */
  async function children(s: ScopedDb, today: LocalDate, underEighteen: number): Promise<number> {
    const kind = "children";
    const basisKey = "facts:children";
    if (underEighteen === 0) {
      await removeActive(s, kind, basisKey);
      return 0;
    }
    const result = await d.calculate(s, { kind });
    if (result.status !== "ok" || result.savingMonthly === null) return 0;
    const existing = await findByBasis(s, kind, basisKey);
    if (existing !== undefined) {
      await refreshAmount(
        s,
        existing.id,
        result.savingMonthly.amount.minor,
        result.savingMonthly.traceId,
      );
      return 0;
    }
    const inserted = await create(
      s,
      {
        kind,
        basisKey,
        year: Number(today.slice(0, 4)),
        reason: null,
        amountMinor: result.savingMonthly.amount.minor,
        traceId: result.savingMonthly.traceId,
        foundOn: today,
      },
      { amountMinor: result.savingMonthly.amount.minor },
    );
    return inserted ? 1 : 0;
  }

  /** Имущественный вычет: платежи по кредитам + учёт нуждающихся; учёт не отмечен — один вопрос (ответ — факт `housingQueue`). */
  async function housing(
    s: ScopedDb,
    today: LocalDate,
    queue: "now" | "before" | "no" | "unknown",
  ): Promise<number> {
    const kind = "housing";
    const basisKey = "facts:housing";
    const year = Number(today.slice(0, 4));
    const loans =
      queue === "no" ? [] : await operationsOf(s, "loans", `${String(year - 1)}-01-01`, today);
    const latest = loans
      .filter((op) => op.amountInByn !== null)
      .toSorted((a, b) => b.occurredOn.localeCompare(a.occurredOn))[0];
    if (latest === undefined) {
      await removeActive(s, kind, basisKey);
      return 0;
    }
    const reason = queue === "unknown" ? "ask-queue" : "check";
    const existing = await findByBasis(s, kind, basisKey);
    if (existing !== undefined) return switchReason(s, existing, reason);
    const inserted = await create(
      s,
      {
        kind,
        basisKey,
        operationId: latest.id,
        year,
        reason,
        basisOn: latest.occurredOn,
        basisMinor: latest.amountInByn?.minor ?? null,
        payee: latest.merchantName,
        foundOn: today,
      },
      reason === "check" ? { amountMinor: null } : null,
    );
    return inserted ? 1 : 0;
  }

  /** Человек ответил про учёт нуждающихся: вопрос становится находкой «проверьте условия» (и уведомлением один раз). */
  async function switchReason(
    s: ScopedDb,
    row: FoundRow,
    reason: "ask-queue" | "check",
  ): Promise<number> {
    if ((row.status !== "new" && row.status !== "shown") || row.reason === reason) return 0;
    await s.transaction(async (tx) => {
      await setReason(tx, row.id, reason);
      if (reason === "check") {
        await d.notifications.notify(tx, {
          kind: "deduction",
          key: `${row.id}:check`,
          objectRef: { entity: "deduction", id: row.id },
          params: { kind: "housing" },
        });
      }
      await realtime.changed(tx, { entity: "deduction", ids: [row.id] });
    });
    return 0;
  }

  return async function detect(s: ScopedDb): Promise<{ created: number }> {
    const today = clock.today();
    const facts = await d.profile.getFacts(s, ["children", "housingQueue"], today);
    let underEighteen = 0;
    let queue: "now" | "before" | "no" | "unknown" = "unknown";
    for (const fact of facts) {
      if (fact.value.key === "children") underEighteen = fact.evaluation?.childrenUnder18 ?? 0;
      if (fact.value.key === "housingQueue") queue = fact.value.status;
    }
    const created =
      (await education(s, today)) +
      (await children(s, today, underEighteen)) +
      (await housing(s, today, queue));
    return { created };
  };
}

export type Detect = ReturnType<typeof makeDetect>;
