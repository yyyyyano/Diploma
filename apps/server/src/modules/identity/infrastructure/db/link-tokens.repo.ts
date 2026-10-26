// Одноразовые ссылки из писем (AUTH-03, AUTH-04) в identity_verifications (таблица ядра Better Auth, которую ядро
// без плагинов не трогает): identifier — «<назначение>:<sha256 токена>», value — id пользователя. Погашение —
// DELETE … RETURNING: из двух одновременных переходов по ссылке проходит один; истёкшая ссылка не гасится.
import { and, eq, gt, like, lt } from "drizzle-orm";
import type { IdentityDb } from "./identity.repo.ts";
import { identityVerifications } from "./schema.ts";

/** Назначение ссылки: подтверждение адреса или сброс пароля. */
export type LinkPurpose = "verify-email" | "reset-password";

/**
 * Новая ссылка пользователя: прежние ссылки того же назначения у него гасятся (действует последнее письмо), истёкшие
 * ссылки всех пользователей удаляются.
 */
export async function saveLinkToken(
  db: IdentityDb,
  link: {
    readonly purpose: LinkPurpose;
    readonly userId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
    readonly now: Date;
  },
): Promise<void> {
  await db.delete(identityVerifications).where(lt(identityVerifications.expiresAt, link.now));
  await db
    .delete(identityVerifications)
    .where(
      and(
        eq(identityVerifications.value, link.userId),
        like(identityVerifications.identifier, `${link.purpose}:%`),
      ),
    );
  await db.insert(identityVerifications).values({
    identifier: `${link.purpose}:${link.tokenHash}`,
    value: link.userId,
    expiresAt: link.expiresAt,
    createdAt: link.now,
    updatedAt: link.now,
  });
}

/** Погасить ссылку: действующая — id пользователя, использованная, истёкшая или чужого назначения — undefined. */
export async function consumeLinkToken(
  db: IdentityDb,
  link: { readonly purpose: LinkPurpose; readonly tokenHash: string; readonly now: Date },
): Promise<string | undefined> {
  const rows = await db
    .delete(identityVerifications)
    .where(
      and(
        eq(identityVerifications.identifier, `${link.purpose}:${link.tokenHash}`),
        gt(identityVerifications.expiresAt, link.now),
      ),
    )
    .returning({ userId: identityVerifications.value });
  return rows[0]?.userId;
}
