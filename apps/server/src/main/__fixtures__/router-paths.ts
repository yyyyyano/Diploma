// Пути процедур дерева сервера и контракта («system.health») — для сверки «дерево реализует контракт ровно»: ветки
// модулей собираются из реестра, и типом полноту не проверить (main/router.ts).
import { isContractProcedure, type AnyContractRouter } from "@orpc/contract";
import { isProcedure } from "@orpc/server";

export function routerPaths(router: unknown, path = ""): string[] {
  if (isProcedure(router)) return [path];
  if (typeof router !== "object" || router === null) return [];
  return Object.entries(router)
    .flatMap(([key, child]: [string, unknown]) =>
      routerPaths(child, path === "" ? key : `${path}.${key}`),
    )
    .toSorted();
}

export function contractPaths(contract: AnyContractRouter, path = ""): string[] {
  if (isContractProcedure(contract)) return [path];
  return Object.entries(contract)
    .flatMap(([key, child]: [string, AnyContractRouter]) =>
      contractPaths(child, path === "" ? key : `${path}.${key}`),
    )
    .toSorted();
}
