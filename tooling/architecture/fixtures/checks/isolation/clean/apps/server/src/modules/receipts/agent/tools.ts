export const getReceipt = defineTool({
  name: "get_receipt",
  kind: "read",
  description: "Get a receipt by id. Never pass userId: owner comes from the session.",
  input: z.object({ receiptId: ReceiptId }),
  execute: (ctx, input) => uc.get(ctx.s, input.receiptId),
});

export const receiptStatus = defineTool({
  name: "receipt_status",
  kind: "read",
  input: z.object({ receiptId: ReceiptId }),
  async execute(ctx, input) {
    return uc.status(ctx.s, input.receiptId);
  },
});
