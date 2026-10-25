// Секреты (NFR-16, ADR-0016, ADM-50/60): ключи API, пароль SMTP, токен бота. Поле в админке — только для записи:
// наружу отдаётся статус «задан / не задан / не читается», значение — только коду, которому оно нужно (reveal).
// Хранение — AES-256-GCM: ключ выведен из secrets/master.key (HKDF, назначение «secrets/v1»), свежий IV на каждую
// запись, AAD = имя секрета (шифротекст одного секрета не подставить под имя другого). Чужой мастер-ключ или порча
// строки → статус «не читается», процесс не падает. Приоритет «админка > env > умолчание (нет)».
// Значение секрета не попадает в логи, ошибки и ответы: в лог — только имя секрета и код события.
import type { Clock } from "@kosht/kernel";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EnvLookup } from "../config/config.ts";
import type { MasterKey } from "../config/master-key.ts";
import type { SystemDb } from "../db/system-db.ts";
import { AppError } from "../errors/app-error.ts";
import type { Logger } from "../logging/logger.ts";
import { deleteSealed, readSealed, writeSealed, type SealedSecret } from "./secrets.repo.ts";

const SECRET_NAME = /^[a-z]+(\.[a-z0-9-]+)+$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const IV_BYTES = 12;
/** Ключ API или токен длиннее — почти наверняка вставлено не то. */
export const MAX_SECRET_LENGTH = 4096;

export interface SecretDef {
  /** Имя: `llm.groq-key`. */
  readonly name: string;
  /** Переменная окружения разработчика (значение из админки важнее). */
  readonly env?: string;
}

/** «задан» (админка или env), «не задан», «не читается» (в базе есть, но мастер-ключ другой или строка испорчена). */
export type SecretStatus = "set" | "unset" | "unreadable";

const registry = new Map<string, SecretDef>();

export function defineSecret(def: SecretDef): SecretDef {
  if (!SECRET_NAME.test(def.name)) {
    throw new RangeError(`Имя секрета «${def.name}»: ожидается вида llm.groq-key.`);
  }
  if (def.env !== undefined && !ENV_NAME.test(def.env)) {
    throw new RangeError(`Переменная секрета ${def.name}: только A–Z, 0–9 и _.`);
  }
  if (registry.has(def.name)) throw new Error(`Секрет ${def.name} объявлен дважды.`);
  registry.set(def.name, def);
  return def;
}

/** Все секреты (экраны «Провайдеры ИИ» и «Система» в админке). */
export function registeredSecrets(): readonly SecretDef[] {
  return [...registry.values()];
}

export interface Secrets {
  status(def: SecretDef): Promise<SecretStatus>;
  /** Значение для кода, которому оно нужно (вызов провайдера, SMTP); в ответы и логи — никогда. */
  reveal(def: SecretDef): Promise<string | undefined>;
  /** Задать в админке; пустое или длиннее 4096 — VALIDATION (без значения в ошибке). */
  set(def: SecretDef, value: string): Promise<void>;
  /** Убрать значение админки: действует env, если задан. */
  clear(def: SecretDef): Promise<void>;
}

export interface SecretsDeps {
  readonly db: SystemDb;
  readonly masterKey: MasterKey;
  readonly env: EnvLookup;
  readonly clock: Pick<Clock, "now">;
  readonly log: Logger;
}

type Opened = { readonly state: "value"; readonly value: string } | { readonly state: "none" | "unreadable" };

export function createSecrets(deps: SecretsDeps): Secrets {
  const key = deps.masterKey.derive("secrets/v1");

  function seal(name: string, value: string): SealedSecret {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(name, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return { iv, tag: cipher.getAuthTag(), ciphertext };
  }

  async function open(def: SecretDef): Promise<Opened> {
    const sealed = await readSealed(deps.db, def.name);
    if (sealed === undefined) return { state: "none" };
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, sealed.iv);
      decipher.setAAD(Buffer.from(def.name, "utf8"));
      decipher.setAuthTag(sealed.tag);
      const value = Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
      return { state: "value", value: value.toString("utf8") };
    } catch (error) {
      // Чужой мастер-ключ, порча строки или подмена имени: GCM не сходится. Не падаем — статус «не читается»;
      // в лог — имя секрета и вид ошибки (сообщение node:crypto значения не содержит).
      deps.log.warn({ secret: def.name, err: error }, "secrets.unreadable");
      return { state: "unreadable" };
    }
  }

  function fromEnv(def: SecretDef): string | undefined {
    return def.env === undefined ? undefined : deps.env(def.env);
  }

  return {
    async status(def) {
      const opened = await open(def);
      if (opened.state === "value") return "set";
      if (opened.state === "unreadable") return "unreadable";
      return fromEnv(def) === undefined ? "unset" : "set";
    },
    async reveal(def) {
      const opened = await open(def);
      return opened.state === "value" ? opened.value : fromEnv(def);
    },
    async set(def, value) {
      if (value.length === 0 || value.length > MAX_SECRET_LENGTH) {
        throw new AppError("VALIDATION", { secret: def.name, maxLength: MAX_SECRET_LENGTH });
      }
      await writeSealed(deps.db, def.name, seal(def.name, value), deps.clock.now());
      deps.log.info({ secret: def.name }, "secrets.changed");
    },
    async clear(def) {
      await deleteSealed(deps.db, def.name);
      deps.log.info({ secret: def.name }, "secrets.cleared");
    },
  };
}
