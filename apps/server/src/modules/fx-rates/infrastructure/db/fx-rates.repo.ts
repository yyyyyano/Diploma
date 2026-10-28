// Кэш курсов НБРБ (publicTable fx_rates) — только через SystemDb модуля fx-rates.
import { and, eq } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import type { FxRate } from "../../domain/fx-rate.ts";
import { fxRates } from "./schema.ts";

export async function findCachedRate(
  db: SystemDb,
  currency: string,
  onDate: string,
): Promise<FxRate | undefined> {
  const rows = await db
    .select({
      id: fxRates.id,
      currency: fxRates.currency,
      rateDate: fxRates.rateDate,
      rateE4: fxRates.rateE4,
      scale: fxRates.scale,
    })
    .from(fxRates)
    .where(and(eq(fxRates.currency, currency), eq(fxRates.onDate, onDate)));
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
    .insert(fxRates)
    .values({ ...rate, onDate, fetchedAt: at })
    .onConflictDoNothing({ target: [fxRates.currency, fxRates.onDate] });
  const saved = await findCachedRate(db, rate.currency, onDate);
  if (saved === undefined) throw new Error("fx_rates: курс не сохранился.");
  return saved;
}
