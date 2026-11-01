// Контекст страницы для ассистента (CHAT-08, ARCHITECTURE §10.2): что пользователь видит сейчас — маршрут, параметры
// адреса (период, фильтры) и открытый объект. Собирается из адреса, а не из состояния экранов: период и фильтры уже
// живут в адресе (`.claude/rules/frontend-feature.md`), поэтому экраны ничего не регистрируют. Агент получает его
// блоком данных, а не инструкцией (SEC-10) — но вход всё равно ограничен схемой `PageContext`.
import type { PageContext } from "@kosht/contract";
import { useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";

const MAX_PARAMS = 20;
const MAX_KEY = 64;
const MAX_VALUE = 200;
const MAX_ROUTE = 200;

/** Параметр адреса, который называет открытый объект страницы: `/operations?op=<id>` — открытая операция. */
const SELECTED_PARAM: Readonly<Record<string, { param: string; entity: string }>> = {
  "/operations": { param: "op", entity: "transaction" },
};

export interface PageContextInput {
  readonly pathname: string;
  /** Разобранная строка запроса: значения-примитивы идут в params, массивы и объекты — нет. */
  readonly search: Readonly<Record<string, unknown>>;
  /** Параметры пути (`/laws/$pravoId` → `{ pravoId }`). */
  readonly pathParams?: Readonly<Record<string, unknown>>;
}

function scalar(value: unknown): string | undefined {
  if (typeof value === "string") return value === "" ? undefined : value.slice(0, MAX_VALUE);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/** Чистая сборка контекста: всё обрезано под схему `PageContext`, чужие типы значений отброшены. */
export function buildPageContext(input: PageContextInput): PageContext {
  const params: Record<string, string> = {};
  for (const source of [input.pathParams ?? {}, input.search]) {
    for (const [key, value] of Object.entries(source)) {
      const text = scalar(value);
      if (text === undefined || key.length === 0 || key.length > MAX_KEY) continue;
      if (Object.keys(params).length >= MAX_PARAMS) break;
      params[key] = text;
    }
  }
  const route = input.pathname.startsWith("/") ? input.pathname.slice(0, MAX_ROUTE) : "/";
  const selector = SELECTED_PARAM[route];
  const id = selector === undefined ? undefined : params[selector.param];
  const selected =
    selector !== undefined && id !== undefined && /^[0-9a-f-]{36}$/iu.test(id)
      ? { entity: selector.entity, id }
      : undefined;
  return selected === undefined ? { route, params } : { route, params, selected };
}

export interface PageInfo {
  readonly context: PageContext;
  /** Id страницы из `staticData.page` маршрута (`dashboard`, `operations`…) — подпись «Вижу: Главная». */
  readonly page: string | undefined;
}

/** Контекст страницы, на которой сейчас пользователь: из адреса и совпавших маршрутов роутера. */
export function usePageInfo(): PageInfo {
  const state = useRouterState({
    select: (s) => ({
      pathname: s.location.pathname,
      search: s.location.search as Record<string, unknown>,
      matches: s.matches,
    }),
  });
  const pathParams: Record<string, unknown> = {};
  let page: string | undefined;
  for (const match of state.matches) {
    Object.assign(pathParams, match.params);
    const id = (match.staticData as { page?: string } | undefined)?.page;
    if (id !== undefined) page = id;
  }
  // Один и тот же объект, пока адрес не изменился: на него смотрят эффекты и мост (иначе — бесконечный перерендер).
  // Сборка идёт из отпечатка адреса, а не из объектов роутера (они новые при каждом чтении).
  const key = JSON.stringify({ pathname: state.pathname, search: state.search, pathParams, page });
  return useMemo(() => {
    const parsed = JSON.parse(key) as {
      pathname: string;
      search: Record<string, unknown>;
      pathParams: Record<string, unknown>;
      page?: string;
    };
    return {
      context: buildPageContext({
        pathname: parsed.pathname,
        search: parsed.search,
        pathParams: parsed.pathParams,
      }),
      page: parsed.page,
    };
  }, [key]);
}
