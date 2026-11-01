// Запросы telegram (SystemDb): привязки, коды, связь чек → чат, имя бота. Пользовательских таблиц здесь нет.
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import { telegramBot, telegramLinkCodes, telegramLinks, telegramReceiptCards } from "./schema.ts";

export interface LinkRow {
  readonly userId: string;
  readonly householdId: string;
  readonly chatId: number;
  readonly username: string | null;
  readonly createdAt: Date;
}

const linkColumns = {
  userId: telegramLinks.userId,
  householdId: telegramLinks.householdId,
  chatId: telegramLinks.chatId,
  username: telegramLinks.username,
  createdAt: telegramLinks.createdAt,
};

export async function findLinkByChat(db: SystemDb, chatId: number): Promise<LinkRow | undefined> {
  const rows = await db
    .select(linkColumns)
    .from(telegramLinks)
    .where(eq(telegramLinks.chatId, chatId));
  return rows[0];
}

export async function findLinkByUser(db: SystemDb, userId: string): Promise<LinkRow | undefined> {
  const rows = await db
    .select(linkColumns)
    .from(telegramLinks)
    .where(eq(telegramLinks.userId, userId));
  return rows[0];
}

/** Привязать чат; false — чат или пользователь уже привязаны (один к одному, TG-02). */
export async function insertLink(db: SystemDb, link: LinkRow): Promise<boolean> {
  const rows = await db
    .insert(telegramLinks)
    .values(link)
    .onConflictDoNothing()
    .returning({ userId: telegramLinks.userId });
  return rows.length === 1;
}

/** Снять привязку пользователя; возвращает чат, к которому он был привязан. */
export async function deleteLinkByUser(db: SystemDb, userId: string): Promise<number | undefined> {
  const rows = await db
    .delete(telegramLinks)
    .where(eq(telegramLinks.userId, userId))
    .returning({ chatId: telegramLinks.chatId });
  return rows[0]?.chatId;
}

export async function deleteLinkByHousehold(db: SystemDb, householdId: string): Promise<void> {
  await db.delete(telegramLinks).where(eq(telegramLinks.householdId, householdId));
}

/** Новый код привязки; прежние коды пользователя гаснут — действует последняя ссылка. */
export async function issueCode(
  db: SystemDb,
  code: {
    readonly codeHash: string;
    readonly userId: string;
    readonly householdId: string;
    readonly expiresAt: Date;
    readonly at: Date;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(telegramLinkCodes).where(eq(telegramLinkCodes.userId, code.userId));
    await tx.insert(telegramLinkCodes).values({
      codeHash: code.codeHash,
      userId: code.userId,
      householdId: code.householdId,
      expiresAt: code.expiresAt,
      createdAt: code.at,
    });
  });
}

export type CodeClaim =
  | { readonly kind: "ok"; readonly userId: string; readonly householdId: string }
  | { readonly kind: "expired" }
  | { readonly kind: "used" }
  | { readonly kind: "unknown" };

/**
 * Погасить код: одним UPDATE (одноразовость при гонке двух «Старт»). Не прошёл — второй запрос отличает «просрочен»,
 * «уже использован» и «такого нет», чтобы бот ответил понятно (TG-02).
 */
export async function claimCode(db: SystemDb, codeHash: string, now: Date): Promise<CodeClaim> {
  const claimed = await db
    .update(telegramLinkCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(telegramLinkCodes.codeHash, codeHash),
        isNull(telegramLinkCodes.usedAt),
        gt(telegramLinkCodes.expiresAt, now),
      ),
    )
    .returning({ userId: telegramLinkCodes.userId, householdId: telegramLinkCodes.householdId });
  const row = claimed[0];
  if (row !== undefined) return { kind: "ok", ...row };
  const known = await db
    .select({ usedAt: telegramLinkCodes.usedAt })
    .from(telegramLinkCodes)
    .where(eq(telegramLinkCodes.codeHash, codeHash));
  const existing = known[0];
  if (existing === undefined) return { kind: "unknown" };
  return { kind: existing.usedAt === null ? "expired" : "used" };
}

/** Срок действующей (не использованной) ссылки пользователя — для «Ожидаю нажатия «Старт»». */
export async function pendingCode(
  db: SystemDb,
  userId: string,
  now: Date,
): Promise<Date | undefined> {
  const rows = await db
    .select({ expiresAt: telegramLinkCodes.expiresAt })
    .from(telegramLinkCodes)
    .where(
      and(
        eq(telegramLinkCodes.userId, userId),
        isNull(telegramLinkCodes.usedAt),
        gt(telegramLinkCodes.expiresAt, now),
      ),
    );
  return rows[0]?.expiresAt;
}

export async function deleteCodesOfUser(db: SystemDb, userId: string): Promise<void> {
  await db.delete(telegramLinkCodes).where(eq(telegramLinkCodes.userId, userId));
}

export async function deleteCodesOfHousehold(db: SystemDb, householdId: string): Promise<void> {
  await db.delete(telegramLinkCodes).where(eq(telegramLinkCodes.householdId, householdId));
}

/** Чистка просроченных кодов (при выдаче нового): таблица не растёт. */
export async function deleteExpiredCodes(db: SystemDb, now: Date): Promise<void> {
  await db.delete(telegramLinkCodes).where(lt(telegramLinkCodes.expiresAt, now));
}

export async function addReceiptCard(
  db: SystemDb,
  card: { receiptId: string; householdId: string; chatId: number; at: Date },
): Promise<void> {
  await db
    .insert(telegramReceiptCards)
    .values({
      receiptId: card.receiptId,
      householdId: card.householdId,
      chatId: card.chatId,
      createdAt: card.at,
    })
    .onConflictDoNothing();
}

/** Забрать карточку к отправке: чат, если чек пришёл из бота и карточка ещё не отправлена (отправляет тот, кто забрал). */
export async function claimReceiptCard(
  db: SystemDb,
  receiptId: string,
  householdId: string,
  at: Date,
): Promise<number | undefined> {
  const rows = await db
    .update(telegramReceiptCards)
    .set({ deliveredAt: at })
    .where(
      and(
        eq(telegramReceiptCards.receiptId, receiptId),
        eq(telegramReceiptCards.householdId, householdId),
        isNull(telegramReceiptCards.deliveredAt),
      ),
    )
    .returning({ chatId: telegramReceiptCards.chatId });
  return rows[0]?.chatId;
}

export async function deleteReceiptCardsOfHousehold(
  db: SystemDb,
  householdId: string,
): Promise<void> {
  await db.delete(telegramReceiptCards).where(eq(telegramReceiptCards.householdId, householdId));
}

export async function saveBotName(db: SystemDb, username: string, at: Date): Promise<void> {
  await db
    .insert(telegramBot)
    .values({ id: 1, username, updatedAt: at })
    .onConflictDoUpdate({ target: telegramBot.id, set: { username, updatedAt: at } });
}

export async function readBotName(db: SystemDb): Promise<string | undefined> {
  const rows = await db.select({ username: telegramBot.username }).from(telegramBot);
  return rows[0]?.username;
}

export async function clearBotName(db: SystemDb): Promise<void> {
  await db.delete(telegramBot).where(sql`true`);
}

/** Пользователи с привязанным Telegram (столбец «Telegram» админки, ADM-30): только флаг, без чата и имени. */
export async function linkedUserIds(db: SystemDb): Promise<Set<string>> {
  const rows = await db.select({ userId: telegramLinks.userId }).from(telegramLinks);
  return new Set(rows.map((row) => row.userId));
}
