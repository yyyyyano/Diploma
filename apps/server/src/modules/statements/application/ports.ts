// Внешний мир модуля statements: чтение файла выписки — недоверенный разбор в изолированном потоке (SEC-03). В тестах
// порт подменяется офлайн-реализацией; боевой адаптер — infrastructure/parsing/read-document.ts.
import type { RawDocument, ReadInput } from "../domain/types.ts";

/** Причина отказа чтения (для лога, без текста документа). */
export type ReadFailure = "timeout" | "memory" | "failed" | "zip-bomb" | "unreadable" | "too-big";

export class DocumentReadError extends Error {
  override name = "DocumentReadError";
  readonly reason: ReadFailure;
  constructor(reason: ReadFailure) {
    super(`read:${reason}`);
    this.reason = reason;
  }
}

export interface DocumentReader {
  /** Прочитать файл в таблицу или картинки; отказ — DocumentReadError. */
  read(input: ReadInput): Promise<RawDocument>;
}
