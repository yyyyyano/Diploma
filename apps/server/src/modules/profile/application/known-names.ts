// Словарь имён для маскирования (PRIV-03, ADR-0009): имена детей из фактов профиля — те, что человек сам назвал
// («Дочь Анна, 7 лет»). Источник регистрируется в корне композиции (defineModule({ knownNamesSource })), шлюз llm
// склоняет эти имена и меняет их метками перед облаком. Читается только действующее (удалённый факт имён не отдаёт,
// PROF-05); «чьи данные» — только scope, который пришёл от шлюза.
import type { Scope } from "@kosht/kernel";
import type { Platform } from "../../../platform/module/define-module.ts";
import { listLiveFacts } from "../infrastructure/db/profile.repo.ts";

export function makeKnownNames(d: Pick<Platform, "scoped">) {
  return async function knownNames(scope: Scope): Promise<readonly string[]> {
    const rows = await listLiveFacts(d.scoped(scope), ["children"]);
    const names = rows.flatMap((row) => {
      const value = row.value as { children?: readonly { name?: string | null }[] };
      return (value.children ?? []).flatMap((child) => {
        const name = child.name?.trim();
        return name === undefined || name === "" ? [] : [name];
      });
    });
    return [...new Set(names)];
  };
}
