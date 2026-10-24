export const recognizeJob = defineJob({
  name: "receipts.recognize",
  payload: z.object({ receiptId: ReceiptId }),
  handle: (ctx, p) => recognize(ctx.s, p.receiptId),
});
