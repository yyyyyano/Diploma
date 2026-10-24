import { z } from "zod";

export const GetReceiptInput = z.object({ receiptId: ReceiptId });
export const ReceiptCard = z.object({ id: ReceiptId, total: Money, note: z.string().describe("userId: не нужен") });
