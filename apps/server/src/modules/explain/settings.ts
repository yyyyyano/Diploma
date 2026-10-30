// Настройки explain (EXPL-01, ADR-0017): сколько операций-оснований кладётся в трассу одного числа. Больше — в пояснении
// узла «ещё N операций»: трасса остаётся читаемой, а хранимый расчёт — небольшим.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

export const MAX_REFS = defineSetting({
  key: "explain.max-refs",
  schema: z.int().min(1).max(5000),
  default: 200,
});
