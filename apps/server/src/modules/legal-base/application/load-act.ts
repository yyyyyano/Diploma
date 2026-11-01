// Загрузка одного акта (LAW-10, LAW-20, LAW-39): страница от источника → хэш → разбор на фрагменты → проверка карантина
// и канарейки → снимок и фрагменты. Сеть — до транзакции. При карантине действующая редакция остаётся, администратор
// получает уведомление «вероятно, изменилась вёрстка»; автоматически ничего не удаляется. Изменившаяся страница без
// признаков поломки применяется как новая редакция: версии фрагментов сопоставляются по пути и тексту (LAW-31, T-036).
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { Clock } from "@kosht/kernel";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { NotificationsFacade } from "../../notifications/index.ts";
import { actUpdated } from "../events.ts";
import { matchVersions } from "../domain/match-versions.ts";
import { assessSnapshot, canaryOf } from "../domain/quarantine.ts";
import {
  appliedHash,
  applyEdition,
  applyFirstSnapshot,
  currentVersions,
  findAct,
  logUpdate,
  markActState,
  storeQuarantinedSnapshot,
} from "../infrastructure/db/catalog.repo.ts";
import { startCatalogLabels } from "../infrastructure/db/dictionaries.repo.ts";
import { parseActPage } from "../infrastructure/pravo-by/parse-act.ts";
import { ActTextNotFound, type LegalSource } from "./ports.ts";
import type { PublishSystemEvent } from "./system-events.ts";

export type LoadOutcome =
  | "applied"
  | "unchanged"
  | "changed"
  | "quarantined"
  | "card-only"
  | "unknown-act";

export interface LoadActDeps {
  readonly system: SystemDb;
  readonly source: () => Promise<LegalSource>;
  readonly clock: Clock;
  readonly log: Logger;
  readonly notifications: Pick<NotificationsFacade, "notifyAdmins">;
  /** LAW-33: первая загрузка акта сообщает `act-updated` — сверка ставок привязывает источники к версиям на свежей установке. */
  readonly publish?: PublishSystemEvent;
}

export function makeLoadAct(d: LoadActDeps) {
  return async function loadAct(pravoId: string, signal?: AbortSignal): Promise<LoadOutcome> {
    const act = await findAct(d.system, pravoId);
    if (act === undefined) return "unknown-act";
    if (!act.hasText) return "card-only";
    signal?.throwIfAborted();

    let page;
    try {
      page = await (await d.source()).fetchActText(pravoId);
    } catch (error) {
      if (!(error instanceof ActTextNotFound)) throw error;
      // 404: у акта на pravo.by только карточка (LEGAL-06) — так и записываем, а не считаем ошибкой загрузки.
      await markActState(d.system, act.id, {
        loadState: "card-only",
        lastProblem: "text-not-found",
        hasText: false,
      });
      await logUpdate(d.system, { at: d.clock.now(), actId: act.id, event: "text-not-found" });
      d.log.info({ actId: act.id }, "law.act.text-not-found");
      return "card-only";
    }

    const textHash = createHash("sha256").update(page.html).digest("hex");
    if ((await appliedHash(d.system, act.id)) === textHash) {
      d.log.info({ actId: act.id }, "law.act.unchanged");
      return "unchanged";
    }

    const label = (await startCatalogLabels(d.system)).get(pravoId) ?? act.title;
    const { title, parsed, pageText } = parseActPage(page.html, label);
    const versions =
      act.currentSnapshotId === null ? undefined : await currentVersions(d.system, act.id);
    const canary = canaryOf(pravoId);
    const reasons = assessSnapshot({
      title,
      parsed,
      pageText,
      ...(versions === undefined ? {} : { previous: versions }),
      ...(canary === undefined ? {} : { canary }),
    });
    const snapshot = {
      actId: act.id,
      textHash,
      rawGz: gzipSync(Buffer.from(page.html, "utf8")),
      rawBytes: Buffer.byteLength(page.html, "utf8"),
      fetchedAt: page.fetchedAt,
    };

    if (reasons.length > 0) {
      await storeQuarantinedSnapshot(d.system, snapshot, reasons.join(","));
      await logUpdate(d.system, {
        at: d.clock.now(),
        actId: act.id,
        event: "quarantined",
        details: { reasons: reasons.join(",") },
      });
      await d.notifications.notifyAdmins({
        kind: "law-layout-changed",
        key: `${pravoId}:${textHash.slice(0, 12)}`,
        params: { pravoId },
      });
      d.log.warn({ actId: act.id, reason: reasons.join(".") }, "law.act.quarantined");
      return "quarantined";
    }

    if (act.currentSnapshotId !== null) {
      // LAW-31: новая редакция против действующих версий — по пути и тексту; векторы достраивает legal-base.embed.
      const plan = matchVersions(versions ?? [], parsed.fragments);
      const result = await applyEdition(d.system, snapshot, plan, parsed.articleCount);
      await logUpdate(d.system, {
        at: d.clock.now(),
        actId: act.id,
        event: "edition-applied",
        details: { ...result },
      });
      d.log.info({ actId: act.id, count: result.changed + result.added }, "law.act.changed");
      return "changed";
    }

    await applyFirstSnapshot(d.system, snapshot, parsed.fragments, parsed.articleCount);
    await logUpdate(d.system, {
      at: d.clock.now(),
      actId: act.id,
      event: "loaded",
      details: { fragments: parsed.fragments.length, articles: parsed.articleCount },
    });
    d.log.info({ actId: act.id, count: parsed.fragments.length }, "law.act.loaded");
    // LAW-33 (T-048): до первой смены редакции у акта не было события — источники ставок и сроков оставались непривязанными.
    await d.publish?.(actUpdated, [act.id]);
    return "applied";
  };
}

export type LoadAct = ReturnType<typeof makeLoadAct>;
