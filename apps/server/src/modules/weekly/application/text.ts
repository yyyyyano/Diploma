// Текст итогов недели (WEEK-02, P1): модель пишет только по готовым числам; страж чисел сверяет каждое число её текста с числами
// сводки (`NumberLedger` из llm) — выдуманное число отбрасывает весь текст, и сводка выходит по шаблону. Нет модели (нет согласия
// на облако, локальная не скачана, ответ вне схемы) — тоже шаблон: итог всё равно выходит. Вызов модели — вне транзакции.
import type { WeeklyTextSource } from "@kosht/contract";
import { createWeeklyT, formatDate, formatMoney } from "@kosht/i18n";
import { NumberLedger } from "../../llm/index.ts";
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { templateText, UPCOMING_DAYS, type WeeklyFacts } from "../domain/template.ts";
import type { Deps } from "./deps.ts";

/** Версия подсказки — ключ кассет; правка подсказки повышает её. */
export const PROMPT_VERSION = "weekly-summary-1";

const Answer = z.strictObject({ text: z.string().trim().min(1).max(1200) });

const INSTRUCTIONS = [
  "Write a short weekly money summary in Russian for the user: 2 to 4 sentences, plain friendly tone, address the user as 'вы'.",
  "Use ONLY the facts and numbers in the document. Copy amounts, percents and dates exactly as written there.",
  "Never compute, round, add or invent numbers; never give advice; never name banks or credit products.",
  "Cover, when present in the document: last week's spending and how it compares with usual, the biggest category,",
  "limits at 80% or more, payments and events of the coming days, found tax deductions. Skip anything that is absent.",
].join(" ");

/** Документ для модели: те же числа, что видит человек, — готовыми строками (деньги, даты), чтобы модель их копировала, а не считала. */
export function documentOf(facts: WeeklyFacts): Record<string, unknown> {
  return {
    week: `${formatDate(facts.weekStart)} — ${formatDate(facts.weekEnd)}`,
    spent: formatMoney(facts.spent.amount),
    usualPerWeek: facts.average === null ? null : formatMoney(facts.average.amount),
    changeVsUsualPercent: facts.deviation?.percent ?? null,
    biggestCategories: facts.categories.map((c) => ({
      name: c.name,
      spent: formatMoney(c.amount.amount),
    })),
    limitsAt80OrMore: facts.limits.map((l) => ({ name: l.name, usedPercent: l.percent })),
    comingDays: UPCOMING_DAYS,
    comingPaymentsTotal:
      facts.upcoming.payments === null ? null : formatMoney(facts.upcoming.payments.amount),
    comingItems: facts.upcoming.items.map((i) => ({
      title: i.title,
      date: formatDate(i.on),
      amount: i.amount === null ? null : formatMoney(i.amount),
    })),
    foundDeductions: facts.foundDeductions,
  };
}

export function makeText(d: Pick<Deps, "llm" | "platform">) {
  const t = createWeeklyT();

  /** Текст сводки и откуда он: модель (числа проверены) или шаблон. */
  async function compose(
    s: ScopedDb,
    facts: WeeklyFacts,
  ): Promise<{ text: string; source: WeeklyTextSource }> {
    const template = templateText(facts, t);
    const document = documentOf(facts);
    let text: string;
    try {
      const answer = await d.llm.extract(s.scope, {
        task: "weekly.summary",
        schema: Answer,
        instructions: INSTRUCTIONS,
        document: JSON.stringify(document),
        promptVersion: PROMPT_VERSION,
      });
      text = answer.text;
    } catch (error) {
      // Нет модели или ответ вне схемы — не ошибка сводки: выходит шаблон; в лог — только причина, без текстов (OBS-04).
      d.platform.log.warn(
        { reason: error instanceof Error ? error.name : "unknown" },
        "weekly.text-fallback",
      );
      return { text: template, source: "template" };
    }
    const ledger = new NumberLedger();
    ledger.addJson(document);
    const unverified = ledger.unverified(text);
    if (unverified.length > 0) {
      d.platform.log.warn({ count: unverified.length }, "weekly.number-unverified");
      return { text: template, source: "template" };
    }
    return { text, source: "model" };
  }

  /** Только шаблон — без модели: история демо (DEMO-01) не тратит лимиты и не зависит от согласия на облако. */
  function template(facts: WeeklyFacts): string {
    return templateText(facts, t);
  }

  return { compose, template };
}

export type Text = ReturnType<typeof makeText>;
