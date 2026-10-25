import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { errorCodeOf } from "./errors.ts";

describe("код ошибки для текста человеку", () => {
  it("код каталога из ответа сервера — он сам", () => {
    expect(errorCodeOf(new ORPCError("INVALID_CREDENTIALS"))).toBe("INVALID_CREDENTIALS");
  });

  it("чужой код, сбой сети и прочее — INTERNAL", () => {
    expect(errorCodeOf(new ORPCError("TEAPOT"))).toBe("INTERNAL");
    expect(errorCodeOf(new TypeError("Failed to fetch"))).toBe("INTERNAL");
  });
});
