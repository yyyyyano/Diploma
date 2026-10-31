// Состояние акта на вкладке «Законы» (LAW-40): шесть статусов администратора и «ждёт загрузки». Один акт — одно состояние; порядок
// проверок — от самого важного для человека: утрата силы, ошибка, карантин, «только карточка», загрузка, принятые изменения.
export type AdminStatus =
  | "active"
  | "has-changes"
  | "card-only"
  | "repealed"
  | "quarantined"
  | "failed"
  | "pending";

export const ADMIN_STATUSES: readonly AdminStatus[] = [
  "active",
  "has-changes",
  "card-only",
  "repealed",
  "quarantined",
  "failed",
  "pending",
];

export interface StatusInput {
  readonly status: string;
  readonly hasText: boolean;
  readonly loadState: string;
  /** Принятые, но не вошедшие в текст изменения. */
  readonly pending: number;
}

export function adminStatusOf(act: StatusInput): AdminStatus {
  if (act.status === "repealed") return "repealed";
  if (act.loadState === "failed") return "failed";
  if (act.loadState === "quarantined") return "quarantined";
  if (!act.hasText) return "card-only";
  if (act.loadState === "pending") return "pending";
  return act.pending > 0 ? "has-changes" : "active";
}
