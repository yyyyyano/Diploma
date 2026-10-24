export const getReceipt = defineTool({
  name: "get_receipt",
  kind: "read",
  input: z.object({ receiptId: ReceiptId, ownerId: z.string().optional() }),
  execute: (ctx, input) => uc.get(ctx.s, input.receiptId),
});
