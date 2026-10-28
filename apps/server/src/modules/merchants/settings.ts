// Пороги похожести названий (STMT-06, TXN-10): настройки, а не константы — админка меняет их без перезапуска.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

/** Похожесть очищенного описания на алиас справочника (pg_trgm similarity, 0…1), с которой контрагент узнан. */
export const ALIAS_SIMILARITY = defineSetting({
  key: "merchants.alias-similarity",
  schema: z.number().min(0.3).max(1),
  default: 0.6,
});

/** Похожесть двух названий (fuzzball token_set_ratio, 0…100), с которой это «тот же магазин» (TXN-10). */
export const NAME_SIMILARITY = defineSetting({
  key: "merchants.name-similarity",
  schema: z.int().min(50).max(100),
  default: 85,
});
