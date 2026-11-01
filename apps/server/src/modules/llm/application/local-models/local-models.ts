// Локальные модели (NFR-25, ADR-0011, ADM-50): скачивание набора из каталога с прогрессом, состояние для админки и экрана
// первого запуска, пресеты llama-server, самотест. Скачивает worker (задача llm.download-models), прогресс пишется в
// llm_local_models — api читает его оттуда (у системной задачи нет домохозяйства). Готовность файла — по диску: файл
// нужного размера на месте — готов, даже если строки в таблице нет (папка перенесена, база пересоздана).
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "../../../../platform/errors/app-error.ts";
import type { SystemPlatform } from "../../../../platform/module/define-module.ts";
import {
  listLocalModelRows,
  setLocalModelProgress,
  upsertLocalModel,
  type LocalModelRow,
} from "../../infrastructure/db/local-models.repo.ts";
import { LLM_LLAMA_BASE_URL, LLM_MODELS_DOWNLOAD } from "../../settings.ts";
import { CATALOG, type CatalogFile, type CatalogModel, type ModelKind } from "./catalog.ts";
import { downloadFile, ModelDownloadError, type DownloadDeps } from "./download-file.ts";
import { renderPresets } from "./presets.ts";
import { runSelfTest, type SelfTestProblem } from "./self-test.ts";

export type FileState = "absent" | "pending" | "downloading" | "verifying" | "ready" | "failed";

export interface FileView {
  readonly path: string;
  readonly size: number;
  readonly state: FileState;
  readonly bytesDone: number;
  readonly errorCode: string | null;
}

export interface ModelView {
  readonly id: string;
  readonly kind: ModelKind;
  readonly state: FileState;
  readonly bytesDone: number;
  readonly bytesTotal: number;
  readonly errorCode: string | null;
  readonly files: FileView[];
}

export interface SelfTestView {
  /** unknown — не запускался; down — сервис моделей не запущен; ok; failed. */
  readonly state: "unknown" | "ok" | "down" | "failed";
  readonly problem: string | null;
  /** Включён запасной режим «всё на процессоре» после «мусора» на видеоядре. */
  readonly cpuFallback: boolean;
}

export interface LocalModelsOverview {
  readonly state: "absent" | "downloading" | "ready" | "failed";
  readonly bytesDone: number;
  readonly bytesTotal: number;
  readonly models: ModelView[];
  readonly selfTest: SelfTestView;
}

/** Строка в llm_local_models с итогом самотеста (путь не файл — служебный ключ). */
export const SELF_TEST_KEY = "selftest";
/** Строка «скачивается», которую давно не обновляли, — worker умер: показываем «ожидает», а не вечную загрузку. */
const STALE_MS = 60_000;
/** Как часто пишется прогресс в таблицу, мс. */
const PROGRESS_EVERY_MS = 1000;
const CPU_FALLBACK = "CPU_FALLBACK";
const CHAT_MODEL = "qwen3.5-4b";
const EMBED_MODEL = "bge-m3";

export interface LocalModelsDeps {
  readonly platform: Pick<SystemPlatform, "system" | "clock" | "log" | "modelsDir" | "settings">;
  readonly catalog?: readonly CatalogModel[];
  readonly fetch?: typeof fetch;
  readonly freeBytes?: DownloadDeps["freeBytes"];
}

