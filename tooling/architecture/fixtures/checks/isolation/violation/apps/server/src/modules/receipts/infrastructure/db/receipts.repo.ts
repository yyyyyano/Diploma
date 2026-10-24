export async function list(s: ScopedDb) {
  return s.db.query.receipts.findMany();
}
