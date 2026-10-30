// LAW-17: таблица маршрутов — по тесту на каждую из 15 клеток (5 строк источников × 3 столбца).
import { describe, expect, it } from "vitest";
import { routeOf, type CandidateSource, type RouteTarget } from "./routes.ts";

type Column = "text-topic" | "text-no-topic" | "no-text";
const INPUT: Record<Column, { hasText: boolean; topic: "taxes" | null }> = {
  "text-topic": { hasText: true, topic: "taxes" },
  "text-no-topic": { hasText: true, topic: null },
  "no-text": { hasText: false, topic: "taxes" },
};

describe("LAW-17: таблица маршрутов", () => {
  const cells: [CandidateSource, Column, RouteTarget][] = [
    ["start-catalog", "text-topic", "index"],
    ["start-catalog", "text-no-topic", "index"],
    ["start-catalog", "no-text", "card"],
    ["link-graph", "text-topic", "index"],
    ["link-graph", "text-no-topic", "queue"],
    ["link-graph", "no-text", "card"],
    ["new-arrivals", "text-topic", "index"],
    ["new-arrivals", "text-no-topic", "queue"],
    ["new-arrivals", "no-text", "card"],
    ["agency", "text-topic", "queue"],
    ["agency", "text-no-topic", "queue"],
    ["agency", "no-text", "queue"],
    ["admin", "text-topic", "index"],
    ["admin", "text-no-topic", "index"],
    ["admin", "no-text", "card"],
  ];
  it.each(cells)("%s · %s → %s", (source, column, target) => {
    expect(routeOf({ source, ...INPUT[column], autoAdd: true }).target).toBe(target);
  });

  it("журнал спроса идёт той же строкой, что и ведомственные страницы: всегда очередь", () => {
    for (const column of Object.keys(INPUT) as Column[]) {
      expect(routeOf({ source: "demand", ...INPUT[column], autoAdd: true }).target).toBe("queue");
    }
  });

  it("граф ссылок: акт без текста и без темы по органу и заголовку отбрасывается с причиной", () => {
    expect(routeOf({ source: "link-graph", hasText: false, topic: null, autoAdd: true })).toEqual({
      target: "drop",
      reason: "no-topic",
    });
  });

  it("новые поступления без текста попадают карточкой и без темы: проверка текста — раз в неделю", () => {
    expect(
      routeOf({ source: "new-arrivals", hasText: false, topic: null, autoAdd: true }).target,
    ).toBe("card");
  });

  it.each(["text-topic", "text-no-topic", "no-text"] as const)(
    "переключатель «только предлагать» превращает «авто» новых поступлений в очередь: %s",
    (column) => {
      expect(routeOf({ source: "new-arrivals", ...INPUT[column], autoAdd: false })).toEqual({
        target: "queue",
        reason: "suggest-only",
      });
    },
  );

  it("переключатель не влияет на граф ссылок и стартовый каталог", () => {
    expect(routeOf({ source: "link-graph", ...INPUT["text-topic"], autoAdd: false }).target).toBe(
      "index",
    );
    expect(routeOf({ source: "start-catalog", ...INPUT["no-text"], autoAdd: false }).target).toBe(
      "card",
    );
  });
});
