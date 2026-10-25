// Бренды id (ARCHITECTURE §5.3): id пользователя, домохозяйства и трассы — разные типы, хотя все они uuid.
import { describe, expect, it } from "vitest";
import { FileId, HouseholdId, TraceId, UserId } from "./ids.ts";

describe("бренды id", () => {
  it.each([
    ["UserId", UserId],
    ["HouseholdId", HouseholdId],
    ["TraceId", TraceId],
    ["FileId", FileId],
  ])("%s разбирает uuid и не пропускает не-uuid", (_name, schema) => {
    expect(schema.parse("0190f0a0-0000-7000-8000-00000000000a")).toBe(
      "0190f0a0-0000-7000-8000-00000000000a",
    );
    expect(schema.safeParse("42").success).toBe(false);
  });

  it("FileId не пропускает путь: «../» и вложенные папки — не uuid", () => {
    expect(FileId.safeParse("../0190f0a0-0000-7000-8000-00000000000a").success).toBe(false);
    expect(FileId.safeParse("0190f0a0-0000-7000-8000-00000000000a/x").success).toBe(false);
  });

  it("TraceId не подставить вместо UserId", () => {
    const traceId = TraceId.parse("0190f0a0-0000-7000-8000-00000000000b");
    // @ts-expect-error — бренды id различаются: id трассы не может стать id пользователя
    const userId: UserId = traceId;
    expect(userId).toBe(traceId);
  });
});
