// Сохранённое объяснение числа (EXPL-02): трасса расчёта, период и момент сохранения.
import type { Period, TraceNode } from "@kosht/kernel";

export interface StoredExplanation {
  readonly id: string;
  readonly trace: TraceNode;
  readonly period: Period | undefined;
  readonly createdAt: Date;
}
