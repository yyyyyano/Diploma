// Сверка таблицы ставок с новой редакцией закона (LAW-33): после `legal-base.act-updated` для каждого подтверждённого значения
// с источником в тексте pravo.by ищем его число в действующих фрагментах пункта. Нет числа — пометка «вероятное расхождение» и
// уведомление администратору; само значение НЕ меняется, новое подтверждает человек. Число снова на месте — пометка снимается.
// Ссылка на версию фрагмента заполняется, когда акт проиндексирован. Текста у акта нет — молчим: нечего сверять.
import { createHash } from "node:crypto";
import type { Clock } from "@kosht/kernel";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { LegalBaseFacade } from "../../legal-base/index.ts";
import type { NotificationsFacade } from "../../notifications/index.ts";
import { paramDef, valueInText } from "../domain/params.ts";
import { checkableRates, markCheck } from "../infrastructure/db/rates.repo.ts";

export interface DriftCheckDeps {
  readonly system: SystemDb;
  readonly legalBase: Pick<LegalBaseFacade, "fragmentsUnder">;
  readonly notifications: Pick<NotificationsFacade, "notifyAdmins">;
  readonly clock: Clock;
  readonly log: Logger;
}

export interface DriftResult {
  readonly checked: number;
  readonly drifted: number;
}

export function makeDriftCheck(d: DriftCheckDeps) {
  return async function run(): Promise<DriftResult> {
    let checked = 0;
    let drifted = 0;
    for (const rate of await checkableRates(d.system, d.clock.today())) {
      const unit = paramDef(rate.param)?.unit;
      if (unit === undefined || rate.sourceAct === null || rate.sourcePath === null) continue;
      const fragments = await d.legalBase.fragmentsUnder(rate.sourceAct, rate.sourcePath);
      if (fragments.length === 0) continue;
      checked += 1;
      const holder = fragments.find((f) => valueInText(unit, rate.value, f.text));
      if (holder !== undefined) {
        // Число на месте: пометку снимаем, версию запоминаем (она же — «источник: редакция»).
        if (rate.driftAt !== null || rate.sourceVersionId !== holder.versionId) {
          await markCheck(d.system, rate.id, { driftAt: null, sourceVersionId: holder.versionId });
        }
        continue;
      }
      drifted += 1;
      if (rate.driftAt === null) {
        await markCheck(d.system, rate.id, {
          driftAt: d.clock.now(),
          sourceVersionId: rate.sourceVersionId,
        });
      }
      // Ключ — ставка и состав версий фрагментов: новая редакция с тем же расхождением не шлёт второе уведомление, следующая — шлёт.
      const versions = createHash("sha1")
        .update(
          fragments
            .map((f) => f.versionId)
            .toSorted((a, b) => a.localeCompare(b))
            .join(","),
        )
        .digest("hex")
        .slice(0, 12);
      await d.notifications.notifyAdmins({
        kind: "rates-mismatch",
        key: `rates:${rate.id}:${versions}`,
      });
      d.log.warn({ count: drifted }, "rates.drift-found");
    }
    return { checked, drifted };
  };
}

export type DriftCheck = ReturnType<typeof makeDriftCheck>;
