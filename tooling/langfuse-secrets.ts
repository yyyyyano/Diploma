// make init → секреты Langfuse (ADR-0010, ADR-0015, NFR-16): случайные значения создаются один раз и хранятся в
// secrets/langfuse.json; из него каждый запуск заново пишутся файлы, которые читают Compose и приложение:
//   langfuse_public_key, langfuse_secret_key  — ключи проекта для приложения (LANGFUSE_*_KEY_FILE, Compose secrets:)
//   langfuse_admin_password                   — пароль входа в интерфейс Langfuse (пользователь — LANGFUSE_ADMIN_EMAIL)
//   langfuse.env                              — web и worker Langfuse (env_file): NEXTAUTH_SECRET, SALT,
//                                               ENCRYPTION_KEY, пароли ClickHouse/Valkey/S3, LANGFUSE_INIT_*
//   langfuse-db.env, langfuse-clickhouse.env, langfuse-valkey.env — пароль каждому хранилищу отдельно
//   langfuse-s3.env                           — учётная запись S3 SeaweedFS (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY)
// Значения не печатаются; файлы и папка — 0600/0700. Существующий langfuse.json не меняется: тома Langfuse уже
// инициализированы с этими паролями.
//   node tooling/langfuse-secrets.ts <папка secrets>
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Пользователь интерфейса Langfuse (не пользователь «Кошта»); вход — 127.0.0.1:3001. */
export const LANGFUSE_ADMIN_EMAIL = "admin@kosht.local";

/** Имя учётной записи S3 (не секрет; секрет — s3Secret); то же — LANGFUSE_S3_*_ACCESS_KEY_ID в compose.yaml. */
export const S3_ACCESS_KEY = "langfuse";

export interface LangfuseSecrets {
  readonly publicKey: string;
  readonly secretKey: string;
  readonly nextAuthSecret: string;
  readonly salt: string;
  readonly encryptionKey: string;
  readonly dbPassword: string;
  readonly clickhousePassword: string;
  readonly valkeyPassword: string;
  readonly s3Secret: string;
  readonly adminPassword: string;
}

const hex = (bytes: number) => randomBytes(bytes).toString("hex");

export function generateLangfuseSecrets(): LangfuseSecrets {
  return {
    publicKey: `pk-lf-${randomUUID()}`,
    secretKey: `sk-lf-${randomUUID()}`,
    nextAuthSecret: randomBytes(32).toString("base64url"),
    salt: randomBytes(32).toString("base64url"),
    // Langfuse требует 256 бит в hex (64 символа).
    encryptionKey: hex(32),
    dbPassword: hex(24),
    clickhousePassword: hex(24),
    valkeyPassword: hex(24),
    s3Secret: hex(24),
    adminPassword: randomBytes(18).toString("base64url"),
  };
}

const env = (vars: Record<string, string>) =>
  `${Object.entries(vars)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n")}\n`;

/** Содержимое файлов, которые читают Compose и приложение. */
export function langfuseFiles(s: LangfuseSecrets): Record<string, string> {
  return {
    langfuse_public_key: `${s.publicKey}\n`,
    langfuse_secret_key: `${s.secretKey}\n`,
    langfuse_admin_password: `${s.adminPassword}\n`,
    "langfuse.env": env({
      NEXTAUTH_SECRET: s.nextAuthSecret,
      SALT: s.salt,
      ENCRYPTION_KEY: s.encryptionKey,
      DATABASE_URL: `postgresql://langfuse:${s.dbPassword}@langfuse-db:5432/langfuse`,
      CLICKHOUSE_PASSWORD: s.clickhousePassword,
      REDIS_AUTH: s.valkeyPassword,
      LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY: s.s3Secret,
      LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY: s.s3Secret,
      LANGFUSE_S3_BATCH_EXPORT_SECRET_ACCESS_KEY: s.s3Secret,
      LANGFUSE_INIT_PROJECT_PUBLIC_KEY: s.publicKey,
      LANGFUSE_INIT_PROJECT_SECRET_KEY: s.secretKey,
      LANGFUSE_INIT_USER_EMAIL: LANGFUSE_ADMIN_EMAIL,
      LANGFUSE_INIT_USER_PASSWORD: s.adminPassword,
    }),
    "langfuse-db.env": env({ POSTGRES_PASSWORD: s.dbPassword }),
    "langfuse-clickhouse.env": env({ CLICKHOUSE_PASSWORD: s.clickhousePassword }),
    "langfuse-valkey.env": env({ VALKEY_PASSWORD: s.valkeyPassword }),
    "langfuse-s3.env": env({ AWS_ACCESS_KEY_ID: S3_ACCESS_KEY, AWS_SECRET_ACCESS_KEY: s.s3Secret }),
  };
}

const SOURCE = "langfuse.json";

/** Создать (или прочитать) значения и записать файлы; результат — создан ли источник заново. */
export function ensureLangfuseSecrets(dir: string): { readonly created: boolean } {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const source = join(dir, SOURCE);
  const created = !existsSync(source);
  const secrets: LangfuseSecrets = created
    ? generateLangfuseSecrets()
    : (JSON.parse(readFileSync(source, "utf8")) as LangfuseSecrets);
  const files = { [SOURCE]: `${JSON.stringify(secrets, null, 2)}\n`, ...langfuseFiles(secrets) };
  for (const [name, text] of Object.entries(files)) {
    const file = join(dir, name);
    writeFileSync(file, text, { mode: 0o600 });
    // writeFileSync не меняет права существующего файла.
    chmodSync(file, 0o600);
  }
  return { created };
}

function main(dir: string | undefined): number {
  if (dir === undefined) {
    process.stderr.write("Укажите папку: node tooling/langfuse-secrets.ts secrets\n");
    return 2;
  }
  // Повторный запуск (каждый make up/dev) молчит: значения те же, файлы для Compose просто переписаны.
  if (ensureLangfuseSecrets(dir).created) {
    process.stdout.write(
      `Созданы секреты Langfuse в ${dir}/ (вне git); вход в Langfuse — ${LANGFUSE_ADMIN_EMAIL}, ` +
        `пароль — в ${dir}/langfuse_admin_password.\n`,
    );
  }
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv[2]);
