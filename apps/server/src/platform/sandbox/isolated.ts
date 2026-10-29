// Изолированный разбор недоверенного (SEC-03, T-025): PDF, XLSX/XLS, картинки пользователя читаются не в потоке
// сервера, а в отдельном worker_thread с лимитом памяти (resourceLimits) и таймаутом (terminate). Зависший разбор,
// «бомба» или нехватка памяти убивают один поток, а не api и worker. Общий помощник выписок и чеков (T-027).
// Рабочий файл — свой модуль потока (`*.worker.ts`), который вызывает serveIsolated из serve.ts. В `make dev` это .ts
// рядом с кодом (Node 26 стирает типы сам), в собранном образе — отдельная точка входа tsdown `<имя>.worker.mjs` рядом
// с бандлом процесса (apps/server/tsdown.config.ts): бандл не знает путей исходников.
import { Worker } from "node:worker_threads";

/** Рабочий файл потока: имя в сборке (`dist/<имя>.worker.mjs`) и адрес исходника для `make dev` и тестов. */
export interface IsolatedWorker {
  readonly name: string;
  readonly devUrl: URL;
}

/** Описать рабочий файл: devUrl — `new URL("./x.worker.ts", import.meta.url)` в коде, который его запускает. */
export function defineIsolatedWorker(worker: IsolatedWorker): IsolatedWorker {
  return worker;
}

export interface SandboxLimits {
  /** Срок разбора, мс: дольше — поток прерывается. */
  readonly timeoutMs: number;
  /** Предел памяти потока, МБ (куча V8): больше — поток падает, процесс жив. */
  readonly memoryMb: number;
}

export type SandboxFailure = "timeout" | "memory" | "failed" | "rejected";

/** Поток не вернул результат: `rejected` — рабочий файл сам отказал по правилу (код в `code`), остальное — сбой. */
export class SandboxError extends Error {
  override name = "SandboxError";
  readonly kind: SandboxFailure;
  readonly code: string | undefined;
  constructor(kind: SandboxFailure, code?: string) {
    super(code === undefined ? `sandbox:${kind}` : `sandbox:${kind}:${code}`);
    this.kind = kind;
    this.code = code;
  }
}

/** Ответ потока: результат или отказ по правилу; текст исключения наружу не идёт (в нём может быть кусок документа). */
export type SandboxReply<O> =
  | { readonly ok: true; readonly value: O }
  | { readonly ok: false; readonly code?: string };

/** Отказ рабочего файла по правилу (бомба, неподдерживаемый формат): код попадает вызывающему как `SandboxError.code`. */
export class SandboxRejection extends Error {
  override name = "SandboxRejection";
  readonly code: string;
  constructor(code: string) {
    super(`rejected:${code}`);
    this.code = code;
  }
}

/**
 * Адрес рабочего файла: из исходников (`.ts`) — devUrl; из бандла (`.mjs`) — `<имя>.worker.mjs` рядом с ним.
 * `selfUrl` — адрес файла, в котором работает помощник (в тестах задаётся явно).
 */
export function workerUrl(worker: IsolatedWorker, selfUrl: string = import.meta.url): URL {
  return selfUrl.endsWith(".ts") ? worker.devUrl : new URL(`./${worker.name}.worker.mjs`, selfUrl);
}

/**
 * Выполнить рабочий файл на входе `input` и вернуть его результат. Входные буферы, перечисленные в `transfer`,
 * передаются потоку без копирования. Сбой потока — `SandboxError` (timeout | memory | failed | rejected).
 */
export function runIsolated<I, O>(
  worker: IsolatedWorker,
  input: I,
  limits: SandboxLimits,
  transfer: readonly ArrayBuffer[] = [],
): Promise<O> {
  return new Promise<O>((resolve, reject) => {
    const thread = new Worker(workerUrl(worker), {
      workerData: input,
      transferList: [...transfer],
      resourceLimits: {
        maxOldGenerationSizeMb: limits.memoryMb,
        maxYoungGenerationSizeMb: Math.max(16, Math.floor(limits.memoryMb / 8)),
        stackSizeMb: 4,
      },
      // Своих потоков вывода у разбора нет: stdout потока не смешивается с логом процесса.
      stdout: false,
      stderr: false,
    });
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void thread.terminate();
      settle();
    };
    const timer = setTimeout(
      () => finish(() => reject(new SandboxError("timeout"))),
      limits.timeoutMs,
    );
    thread.once("message", (reply: SandboxReply<O>) =>
      finish(() => {
        if (reply.ok) resolve(reply.value);
        else reject(new SandboxError(reply.code === undefined ? "failed" : "rejected", reply.code));
      }),
    );
    thread.once("error", (error: NodeJS.ErrnoException) =>
      finish(() =>
        reject(new SandboxError(error.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memory" : "failed")),
      ),
    );
    thread.once("exit", () => finish(() => reject(new SandboxError("failed"))));
  });
}
