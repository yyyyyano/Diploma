// Таблица маршрутов LAW-17: куда попадает акт в зависимости от источника, наличия текста и определённости темы.
// «индекс» — каталог и индекс, «карточка» — запись каталога без текста, «очередь» — кандидат на решение администратора.
import type { Topic } from "./topics.ts";

export type CandidateSource =
  | "start-catalog"
  | "link-graph"
  | "new-arrivals"
  | "agency"
  | "demand"
  | "admin";

export type RouteTarget = "index" | "card" | "queue" | "drop";

export interface RouteInput {
  readonly source: CandidateSource;
  readonly hasText: boolean;
  /**
   * Тема определена: у акта с текстом — по рубрикам ЕПК (LAW-14), у акта без текста — по органу, заголовку или модели.
   * Предложение модели для акта с текстом — не «определена»: такой акт уходит в очередь.
   */
  readonly topic: Topic | null;
  /** Переключатель «добавлять автоматически / только предлагать» (LAW-12): действует на новые поступления. */
  readonly autoAdd: boolean;
}

export interface Route {
  readonly target: RouteTarget;
  /** Код причины для журнала: почему не «индекс/карточка, авто». */
  readonly reason: "no-topic" | "manual-decision" | "suggest-only" | null;
}

const route = (target: RouteTarget, reason: Route["reason"] = null): Route => ({ target, reason });

export function routeOf(i: RouteInput): Route {
  const known = i.topic !== null;
  switch (i.source) {
    case "start-catalog":
    case "admin":
      // Стартовый список и ручное добавление: тема из каталога или от администратора, решение уже принято.
      return route(i.hasText ? "index" : "card");
    case "link-graph":
      if (i.hasText) return known ? route("index") : route("queue", "no-topic");
      return known ? route("card") : route("drop", "no-topic");
    case "new-arrivals":
      if (!i.autoAdd) return route("queue", "suggest-only");
      if (i.hasText) return known ? route("index") : route("queue", "no-topic");
      return route("card");
    case "agency":
    case "demand":
      return route("queue", "manual-decision");
  }
}