export function makeLocalModels(d: LocalModelsDeps) {
  const { system, clock, log, modelsDir } = d.platform;
  const catalog = d.catalog ?? CATALOG;
  const send = d.fetch ?? fetch;

  const diskSize = async (file: CatalogFile): Promise<number | undefined> =>
    stat(join(modelsDir, file.path)).then(
      (info) => info.size,
      () => undefined,
    );

  async function fileView(file: CatalogFile, row: LocalModelRow | undefined): Promise<FileView> {
    if ((await diskSize(file)) === file.size) {
      return {
        path: file.path,
        size: file.size,
        state: "ready",
        bytesDone: file.size,
        errorCode: null,
      };
    }
    let state: FileState =
      row === undefined ? "absent" : row.status === "ready" ? "absent" : row.status;
    if (
      row !== undefined &&
      (state === "downloading" || state === "verifying") &&
      clock.now().getTime() - row.updatedAt.getTime() > STALE_MS
    ) {
      state = "pending";
    }
    return {
      path: file.path,
      size: file.size,
      state,
      bytesDone: state === "absent" ? 0 : Math.min(row?.bytesDone ?? 0, file.size),
      errorCode: state === "failed" ? (row?.errorCode ?? "UNKNOWN") : null,
    };
  }

  const aggregate = (states: readonly FileState[]): FileState => {
    if (states.every((state) => state === "ready")) return "ready";
    if (states.includes("failed")) return "failed";
    if (states.some((state) => state === "downloading" || state === "verifying"))
      return "downloading";
    if (states.includes("pending")) return "pending";
    return "absent";
  };

  async function anotherDownloader(): Promise<boolean> {
    const now = clock.now().getTime();
    return (await listLocalModelRows(system)).some(
      (row) => row.status === "downloading" && now - row.updatedAt.getTime() <= STALE_MS,
    );
  }

  /** Состояние всех моделей каталога и самотеста — для админки и экрана первого запуска. */
  async function view(): Promise<LocalModelsOverview> {
    const rows = new Map((await listLocalModelRows(system)).map((row) => [row.file, row]));
    const models: ModelView[] = [];
    for (const model of catalog) {
      const files = await Promise.all(
        model.files.map((file) => fileView(file, rows.get(file.path))),
      );
      models.push({
        id: model.id,
        kind: model.kind,
        state: aggregate(files.map((file) => file.state)),
        bytesDone: files.reduce((sum, file) => sum + file.bytesDone, 0),
        bytesTotal: files.reduce((sum, file) => sum + file.size, 0),
        errorCode: files.find((file) => file.errorCode !== null)?.errorCode ?? null,
        files,
      });
    }
    const states = models.map((model) => model.state);
    const state = states.every((s) => s === "ready")
      ? "ready"
      : states.includes("failed")
        ? "failed"
        : states.some((s) => s === "downloading" || s === "verifying")
          ? "downloading"
          : states.includes("pending")
            ? "pending"
            : "absent";
    const test = rows.get(SELF_TEST_KEY);
    return {
      state,
      bytesDone: models.reduce((sum, model) => sum + model.bytesDone, 0),
      bytesTotal: models.reduce((sum, model) => sum + model.bytesTotal, 0),
      models,
      selfTest: {
        state:
          test === undefined
            ? "unknown"
            : test.status === "ready"
              ? "ok"
              : test.errorCode === "LLAMA_DOWN"
                ? "down"
                : "failed",
        problem: test?.status === "ready" ? null : (test?.errorCode ?? null),
        cpuFallback: test?.status === "ready" && test.errorCode === CPU_FALLBACK,
      },
    };
  }

  async function writePresets(cpuOnly: boolean): Promise<void> {
    await mkdir(modelsDir, { recursive: true });
    await writeFile(join(modelsDir, "presets.ini"), renderPresets({ cpuOnly }));
  }

  /** Роутер llama-server перечитывает папку и пресеты: модели, скачанные после его старта, становятся видны. */
  async function reloadRouter(): Promise<void> {
    const base = (await d.platform.settings.get(LLM_LLAMA_BASE_URL)).replace(/\/v1\/?$/, "");
    try {
      await send(`${base}/models?reload=1`, { signal: AbortSignal.timeout(10_000) });
    } catch {
      // Сервис моделей не запущен (профиль models выключен) — перечитает при старте.
      log.info({ reason: "llama-not-running" }, "llm.router-reload-skipped");
    }
  }

  async function unload(): Promise<void> {
    const base = (await d.platform.settings.get(LLM_LLAMA_BASE_URL)).replace(/\/v1\/?$/, "");
    for (const model of [CHAT_MODEL, EMBED_MODEL]) {
      await send(`${base}/models/unload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    }
  }

  async function recordSelfTest(ok: boolean, code: string | null): Promise<void> {
    await upsertLocalModel(system, {
      file: SELF_TEST_KEY,
      model: SELF_TEST_KEY,
      status: ok ? "ready" : "failed",
      bytesDone: 0,
      bytesTotal: 0,
      errorCode: code,
      at: clock.now(),
    });
  }

  /** Самотест; «мусор» — запасной режим на процессоре и повтор. Итог записывается для админки. */
  async function selfTest(): Promise<SelfTestView> {
    const baseUrl = await d.platform.settings.get(LLM_LLAMA_BASE_URL);
    const run = () =>
      runSelfTest({
        baseUrl,
        chatModel: CHAT_MODEL,
        embedModel: EMBED_MODEL,
        ...(d.fetch === undefined ? {} : { fetch: d.fetch }),
      });
    let result = await run();
    let fallback = false;
    if (!result.ok && !result.problems.includes("LLAMA_DOWN")) {
      log.warn({ reason: result.problems.join("+") }, "llm.self-test-garbage");
      await writePresets(true);
      await unload();
      await reloadRouter();
      fallback = true;
      result = await run();
    }
    const problem: SelfTestProblem | undefined = result.problems[0];
    await recordSelfTest(
      result.ok,
      result.ok ? (fallback ? CPU_FALLBACK : null) : (problem ?? null),
    );
    log.info({ status: result.ok ? "ok" : (problem ?? "failed") }, "llm.self-test");
    return (await view()).selfTest;
  }

  /**
   * Скачать всё, чего нет: файлы по порядку с докачкой; прогресс — в таблицу (раз в секунду) и в журнал задачи.
   * Ошибка сети или 5xx — retryable (задача повторится и продолжит с места обрыва), прочее — нет.
   */
  async function download(ctx: {
    readonly signal: AbortSignal;
    progress(percent: number): Promise<void>;
    /** Событие «модели готовы» (llm.local-models-ready): публикует задача в своей транзакции. */
    ready?(rowIds: readonly string[]): Promise<void>;
  }): Promise<void> {
    // Скачивает один: свежие строки «скачивается» — значит, другая задача уже работает (две кнопки, два администратора).
    if (await anotherDownloader()) return;
    if (!(await d.platform.settings.get(LLM_MODELS_DOWNLOAD))) {
      log.info({ reason: "disabled" }, "llm.model-download-disabled");
      return;
    }
    const files = catalog.flatMap((model) => model.files.map((file) => ({ model, file })));
    const total = files.reduce((sum, { file }) => sum + file.size, 0);
    let finished = 0;
    for (const { model, file } of files) {
      const dest = join(modelsDir, file.path);
      const base = { file: file.path, model: model.id, bytesTotal: file.size };
      let lastWrite = Number.NEGATIVE_INFINITY;
      if ((await diskSize(file)) === file.size) {
        await upsertLocalModel(system, {
          ...base,
          status: "ready",
          bytesDone: file.size,
          errorCode: null,
          at: clock.now(),
        });
        finished += file.size;
        continue;
      }
      await upsertLocalModel(system, {
        ...base,
        status: "downloading",
        bytesDone: 0,
        errorCode: null,
        at: clock.now(),
      });
      try {
        await downloadFile(
          { url: file.url, dest, sha256: file.sha256, size: file.size },
          {
            signal: ctx.signal,
            ...(d.fetch === undefined ? {} : { fetch: d.fetch }),
            ...(d.freeBytes === undefined ? {} : { freeBytes: d.freeBytes }),
            onProgress: (done) => {
              const now = clock.now().getTime();
              if (now - lastWrite < PROGRESS_EVERY_MS && done < file.size) return;
              lastWrite = now;
              void setLocalModelProgress(system, file.path, done, clock.now()).catch(
                () => undefined,
              );
              void ctx
                .progress(Math.floor(((finished + done) * 100) / total))
                .catch(() => undefined);
            },
          },
        );
      } catch (error) {
        const code = error instanceof ModelDownloadError ? error.code : "UNKNOWN";
        if (ctx.signal.aborted) {
          // Прервали (перезапуск worker, остановка): строка «скачивается» со свежим updated_at отсекла бы повтор
          // задачи как «чужую» загрузку на минуту (anotherDownloader) — возвращаем «ожидает», `.part` остаётся для
          // докачки по Range. Сбой записи не должен заслонить причину прерывания.
          const part = await stat(`${dest}.part`).then(
            (info) => info.size,
            () => 0,
          );
          await upsertLocalModel(system, {
            ...base,
            status: "pending",
            bytesDone: Math.min(part, file.size),
            errorCode: null,
            at: clock.now(),
          }).catch(() => undefined);
          throw error;
        }
        await upsertLocalModel(system, {
          ...base,
          status: "failed",
          bytesDone: 0,
          errorCode: code,
          at: clock.now(),
        });
        log.warn({ code, reason: model.id }, "llm.model-download-failed");
        throw new AppError(
          error instanceof ModelDownloadError && error.retryable ? "UNAVAILABLE" : "INTERNAL",
        );
      }
      finished += file.size;
      await upsertLocalModel(system, {
        ...base,
        status: "ready",
        bytesDone: file.size,
        errorCode: null,
        at: clock.now(),
      });
    }
    await ctx.progress(100);
    await writePresets(false);
    await reloadRouter();
    const rows = await listLocalModelRows(system);
    const readyIds = rows
      .filter((row) => row.status === "ready" && row.file !== SELF_TEST_KEY)
      .map((row) => row.id);
    if (readyIds.length > 0) await ctx.ready?.(readyIds);
    await selfTest();
  }

  return { view, download, selfTest, writePresets, reloadRouter };
}

export type LocalModels = ReturnType<typeof makeLocalModels>;
