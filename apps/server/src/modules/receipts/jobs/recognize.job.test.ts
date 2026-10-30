// RCPT-02, NFR-21: задача receipts.recognize — в нагрузке только id чека, scope из конверта, ключ схлопывания свой у чека
// и у домохозяйства, обработчик зовёт сценарий под s владельца.
import { testScope } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { recognizeJob } from "./recognize.job.ts";

const receiptId = "0198f3a2-7c1d-7b2a-9d3e-5a6b7c8d9e0f";

describe("задача receipts.recognize", () => {
  it("нагрузка — только uuid чека: id вне формата и без поля не проходят", () => {
    const job = recognizeJob(async () => {});
    expect(job.payload.safeParse({ receiptId }).success).toBe(true);
    expect(job.payload.safeParse({ receiptId: "не-uuid" }).success).toBe(false);
    expect(job.payload.safeParse({}).success).toBe(false);
  });

  it("ключ схлопывания зависит от чека и от домохозяйства: чужой чек и чужое домохозяйство не подавляют друг друга", () => {
    const job = recognizeJob(async () => {});
    const key = (payload: { receiptId: string }, scope: ReturnType<typeof testScope>) =>
      job.options.singletonKey?.(payload, scope);
    const mine = testScope({ user: 1, household: 1 });
    const theirs = testScope({ user: 2, household: 2 });
    const other = "0198f3a2-7c1d-7b2a-9d3e-5a6b7c8d9e10";
    expect(key({ receiptId }, mine)).toBe(key({ receiptId }, mine));
    expect(key({ receiptId }, mine)).not.toBe(key({ receiptId: other }, mine));
    expect(key({ receiptId }, mine)).not.toBe(key({ receiptId }, theirs));
  });

  it("обработчик зовёт сценарий с s владельца и id чека; очередь — с приоритетом и без повторов", async () => {
    const calls: [unknown, string][] = [];
    const job = recognizeJob(async (s, id) => {
      calls.push([s, id]);
    });
    const s = {} as ScopedDb;
    await job.handle({ s } as never, { receiptId });
    expect(calls).toEqual([[s, receiptId]]);
    expect(job.options).toMatchObject({ priority: 10, retryLimit: 0 });
    expect(job.name).toBe("receipts.recognize");
  });
});
