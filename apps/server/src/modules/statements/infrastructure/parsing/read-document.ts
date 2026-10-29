// Чтение файла выписки в изолированном потоке (SEC-03): адаптер порта DocumentReader — таймаут и память берёт из
// настроек, сбой потока переводит в код каталога (тот же для таймаута, нехватки памяти, «бомбы» и битого файла:
// человеку важно «выгрузите заново», а подробности остаются в логе).
import {
  defineIsolatedWorker,
  runIsolated,
  SandboxError,
  type SandboxLimits,
} from "../../../../platform/sandbox/isolated.ts";
import { DocumentReadError, type ReadFailure } from "../../application/ports.ts";
import type { RawDocument, ReadInput } from "../../domain/types.ts";

export const statementWorker = defineIsolatedWorker({
  name: "statement-parse",
  devUrl: new URL("./parse.worker.ts", import.meta.url),
});

export async function readDocument(input: ReadInput, limits: SandboxLimits): Promise<RawDocument> {
  // Потоку уходит копия: буфер вызывающего не отсоединяется (его байты нужны ему и после чтения), а копия переезжает
  // в поток без повторного копирования.
  const bytes = input.bytes.slice();
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
