// TAX-01, PROF-06: сколько детей даёт стандартный вычет (ст. 209 п. 1.2 НК) на сегодня и какой он — обычный или повышенный.
import type { FactEvaluation, FamilyStatus } from "@kosht/contract";

export interface StandardChildren {
  /** Дети до 18 лет на сегодня; возраст которых не известен, не считаются. */
  readonly count: number;
  /** Повышенный вычет на каждого: двое и более детей, ребёнок-инвалид, одинокий родитель, вдова (вдовец), опекун, приёмный родитель. */
  readonly increased: boolean;
}

/** `children` — дети из факта профиля (нужен признак инвалидности), `evaluation` — возраст на сегодня (PROF-06). */
export function standardChildren(
  children: readonly { readonly disability: boolean }[] | undefined,
  evaluation: FactEvaluation | null | undefined,
  statuses: readonly FamilyStatus[],
): StandardChildren {
  const ages = evaluation?.childAges ?? [];
  const under18 = (children ?? []).filter((_, index) => {
    const age = ages[index];
    return age !== undefined && age !== null && age < 18;
  });
  const count = under18.length;
  const increased =
    count >= 2 || under18.some((child) => child.disability) || (count >= 1 && statuses.length > 0);
  return { count, increased };
}
