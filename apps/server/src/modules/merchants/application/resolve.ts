// Контрагенты по описаниям из выписки (STMT-06, CAT-03): очистка от шума, затем справочник РБ — точный алиас, иначе
// самый похожий по pg_trgm (порог — настройка). Результат — название для человека, код встроенной категории
// справочника (глобальное правило) и MCC, если был в описании. Исходное описание не меняется — его хранит операция.
// Похожесть двух названий для сопоставления чека и выписки (TXN-10) — fuzzball token_set_ratio.
import { token_set_ratio } from "fuzzball";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import type { Settings } from "../../../platform/settings/settings.ts";
import { cleanDescription, normalizeItemName, titleCase } from "../domain/clean-name.ts";
import {
  findAliases,
  findSimilarAlias,
  type DirectoryHit,
} from "../infrastructure/db/directory.repo.ts";
import { ALIAS_SIMILARITY, NAME_SIMILARITY } from "../settings.ts";

export interface MerchantInfo {
  /** Исходное описание — как пришло. */
  readonly original: string;
  /** Ключ сравнения после очистки («EVROTORG»); пусто — описание из одного шума. */
  readonly key: string;
  /** Название для человека: из справочника («Евроопт») или ключ с заглавных. */
  readonly name: string;
  /** Контрагент справочника или null. */
  readonly merchantId: string | null;
  /** Код встроенной категории справочника (глобальное правило) или null. */
  readonly categoryCode: string | null;
  readonly mcc: string | null;
}

export interface ResolveDeps {
  readonly system: SystemDb;
  readonly settings: Pick<Settings, "get">;
}

export function makeResolve(d: ResolveDeps) {
  /** Пачка описаний → контрагенты в том же порядке (один запрос точных алиасов, похожие — по одному непокрытому). */
  async function resolve(descriptions: readonly string[]): Promise<MerchantInfo[]> {
    const cleaned = descriptions.map((original) => ({ original, ...cleanDescription(original) }));
    const candidates = new Set<string>();
    for (const { key } of cleaned) {
      if (key === "") continue;
      candidates.add(key);
      candidates.add(key.split(" ")[0] ?? key);
    }
    const exact = new Map(
      (await findAliases(d.system, [...candidates])).map((hit) => [hit.alias, hit]),
    );
    const threshold = await d.settings.get(ALIAS_SIMILARITY);
    const similar = new Map<string, DirectoryHit | undefined>();
    const result: MerchantInfo[] = [];
    for (const { original, key, mcc } of cleaned) {
      let hit = exact.get(key) ?? exact.get(key.split(" ")[0] ?? key);
      if (hit === undefined && key !== "") {
        if (!similar.has(key)) similar.set(key, await findSimilarAlias(d.system, key, threshold));
        hit = similar.get(key);
      }
      result.push({
        original,
        key,
        name: hit?.name ?? titleCase(key),
        merchantId: hit?.merchantId ?? null,
        categoryCode: hit?.categoryCode ?? null,
        mcc,
      });
    }
    return result;
  }

  /** TXN-10: похожесть двух названий 0…100 (порядок и повторы слов не важны). */
  function similarity(a: string, b: string): number {
    return token_set_ratio(cleanDescription(a).key, cleanDescription(b).key);
  }

  /** Это один и тот же контрагент: похожесть не ниже настройки merchants.name-similarity. */
  async function isSameMerchant(a: string, b: string): Promise<boolean> {
    return similarity(a, b) >= (await d.settings.get(NAME_SIMILARITY));
  }

  return { resolve, similarity, isSameMerchant, normalizeItemName };
}

export type Resolve = ReturnType<typeof makeResolve>;
