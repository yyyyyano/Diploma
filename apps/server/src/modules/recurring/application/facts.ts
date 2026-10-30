// PROF-03, REC-04: факты-предположения «регулярный доход» и «обязательные платежи» в месяц — вывод из регулярных
// платежей. Пишутся через profile.upsertDerivedFact («предположение»; подтверждённое человеком не перетирается), и
// только когда сумма изменилась: повторный пересчёт ничего не пишет.
import { monthlyTotal } from "@kosht/calc";
import { Money } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { Deps } from "./deps.ts";
import { toEntry, totalsOf } from "./view.ts";
import { listItems } from "../infrastructure/db/recurring.repo.ts";

const KEYS = ["income.regular", "obligations.regular"] as const;

export function makeSyncFacts(d: Pick<Deps, "platform" | "profile">) {
  return async function syncFacts(s: ScopedDb): Promise<void> {
    const today = d.platform.clock.today();
    const entries = (await listItems(s)).map((row) => toEntry(row, today));
    const income = totalsOf(entries, "income").monthly;
    const obligations = monthlyTotal(
      "recurring.monthlyTotal",
      (["mandatory", "subscriptions"] as const).flatMap((section) => {
        const total = totalsOf(entries, section).monthly;
        return total === null ? [] : [total];
      }),
    );
    const wanted: Record<(typeof KEYS)[number], Money | undefined> = {
      "income.regular": income?.value,
      "obligations.regular": obligations.value,
    };
    const current = await d.profile.getFacts(s, KEYS, today);
    for (const key of KEYS) {
      const amount = wanted[key];
      if (amount === undefined || amount.minor === 0) continue;
      const existing = current.find((fact) => fact.value.key === key);
      const same =
        existing !== undefined &&
        "amount" in existing.value &&
        existing.value.amount.minor === amount.minor;
      if (same) continue;
      await d.profile.upsertDerivedFact(s, {
        value: { key, amount },
        source: "system",
        sourceRef: "recurring",
      });
    }
  };
}
