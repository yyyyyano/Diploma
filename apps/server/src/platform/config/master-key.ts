// Мастер-ключ (NFR-16, ADR-0016): 32 случайных байта в файле secrets/master.key (создаёт make init, вне git и вне
// резервной копии). Из него выводятся ключи по назначению (HKDF-SHA-256): шифрование секретов, HMAC ключей лимитов
// частоты — один ключ на одно назначение, чтобы утечка одного вывода не раскрывала другой.
// Сами байты наружу не выдаются: ни в JSON, ни в util.inspect (конфигурацию могут случайно вывести в лог).
import { hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { inspect } from "node:util";

/** Длина мастер-ключа и выведенных ключей: AES-256 и HMAC-SHA-256. */
export const MASTER_KEY_BYTES = 32;

/** Назначения выведенных ключей; новое назначение — новая строка (старые не переименовываются: ключ сменится). */
export type KeyPurpose = "secrets/v1" | "rate-limit/v1";

export class MasterKey {
  readonly #bytes: Buffer;

  private constructor(bytes: Buffer) {
    this.#bytes = bytes;
  }

  /** Ключ из байтов; не 32 байта — RangeError (без самих байтов в тексте). */
  static fromBytes(bytes: Uint8Array): MasterKey {
    if (bytes.length !== MASTER_KEY_BYTES) {
      throw new RangeError(
        `ожидается ровно ${MASTER_KEY_BYTES} байта, получено ${String(bytes.length)}`,
      );
    }
    return new MasterKey(Buffer.from(bytes));
  }

  /** Ключ из файла; ошибка чтения — исключение с причиной (текст пишет загрузчик конфигурации). */
  static fromFile(file: string): MasterKey {
    return MasterKey.fromBytes(readFileSync(file));
  }

  /** Ключ для одного назначения: HKDF-SHA-256 без соли, info = «kosht/<назначение>». */
  derive(purpose: KeyPurpose): Buffer {
    return Buffer.from(
      hkdfSync("sha256", this.#bytes, Buffer.alloc(0), `kosht/${purpose}`, MASTER_KEY_BYTES),
    );
  }

  toJSON(): string {
    return "[MasterKey]";
  }

  [inspect.custom](): string {
    return "[MasterKey]";
  }
}
