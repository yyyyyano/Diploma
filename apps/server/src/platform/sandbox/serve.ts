// Тело рабочего файла изолированного разбора (isolated.ts): прочитать вход потока, выполнить обработчик, ответить
// родителю один раз. Исключение обработчика наружу текстом не уходит — родитель увидит SandboxError без текста.
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { SandboxRejection, type SandboxReply } from "./isolated.ts";

export function serveIsolated<I, O>(handler: (input: I) => O | Promise<O>): void {
  if (isMainThread || parentPort === null) {
    throw new Error("Рабочий файл запускается только как worker_thread (runIsolated).");
  }
  const port = parentPort;
  void (async () => {
    let reply: SandboxReply<O>;
    try {
      reply = { ok: true, value: await handler(workerData as I) };
    } catch (error) {
      reply = error instanceof SandboxRejection ? { ok: false, code: error.code } : { ok: false };
    }
    port.postMessage(reply);
  })();
}
