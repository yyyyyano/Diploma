// Кэш курсов НБРБ (publicTable currency_rates) — только через SystemDb модуля fx-rates.
import { and, eq } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import type { FxRate } from "../../domain/fx-rate.ts";
import { currencyRates } from "./schema.ts";

export async function findCachedRate(
  db: SystemDb,
  currency: string,
  onDate: string,
): Promise<FxRate | undefined> {
  const rows = await db
    .select({
      id: currencyRates.id,
      currency: currencyRates.currency,
      rateDate: currencyRates.rateDate,
      rateE4: currencyRates.rateE4,
      scale: currencyRates.scale,
    })
    .from(currencyRates)
    .where(and(eq(currencyRates.currency, currency), eq(currencyRates.onDate, onDate)));
  return rows[0];
}

/** Запомнить курс на день; параллельная запись того же дня — побеждает первая, вернётся она. */
export async function saveRate(
  db: SystemDb,
  onDate: string,
  rate: Omit<FxRate, "id">,
  at: Date,
): Promise<FxRate> {
  await db
    .insert(currencyRates)
    .values({ ...rate, onDate, fetchedAt: at })
    .onConflictDoNothing({ target: [currencyRates.currency, currencyRates.onDate] });
  const saved = await findCachedRate(db, rate.currency, onDate);
  if (saved === undefined) throw new Error("currency_rates: курс не сохранился.");
  return saved;
}
