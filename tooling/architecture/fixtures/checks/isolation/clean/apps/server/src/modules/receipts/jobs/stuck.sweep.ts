// Сквозной запрос «для всех» возвращает (id, householdId, userId) — так и задумано (ARCHITECTURE §6.6).
export const stuckSweep = defineSweep({
  select: (db) => db.select({ id: receipts.id, householdId: receipts.householdId, userId: receipts.userId }),
  job: recognizeJob,
});
