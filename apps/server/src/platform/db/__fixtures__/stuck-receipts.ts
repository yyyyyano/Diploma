// Сквозной запрос обхода для тестов defineSweep (platform/jobs): владельцы чеков fx_receipts в статусе «stuck» —
// только id, household_id, user_id (crossTenant остановит любой другой список колонок). Здесь, а не в тесте jobs:
// drizzle-orm доступен только platform/db.
import { eq } from "drizzle-orm";
import type { QueryDb } from "../audited.ts";
import { fxReceipts } from "./schema.ts";

export function findStuckReceipts(q: QueryDb) {
  return q
    .select({ id: fxReceipts.id, householdId: fxReceipts.householdId, userId: fxReceipts.userId })
    .from(fxReceipts)
    .where(eq(fxReceipts.status, "stuck"));
}
