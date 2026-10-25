// Хэш пароля (SEC-01, ADR-0016): argon2id из node:crypto — m = 64 МиБ, t = 3, p = 1 (≈ 125–145 мс на этой машине).
// Хранится строка PHC «$argon2id$v=19$m=…,t=…,p=…$<соль>$<хэш>» (base64 без «=»), чтобы параметры жили рядом с
// хэшем. Проверка разбирает только наши параметры: чужая или испорченная строка — «не подходит», а не исключение
// (Better Auth зовёт verify на каждый вход). Сравнение — постоянное по времени (timingSafeEqual).
import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

export const ARGON2_PARAMS = { memoryKiB: 65_536, passes: 3, parallelism: 1 } as const;

const SALT_BYTES = 16;
const TAG_BYTES = 32;
const PREFIX = `$argon2id$v=19$m=${String(ARGON2_PARAMS.memoryKiB)},t=${String(ARGON2_PARAMS.passes)},p=${String(ARGON2_PARAMS.parallelism)}$`;
const B64 = /^[A-Za-z0-9+/]+$/;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: password,
        nonce: salt,
        parallelism: ARGON2_PARAMS.parallelism,
        tagLength: TAG_BYTES,
        memory: ARGON2_PARAMS.memoryKiB,
        passes: ARGON2_PARAMS.passes,
      },
      (error, tag) => {
        if (error === null) resolve(tag);
        else reject(error);
      },
    );
  });
}

const b64 = (bytes: Buffer) => bytes.toString("base64").replace(/=+$/, "");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  return `${PREFIX}${b64(salt)}$${b64(await derive(password, salt))}`;
}

export async function verifyPassword(data: {
  readonly hash: string;
  readonly password: string;
}): Promise<boolean> {
  if (!data.hash.startsWith(PREFIX)) return false;
  const parts = data.hash.slice(PREFIX.length).split("$");
  const [salt, tag] = parts;
  if (parts.length !== 2 || salt === undefined || tag === undefined) return false;
  if (!B64.test(salt) || !B64.test(tag)) return false;
  const expected = Buffer.from(tag, "base64");
  const saltBytes = Buffer.from(salt, "base64");
  if (expected.length !== TAG_BYTES || saltBytes.length !== SALT_BYTES) return false;
  return timingSafeEqual(await derive(data.password, saltBytes), expected);
}
