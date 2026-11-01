// Диалоги (CHAT-01): список, чтение, переименование, удаление. Чтение приводит зависшие ответы в порядок (CHAT-02):
// строка «идёт» без живого запуска в этом процессе — процесс упал или запуск оборвался — сохраняется как «оборван».
import {
  AnswerMetadata,
  ChatMessage,
  ConversationId,
  type ConversationItem,
} from "@kosht/contract";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { LegalBaseFacade } from "../../legal-base/index.ts";
import { lawVersionIdsOf, validParts } from "../domain/message-parts.ts";
import {
  conversationTitleOf,
  deleteConversation,
  finishMessage,
  latestConversation,
  listConversations,
  listMessages,
  renameConversation,
} from "../infrastructure/db/chat.repo.ts";
import type { LiveRuns } from "./live-runs.ts";

export interface DialogDeps {
  readonly live: LiveRuns;
}

export interface HistoryDeps extends DialogDeps {
  /** CHAT-10: какие версии статей уже не текущие. */
  readonly legalBase: Pick<LegalBaseFacade, "citations">;
  readonly log: Pick<Logger, "warn">;
}

/** Сколько диалогов отдаёт список; старше — не видны (поиска по диалогам в MVP нет). */
const LIST_LIMIT = 200;
const PREVIEW_MAX = 120;

/** Начало текста сообщения для строки списка: текстовые части, пробелы свёрнуты. */
export function previewOf(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const text = parts
    .flatMap((part: unknown) =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length <= PREVIEW_MAX ? text : `${text.slice(0, PREVIEW_MAX - 1).trimEnd()}…`;
}

export function makeConversations() {
  return async function conversations(s: ScopedDb): Promise<{ items: ConversationItem[] }> {
    const rows = await listConversations(s, LIST_LIMIT);
    return {
      items: rows.map((row) => ({
        id: ConversationId.parse(row.id),
        title: row.title,
        updatedAt: row.updatedAt.toISOString(),
        preview: previewOf(row.lastParts),
      })),
    };
  };
}

/**
 * CHAT-10: из версий статей, названных в ответах, — те, что заменены новой редакцией. Сбой базы законов не роняет чтение
 * диалога: пометки в этот раз нет (она появится при следующем чтении), в лог — ключ события.
 */
async function changedVersions(
  d: HistoryDeps,
  versionIds: readonly string[],
): Promise<Set<string>> {
  if (versionIds.length === 0) return new Set();
  try {
    const rows = await d.legalBase.citations(versionIds);
    return new Set(rows.filter((row) => !row.isCurrent).map((row) => row.versionId));
  } catch (error) {
    d.log.warn({ err: error }, "chat.law-check-failed");
    return new Set();
  }
}

/** Диалог и сообщения; без id — последний. Чужой id неотличим от несуществующего (NOT_FOUND). */
export function makeHistory(d: HistoryDeps) {
  return async function history(s: ScopedDb, conversationId?: ConversationId) {
    const id = conversationId ?? (await latestConversation(s));
    if (id === undefined) return { conversationId: null, title: null, messages: [] };
    const dialog = await conversationTitleOf(s, id);
    if (dialog === undefined) throw new AppError("NOT_FOUND");
    const rows = await listMessages(s, id);
    const prepared = await Promise.all(
      rows.map(async (row) => {
        let status = row.status;
        if (status === "streaming" && !d.live.has(s.scope.householdId, row.id)) {
          // CHAT-02: «идёт» без живого запуска — оборван; сохраняем, чтобы состояние не гадалось при каждом чтении.
          await finishMessage(s, row.id, row.parts, "interrupted");
          status = "interrupted";
        }
        const { parts, dropped } = validParts(row.parts);
        // CHAT-04: часть, не прошедшая схему реестра, на сайт не уходит — без id и текста в логе (OBS-04).
        if (dropped > 0) d.log.warn({ messageId: row.id, count: dropped }, "chat.part-dropped");
        return { row, parts, status };
      }),
    );
    const changed = await changedVersions(d, [
      ...new Set(prepared.flatMap(({ parts }) => lawVersionIdsOf(parts))),
    ]);
    const messages = prepared.map(({ row, parts, status }) => {
      const answeredBy = AnswerMetadata.shape.answeredBy.safeParse(row.answeredBy);
      const stale = lawVersionIdsOf(parts).filter((versionId) => changed.has(versionId));
      return ChatMessage.parse({
        id: row.id,
        role: row.role,
        parts,
        status,
        ...(answeredBy.success ? { answeredBy: answeredBy.data } : {}),
        ...(stale.length === 0 ? {} : { changedVersionIds: stale }),
      });
    });
    return { conversationId: ConversationId.parse(id), title: dialog.title, messages };
  };
}

export function makeRenameConversation() {
  return async function rename(
    s: ScopedDb,
    input: { readonly conversationId: ConversationId; readonly title: string },
  ): Promise<void> {
    if (!(await renameConversation(s, input.conversationId, input.title))) {
      throw new AppError("NOT_FOUND");
    }
  };
}

/** Удалить диалог: идущий в нём ответ останавливается, сообщения уходят каскадом. */
export function makeRemoveConversation(d: DialogDeps) {
  return async function remove(
    s: ScopedDb,
    input: { readonly conversationId: ConversationId },
  ): Promise<void> {
    d.live.abortConversation(s.scope.householdId, input.conversationId);
    if (!(await deleteConversation(s, input.conversationId))) throw new AppError("NOT_FOUND");
  };
}
