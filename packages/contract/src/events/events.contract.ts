// События сайта (NFR-21, ADR-0005, ARCHITECTURE §10.1): поток сигналов «изменилось» и «как идёт фоновая работа».
// Данных в событии нет — сайт по сигналу перезапрашивает их обычными процедурами (TanStack Query invalidate),
// поэтому в поток не попадает ничего, что не прошло бы проверку доступа процедурой.
import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import { EntityId, EntityKind } from "../common.ts";
import { pickErrors } from "../errors.ts";

/** Ход фоновой работы (распознавание чека, импорт выписки); `percent` нет, если доля неизвестна. */
export const ProgressEvent = z.strictObject({
  type: z.literal("progress"),
  entity: EntityKind,
  id: EntityId,
  percent: z.int().min(0).max(100).optional(),
});

/** Объект изменился — сайт перезапрашивает его. */
export const ChangedEvent = z.strictObject({
  type: z.literal("changed"),
  entity: EntityKind,
  id: EntityId,
});

export const SiteEvent = z.discriminatedUnion("type", [ProgressEvent, ChangedEvent]);
export type SiteEvent = z.infer<typeof SiteEvent>;

export const eventsContract = {
  /** Поток событий своего домохозяйства (фильтр — на сервере по сессии, T-061); конец — событие done. */
  stream: oc
    .route({ method: "GET", path: "/events/stream" })
    .output(eventIterator(SiteEvent))
    .errors(pickErrors("UNAUTHORIZED")),
};
