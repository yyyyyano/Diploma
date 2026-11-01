// AFF-03: какая цель «сдвинется», если нехватку остатка закрыть из накоплений. Берётся цель, в которой накоплено не меньше
// нехватки и у которой есть положительный рекомендуемый взнос (по нему считается сдвиг); из нескольких — с наибольшим накоплением,
// при равенстве — по id (повторный расчёт даёт тот же выбор).
import type { Money } from "@kosht/kernel";

export interface GoalCandidate {
  readonly id: string;
  readonly saved: Money | null;
  readonly contribution: Money | null;
}

export function pickGoal<T extends GoalCandidate>(
  shortfallMinor: number,
  goals: readonly T[],
): T | null {
  const fits = goals.filter(
    (goal) =>
      goal.saved !== null &&
      goal.saved.minor >= shortfallMinor &&
      goal.contribution !== null &&
      goal.contribution.minor > 0,
  );
  const sorted = fits.toSorted(
    (a, b) => (b.saved?.minor ?? 0) - (a.saved?.minor ?? 0) || a.id.localeCompare(b.id),
  );
  return sorted[0] ?? null;
}
