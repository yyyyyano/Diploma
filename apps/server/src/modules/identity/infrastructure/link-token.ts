// Токен ссылки из письма (AUTH-03, AUTH-04): 32 случайных байта в base64url уходят в письмо, в базе — только
// SHA-256 от них: утечка таблицы не даёт рабочих ссылок. Подбор 256 бит перебором невозможен, поэтому простого хэша
// (без соли и argon2) достаточно, а поиск по нему — один индексный запрос.
import { createHash, randomBytes } from "node:crypto";

export function newLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

export function linkTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
