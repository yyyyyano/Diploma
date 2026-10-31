// AGT-12, P6, SEC-10: тексты отказов и пометок агента — по-русски, без названий банков; словарь не входит в общие `resources`.
import { describe, expect, it } from "vitest";
import { createAgentT } from "./create-agent-t.ts";
import { NAMESPACES, resources } from "./resources.ts";

const t = createAgentT();

describe("тексты агента", () => {
  it("отказ «вне темы» подсказывает, что ассистент умеет", () => {
    expect(t("offTopic")).toContain("записать трату");
  });

  it("совет по банку — отказ без названий банков и продуктов", () => {
    expect(t("advice")).toContain("не рекомендую");
    expect(t("advice")).not.toMatch(/беларусбанк|белагропромбанк|приорбанк|альфа|мтбанк/iu);
  });

  it("итог «Да» и «Нет» без модели", () => {
    expect(t("actionDone")).toBe("Готово.");
    expect(t("actionDeclined")).toBe("Хорошо, ничего не меняю.");
  });

  it("словарь не входит в общие пространства имён сайта", () => {
    expect(NAMESPACES).not.toContain("agent");
    expect(Object.keys(resources.ru)).not.toContain("agent");
  });
});
