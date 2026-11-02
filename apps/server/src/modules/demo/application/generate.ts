// Запись истории демо-пользователя (DEMO-01…02) — только через фасады модулей-владельцев: профиль и анкета (profile), счета
// (accounts), операции пачками выписки (transactions), чеки с готовым чтением (receipts, без модели), лимиты и цели (budgets),
// история итогов недели (weekly, шаблон). Ни одного вызова модели: категории заданы явно (источник «user»), чтение чеков —
// готовое, итоги недели — по шаблону; журнал расхода llm_usage остаётся пустым, повторный сброс не тратит лимиты (тест).
// Всё остальное — рекуррентные платежи, события календаря, найденные вычеты, пороги лимитов — вычисляют сами модули по
// событиям записанных операций, как у обычного пользователя. Вызывается под scope демо-пользователя, который отдаёт identity.
import { AccountId } from "@kosht/contract";
import { Money, type LocalDate } from "@kosht/kernel";
import { randomUUID } from "node:crypto";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { AccountsFacade } from "../../accounts/index.ts";
import type { BudgetsFacade } from "../../budgets/index.ts";
import type { FilesFacade } from "../../files/index.ts";
import type { MerchantsFacade } from "../../merchants/index.ts";
import type { ProfileFacade } from "../../profile/index.ts";
import type { ReceiptsFacade } from "../../receipts/index.ts";
import type { TransactionsFacade } from "../../transactions/index.ts";
import type { WeeklyFacade } from "../../weekly/index.ts";
import { RECEIPT_PHOTOS } from "../domain/photos.ts";
import {
  buildStory,
  STORY_ACCOUNTS,
  type AccountKey,
  type Story,
  type StoryOp,
} from "../domain/story.ts";

/** Сколько прошлых недель получают итог (WEEK-01: история). */
export const WEEKLY_HISTORY_WEEKS = 8;

export interface GenerateDeps {
  readonly platform: Pick<Platform, "clock" | "log">;
  readonly profile: Pick<ProfileFacade, "completeOnboarding" | "setFact">;
  readonly accounts: Pick<AccountsFacade, "create" | "cash" | "applyBalanceChange">;
  readonly merchants: Pick<MerchantsFacade, "resolve">;
  readonly transactions: Pick<TransactionsFacade, "importBatch" | "aggregate">;
  readonly files: Pick<FilesFacade, "save">;
  readonly receipts: Pick<ReceiptsFacade, "recordReady">;
  readonly budgets: Pick<BudgetsFacade, "setLimit" | "createGoal" | "contribute">;
  readonly weekly: Pick<WeeklyFacade, "backfill">;
}

/** Что записано — числа для лога, теста и ответа админке (без сумм и текстов, OBS-04). */
export interface GenerateReport {
  readonly operations: number;
  readonly receipts: number;
  readonly limits: number;
  readonly goals: number;
  readonly weeks: number;
}

/**
 * Лимиты месяца показа: проценты из design/demo-data.md (кафе 84 %, такси 112 %, продукты 73 %, развлечения 31 %). Сумма лимита
 * подбирается по тратам месяца, уже записанным (операции, чеки), поэтому проценты верны в любой день месяца.
 */
const LIMITS = [
  { code: "cafes", percent: 84, fallbackMinor: 20_000 },
  { code: "taxi", percent: 112, fallbackMinor: 10_000 },
  { code: "groceries", percent: 73, fallbackMinor: 70_000 },
  { code: "leisure", percent: 31, fallbackMinor: 15_000 },
] as const;

/** Лимит в целых рублях так, чтобы траты составили около `percent` % (меньше 100 — не ниже, больше 100 — не выше). */
export function limitFor(spentMinor: number, percent: number, fallbackMinor: number): number {
  if (spentMinor <= 0) return fallbackMinor;
  const exact = (spentMinor * 100) / percent;
  const rubles = percent < 100 ? Math.ceil(exact / 100) : Math.floor(exact / 100);
  return rubles >= 1 ? rubles * 100 : fallbackMinor;
}

