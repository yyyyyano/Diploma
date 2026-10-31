import { describe, expect, it } from "vitest";
import { adminStatusOf } from "./admin-status.ts";

const base = { status: "active", hasText: true, loadState: "loaded", pending: 0 };

describe("LAW-40: статус акта для администратора", () => {
  it("действующий загруженный акт — «актуален», с принятыми изменениями — «есть принятые изменения»", () => {
    expect(adminStatusOf(base)).toBe("active");
    expect(adminStatusOf({ ...base, pending: 2 })).toBe("has-changes");
  });

  it("акт без текста — «только карточка», ещё не загруженный — «ждёт загрузки»", () => {
    expect(adminStatusOf({ ...base, hasText: false, loadState: "card-only" })).toBe("card-only");
    expect(adminStatusOf({ ...base, loadState: "pending" })).toBe("pending");
  });

  it("карантин и ошибка загрузки видны, а утрата силы важнее всего остального", () => {
    expect(adminStatusOf({ ...base, loadState: "quarantined" })).toBe("quarantined");
    expect(adminStatusOf({ ...base, loadState: "failed" })).toBe("failed");
    expect(adminStatusOf({ ...base, status: "repealed", loadState: "failed", pending: 3 })).toBe(
      "repealed",
    );
  });
});
