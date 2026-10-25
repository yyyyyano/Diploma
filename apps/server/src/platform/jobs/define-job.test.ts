import { testScope } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineJob, JobEnvelope, queuePolicy } from "./define-job.ts";
import { jobKey } from "./job-key.ts";

const payload = z.object({ receiptId: z.uuid() });

describe("ADR-0008: defineJob", () => {
  it("имя не по форме <модуль>.<глагол> — ошибка при определении", () => {
    expect(() => defineJob({ name: "Recognize Receipt", payload, handle: async () => {} })).toThrow(
      RangeError,
    );
    expect(() => defineJob({ name: "receipts", payload, handle: async () => {} })).toThrow(
      RangeError,
    );
  });

  it("задача с ключом схлопывания идёт в очередь short, без ключа — в standard", () => {
    const plain = defineJob({ name: "receipts.recognize", payload, handle: async () => {} });
    const coalesced = defineJob({
      name: "budgets.recheck",
      payload,
      options: { singletonKey: (_p, scope) => jobKey(scope, "budgets.recheck") },
      handle: async () => {},
    });
    expect(queuePolicy(plain)).toBe("standard");
    expect(queuePolicy(coalesced)).toBe("short");
  });
});

describe("SEC-04, OBS-01: конверт задачи", () => {
  it("несёт владельца, запрос-источник и нагрузку", () => {
    const scope = testScope();
    const envelope = { scope: { ...scope }, requestId: "req-12345678", payload: { a: 1 } };
    expect(JobEnvelope.parse(envelope)).toEqual(envelope);
  });

  it("владелец не uuid или лишнее поле — конверт не принимается", () => {
    const scope = testScope();
    expect(
      JobEnvelope.safeParse({
        scope: { userId: "x", householdId: scope.householdId },
        requestId: "r",
        payload: {},
      }).success,
    ).toBe(false);
    expect(
      JobEnvelope.safeParse({ scope: { ...scope }, requestId: "r", payload: {}, admin: true })
        .success,
    ).toBe(false);
  });
});
