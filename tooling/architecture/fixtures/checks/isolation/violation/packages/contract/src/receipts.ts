import { z } from "zod";

export const GetReceiptInput = z.object({
  receiptId: ReceiptId,
  householdId: z.string(),
  "userId": z.string(),
});
