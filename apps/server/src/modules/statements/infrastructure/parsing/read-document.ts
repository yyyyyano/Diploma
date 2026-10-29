// Чтение файла выписки в изолированном потоке (SEC-03): адаптер порта DocumentReader — таймаут и память берёт из
// настроек, сбой потока переводит в код каталога (тот же для таймаута, нехватки памяти, «бомбы» и битого файла:
// человеку важно «выгрузите заново», а подробности остаются в логе).
import {
  defineIsolatedWorker,
  runIsolated,
  SandboxError,
  type SandboxLimits,
} from "../../../../platform/sandbox/isolated.ts";
import type { RawDocument } from "../../domain/types.ts";
import type { ReadInput } from "./parse.worker.ts";

export const statementWorker = defineIsolatedWorker({
  name: "statement-parse",
  devUrl: new URL("./parse.worker.ts", import.meta.url),
});

/** Причина отказа чтения для лога: без текста документа. */
export type ReadFailure = "timeout" | "memory" | "failed" | "zip-bomb" | "unreadable" | "too-big";

export class DocumentReadError extends Error {
  override name = "DocumentReadError";
  readonly reason: ReadFailure;
  constructor(reason: ReadFailure) {
    super(`read:${reason}`);
    this.reason = reason;
  }
}

export async function readDocument(input: ReadInput, limits: SandboxLimits): Promise<RawDocument> {
  // Буфер уходит потоку без копирования, если байты занимают его целиком (чужой общий буфер отсоединять нельзя).
  const own =
    input.bytes.byteLength === input.bytes.buffer.byteLength && input.bytes.byteOffset === 0;
  const bytes = own ? input.bytes : input.bytes.slice();
  try {
    return await runIsolated<ReadInput, RawDocument>(
      statementWorker,
      { type: input.type, bytes },
      limits,
      [bytes.buffer as ArrayBuffer],
    );
  } catch (error) {
    if (!(error instanceof SandboxError)) throw error;
    const reason: ReadFailure =
      error.kind === "rejected"
        ? error.code === "zip-bomb" || error.code === "too-big"
          ? error.code
          : "unreadable"
        : error.kind;
    throw new DocumentReadError(reason);
  }
}
