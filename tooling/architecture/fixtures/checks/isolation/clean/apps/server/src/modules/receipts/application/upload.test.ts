import { makeScope } from "@kosht/kernel";

const s = makeScope({ userId: "u1", householdId: "h1" });
await db.execute(sql`truncate receipts`);
