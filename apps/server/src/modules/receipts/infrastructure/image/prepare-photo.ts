// Подготовка фото чека в изолированном потоке (SEC-03): адаптер порта PhotoPreparer — таймаут и память берёт из
// настроек, сбой потока переводит в PhotoReadError (человеку важно «сфотографируйте ещё раз», подробности — в логе).
import {
  defineIsolatedWorker,
  runIsolated,
  SandboxError,
  type SandboxLimits,
} from "../../../../platform/sandbox/isolated.ts";
import {
  PhotoReadError,
  type PhotoPreparer,
  type PrepareFailure,
  type PrepareInput,
  type PreparedPhoto,
} from "../../application/ports.ts";

export const receiptPrepareWorker = defineIsolatedWorker({
  name: "receipt-prepare",
  devUrl: new URL("./prepare.worker.ts", import.meta.url),
});

export function makePhotoPreparer(limits: () => Promise<SandboxLimits>): PhotoPreparer {
  return {
    async prepare(input: PrepareInput): Promise<PreparedPhoto> {
      // Потоку уходит копия: байты вызывающего не отсоединяются, а копия переезжает в поток без повторного копирования.
      // new Uint8Array(...) копирует в свежий буфер (у Buffer .slice() — окно в общую память, её передать нельзя).
      const bytes = new Uint8Array(input.bytes);
      try {
        return await runIsolated<PrepareInput, PreparedPhoto>(
          receiptPrepareWorker,
          { ...input, bytes },
          await limits(),
          [bytes.buffer as ArrayBuffer],
        );
      } catch (error) {
        if (!(error instanceof SandboxError)) throw error;
        const reason: PrepareFailure = error.kind === "rejected" ? "unreadable" : error.kind;
        throw new PhotoReadError(reason);
      }
    },
  };
}