export function makeGenerate(d: GenerateDeps) {
  const { clock, log } = d.platform;

  async function writeProfile(s: ScopedDb, story: Story): Promise<void> {
    // AUTH-07, PROF-01: анкета «пройдена» — демо не встречает пользователя вопросами; факты — как у человека, ответившего на анкету.
    await d.profile.completeOnboarding(s, {
      employment: ["employee"],
      children: story.children.map((child) => ({ name: child.name, birthDate: child.birthDate })),
      benefitCategory: false,
      youngSpecialist: false,
    });
    await d.profile.setFact(s, {
      value: { key: "mainEmployer", has: true, name: "ООО «ТехноСофт»" },
      source: "user",
      channel: "web",
    });
    // PROF-07: квартира есть — календарь ставит срок налога на недвижимость.
    await d.profile.setFact(s, {
      value: { key: "property.apartment", value: true },
      source: "user",
      channel: "web",
    });
  }

  /** Счета с начальными остатками, подобранными так, чтобы итог сошёлся (design/demo-data.md «Счета»). */
  async function writeAccounts(s: ScopedDb, story: Story): Promise<Map<AccountKey, string>> {
    const ids = new Map<AccountKey, string>();
    for (const account of STORY_ACCOUNTS) {
      const created = await d.accounts.create(
        s,
        {
          kind: account.kind,
          name: account.name,
          bank: account.bank,
          mask: account.mask,
          currency: account.currency,
          initialBalance: Money.of(story.openings[account.key], account.currency),
        },
        "web",
      );
      ids.set(account.key, created.account.id);
    }
    // «Наличные» создаёт регистрация; остаток на начало истории — сдвигом (начальный остаток у них не задаётся экраном).
    const cashId = await s.transaction(async (tx) => {
      const id = await d.accounts.cash(tx);
      await d.accounts.applyBalanceChange(tx, {
        accountId: id,
        delta: Money.of(story.openings.cash, "BYN"),
        on: story.start,
      });
      return id;
    });
    ids.set("cash", cashId);
    return ids;
  }

  /** Операции выписки пачками: сначала всё, кроме вторых сторон переводов, затем вторые стороны с парой (STMT-08). */
  async function writeOperations(
    s: ScopedDb,
    story: Story,
    accounts: ReadonlyMap<AccountKey, string>,
  ): Promise<number> {
    const descriptions = [...new Set(story.ops.map((op) => op.description))];
    const resolved = await d.merchants.resolve(descriptions);
    const merchantOf = new Map(descriptions.map((text, index) => [text, resolved[index]]));
    const rowOf = (op: StoryOp, extra: { refundOfIndex?: number; pairWithId?: string } = {}) => {
      const merchant = op.type === "transfer" ? undefined : merchantOf.get(op.description);
      return {
        accountId: accounts.get(op.account) ?? "",
        type: op.type,
        direction: op.direction,
        occurredOn: op.on,
        amount: Money.of(op.minor, op.currency),
        amountBynMinor: op.bynMinor,
        fxRateId: null,
        description: op.description,
        merchantName: merchant?.name ?? null,
        merchantKey: merchant?.key === undefined || merchant.key === "" ? null : merchant.key,
        category: op.category === null ? null : { code: op.category, source: "user" },
        dedupeKey: `demo:${op.key}`,
        ...(op.cashCounterpart === true ? { cashCounterpart: true } : {}),
        ...extra,
      };
    };

    const first = story.ops.filter((op) => op.pairOf === undefined);
    const indexOf = new Map(first.map((op, index) => [op.key, index]));
    const rows = first.map((op) =>
      rowOf(op, op.refundOf === undefined ? {} : { refundOfIndex: indexOf.get(op.refundOf) ?? -1 }),
    );
    const written = await s.transaction((tx) =>
      d.transactions.importBatch(tx, { importId: randomUUID(), rows }),
    );
    const second = story.ops.filter((op) => op.pairOf !== undefined);
    if (second.length > 0) {
      await s.transaction((tx) =>
        d.transactions.importBatch(tx, {
          importId: randomUUID(),
          rows: second.map((op) =>
            rowOf(op, { pairWithId: written.ids[indexOf.get(op.pairOf ?? "") ?? -1] ?? "" }),
          ),
        }),
      );
    }
    return story.ops.length;
  }

  /** Чеки по порядку от старых к новым: фото в файлах, чтение — готовое (RCPT-05…07), совпадение с платежом ищет receipts. */
  async function writeReceipts(s: ScopedDb, story: Story): Promise<number> {
    for (const receipt of story.receipts.toSorted((a, b) => a.on.localeCompare(b.on))) {
      const photo = await d.files.save(s, {
        kind: "receipt-photo",
        name: `${receipt.key}.jpg`,
        mime: "image/jpeg",
        content: new Uint8Array(Buffer.from(RECEIPT_PHOTOS[receipt.key], "base64")),
      });
      await d.receipts.recordReady(s, {
        fileId: photo.id,
        reading: { ...receipt.reading, items: receipt.reading.items.map((item) => ({ ...item })) },
        rechecks: receipt.rechecks,
        categories: receipt.categories,
      });
    }
    return story.receipts.length;
  }

  /** Лимиты и цели (BUD-01, BUD-04): суммы лимитов — по тратам месяца показа, цель по счёту — на накопительный «Отпуск». */
  async function writeBudgets(
    s: ScopedDb,
    story: Story,
    accounts: ReadonlyMap<AccountKey, string>,
  ): Promise<{ limits: number; goals: number }> {
    const monthStart = `${story.today.slice(0, 7)}-01` as LocalDate;
    const month = await d.transactions.aggregate(s, {
      from: monthStart,
      to: story.today,
      groupBy: "category",
    });
    for (const limit of LIMITS) {
      const spent = month.groups.find((group) => group.key === `system:${limit.code}`);
      await d.budgets.setLimit(
        s,
        {
          categoryKey: `system:${limit.code}`,
          limit: Money.of(
            limitFor(spent?.expense.value.minor ?? 0, limit.percent, limit.fallbackMinor),
            "BYN",
          ),
        },
        "web",
      );
    }
    for (const goal of story.goals) {
      const created = await d.budgets.createGoal(
        s,
        {
          name: goal.name,
          kind: goal.kind,
          target: Money.of(goal.targetMinor, "BYN"),
          deadline: goal.deadline,
          ...(goal.kind === "account"
            ? { accountId: AccountId.parse(accounts.get("savings")) }
            : {}),
        },
        "web",
      );
      for (const minor of goal.contributions) {
        await d.budgets.contribute(
          s,
          { goalId: created.goal.id, amount: Money.of(minor, "BYN") },
          "web",
        );
      }
    }
    return { limits: LIMITS.length, goals: story.goals.length };
  }

  /** Записать историю демо-пользователя на сегодня; пустой пользователь (после `privacy.purge`) — обязательное условие. */
  return async function generate(s: ScopedDb): Promise<GenerateReport> {
    const story = buildStory({ today: clock.today() });
    await writeProfile(s, story);
    const accounts = await writeAccounts(s, story);
    const operations = await writeOperations(s, story, accounts);
    const receipts = await writeReceipts(s, story);
    const budgets = await writeBudgets(s, story, accounts);
    const weeks = await d.weekly.backfill(s, { weeks: WEEKLY_HISTORY_WEEKS });
    const report = { operations, receipts, ...budgets, weeks };
    log.info(report, "demo.generated");
    return report;
  };
}

export type Generate = ReturnType<typeof makeGenerate>;
