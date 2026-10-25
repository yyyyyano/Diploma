import { describe, expect, it } from "vitest";
import { cassetteFile, cassetteMode } from "./cassettes.ts";

describe("QA-17: кассеты в тестах", () => {
  it("файл — рядом с тестом в __cassettes__, имя — вторая часть сценария", () => {
    expect(
      cassetteFile(
        "file:///repo/apps/server/src/modules/chat/application/send.int.test.ts",
        "chat/accounts",
      ),
    ).toBe("/repo/apps/server/src/modules/chat/application/__cassettes__/accounts.json");
  });

  it("сценарий не <модуль>/<имя> — ошибка", () => {
    expect(() => cassetteFile("/x/a.test.ts", "../secrets")).toThrow(RangeError);
  });

  it("обычный прогон — replay; make ai-record SCENARIO=… — record только своего сценария", () => {
    expect(cassetteMode("chat/accounts", {})).toBe("replay");
    expect(cassetteMode("chat/accounts", { AI_RECORD: "chat/accounts" })).toBe("record");
    expect(cassetteMode("chat/other", { AI_RECORD: "chat/accounts" })).toBe("replay");
    expect(cassetteMode("chat/other", { AI_RECORD: "*" })).toBe("record");
  });
});
