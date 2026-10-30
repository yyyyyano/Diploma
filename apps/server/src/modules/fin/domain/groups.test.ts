// FIN-20, REC-04: группа обязательного платежа по разделу и категории.
import { describe, expect, it } from "vitest";
import { GROUP_ORDER, groupOf } from "./groups.ts";

describe("FIN-20: группы разбивки", () => {
  it.each([
    ["mandatory", "utilities", "utilities"],
    ["mandatory", "rent", "rent"],
    ["mandatory", "telecom", "communication"],
    ["mandatory", "loans", "loan"],
    ["mandatory", "kids", "other"],
    ["mandatory", null, "other"],
    ["subscriptions", "subscriptions", "subscriptions"],
    ["subscriptions", null, "subscriptions"],
  ])("раздел %s, категория %s → %s", (section, category, group) => {
    expect(groupOf(section, category)).toBe(group);
  });

  it("порядок слагаемых: ЖКХ, аренда, связь, кредиты, подписки, прочие", () => {
    expect(GROUP_ORDER).toEqual([
      "utilities",
      "rent",
      "communication",
      "loan",
      "subscriptions",
      "other",
    ]);
  });
});
