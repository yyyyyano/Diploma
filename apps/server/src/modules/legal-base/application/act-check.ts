// Проверка одного акта (LAW-30…34): карточка (утрата силы, изменяющие акты) и текст (лёгкая проверка HEAD, затем полная загрузка).
// Утрата силы — статус «утратил силу», событие `legal-base.act-repealed`, акт выходит из поиска (LAW-34). Изменяющий акт, которого
// ещё нет в тексте, — запись «принято, но не вступило» (LAW-32): с текстом изменяющего акта модель предлагает статьи и дату, а
// программа принимает только дословно найденное; без текста — предупреждение на уровне акта; через 7 дней без изменений —
// уведомление администратору. Новая редакция — событие `legal-base.act-updated` (LAW-31, норм-таблицы сверяют ставки, LAW-33).
import type { Clock } from "@kosht/kernel";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { NotificationsFacade } from "../../notifications/index.ts";
import { ChangeProposal, pravoIdOf, verifyProposal } from "../domain/change-proposal.ts";
import { actRepealed, actUpdated } from "../events.ts";
import { logUpdate } from "../infrastructure/db/catalog.repo.ts";
import {
  currentSnapshot,
  markChangeNotified,
  markRepealed,
  saveChangeAnalysis,
  syncPendingChanges,
  touchCardChecked,
  type PendingChangeRow,
} from "../infrastructure/db/changes.repo.ts";
import { changeKeysOfPage, parseCard } from "../infrastructure/pravo-by/parse-card.ts";
import { readActPage } from "../infrastructure/pravo-by/read-page.ts";
import type { LoadAct } from "./load-act.ts";
import { ActTextNotFound, type LegalSource, type RegistrySource } from "./ports.ts";
import type { PublishSystemEvent } from "./system-events.ts";

/** Через сколько дней ждущее изменение, которого нет в тексте, становится поводом для администратора (LAW-32). */
export const STALE_DAYS = 7;
const DAY_MS = 86_400_000;
/** Сколько знаков изменяющего акта отдаём модели (вся проверка — по полному тексту). */
const MAX_MODEL_CHARS = 20_000;

export interface ActCheckDeps {
  readonly system: SystemDb;
  readonly source: () => Promise<LegalSource & RegistrySource>;
  readonly loadAct: LoadAct;
  readonly publish: PublishSystemEvent;
  /** Предложение модели по тексту изменяющего акта (`systemCaller`, облачная цепочка: данных пользователя нет, PRIV-09). */
  readonly proposeChange: (document: string) => Promise<ChangeProposal>;
  readonly clock: Clock;
  readonly log: Logger;
  readonly notifications: Pick<NotificationsFacade, "notifyAdmins">;
}

export type CardOutcome = "ok" | "repealed";
export type TextOutcome =
  | "unchanged-head"
  | "updated"
  | "same"
  | "quarantined"
  | "applied"
  | "other";

export function makeActCheck(d: ActCheckDeps) {
  /** Разобрать изменяющий акт: есть текст — модель предлагает, программа проверяет дословно; нет текста — уровень акта. */
  async function analyze(row: PendingChangeRow, source: LegalSource): Promise<void> {
    let verified: { articles: string[]; inForceOn: string | null } = {
      articles: [],
      inForceOn: null,
    };
    const id = pravoIdOf(row.description);
    if (id !== null) {
      try {
        const page = await source.fetchActText(id);
        const text = readActPage(page.html)
          .paragraphs.map((p) => p.text)
          .join("\n");
        const proposal = await d.proposeChange(text.slice(0, MAX_MODEL_CHARS));
        verified = verifyProposal(proposal, text);
      } catch (error) {
        // Текста изменяющего акта нет или модель недоступна — предупреждение остаётся на уровне акта (LAW-32).
        if (!(error instanceof ActTextNotFound)) d.log.warn({}, "law.change.analysis-failed");
      }
    }
    await saveChangeAnalysis(d.system, row.id, verified, d.clock.now());
  }

  async function notifyStale(actId: string, rows: readonly PendingChangeRow[]): Promise<void> {
    const now = d.clock.now().getTime();
    for (const row of rows) {
      const since = Math.max(
        row.firstSeenAt.getTime(),
        row.inForceOn === null ? 0 : new Date(`${row.inForceOn}T00:00:00Z`).getTime(),
      );
      if (row.notifiedAt !== null || now - since < STALE_DAYS * DAY_MS) continue;
      await d.notifications.notifyAdmins({
        kind: "law-update-failed",
        key: `change-pending:${actId}:${row.changeKey}`,
        params: { reason: "CHANGE_NOT_REFLECTED" },
      });
      await markChangeNotified(d.system, row.id, d.clock.now());
    }
  }

  /** Карточка акта: утрата силы и изменения, не вошедшие в текст. */
  async function checkCard(act: { id: string; pravoId: string }): Promise<CardOutcome> {
    const source = await d.source();
    const card = parseCard((await source.fetchActCard(act.pravoId)).html);
    await touchCardChecked(d.system, act.id, d.clock.now());
    if (card.repealedOn !== null) {
      if (await markRepealed(d.system, act.id, card.repealedOn)) {
        await logUpdate(d.system, {
          at: d.clock.now(),
          actId: act.id,
          event: "repealed",
          details: { on: card.repealedOn },
        });
        await d.publish(actRepealed, [act.id]);
        d.log.info({ actId: act.id }, "law.act.repealed");
      }
      return "repealed";
    }
    const snapshot = await currentSnapshot(d.system, act.id);
    if (snapshot === undefined) return "ok";
    const rows = await syncPendingChanges(
      d.system,
      act.id,
      card.changes,
      changeKeysOfPage(snapshot.html),
      d.clock.now(),
    );
    for (const row of rows) if (row.analyzedAt === null) await analyze(row, source);
    await notifyStale(act.id, rows);
    return "ok";
  }

  /** Текст акта: HEAD без сжатия — размер совпал с последним снимком, страницу не качаем; иначе полная загрузка и сверка. */
  async function checkText(act: { id: string; pravoId: string }): Promise<TextOutcome> {
    const snapshot = await currentSnapshot(d.system, act.id);
    if (snapshot !== undefined) {
      try {
        const head = await (await d.source()).headActText(act.pravoId);
        if (head.contentLength === snapshot.rawBytes) return "unchanged-head";
      } catch (error) {
        if (!(error instanceof ActTextNotFound)) throw error;
      }
    }
    const outcome = await d.loadAct(act.pravoId);
    if (outcome === "changed") {
      await d.publish(actUpdated, [act.id]);
      return "updated";
    }
    if (outcome === "unchanged") return "same";
    if (outcome === "quarantined") return "quarantined";
    return outcome === "applied" ? "applied" : "other";
  }

  return { checkCard, checkText };
}

export type ActCheck = ReturnType<typeof makeActCheck>;
