// «Скачать все мои данные» (PRIV-05, ARCHITECTURE §6.6): заявка → задача worker собирает потоковый ZIP по реестру
// владельцев данных → архив сохраняется файлом домохозяйства (files, вид data-export) → событие privacy.export-ready
// (уведомление о готовности шлёт notifications) и сигнал вкладке. Скачивает архив процедура files.download — только
// владелец (строка файла ищется через s). Состав архива:
//   manifest.json                     — момент выгрузки и список таблиц;
//   data/<модуль>/<таблица>.json      — все строки домохозяйства каждой таблицы реестра (машиночитаемо), по страницам;
//   files/<модуль>/<путь>             — то, что добавил хук export владельца (исходные фото и выписки).
// Готовится не больше одного архива на домохозяйство: повторное «Подготовить» возвращает ту же заявку; новая заявка
// удаляет прежний архив (строки и файлы). Заявка, зависшая дольше срока задачи (процесс упал), считается неудачной —
// её можно повторить. Обработчик идемпотентен: заявка уже не «готовится» — повтор доставки ничего не делает.
import { DEFAULT_TIME_ZONE, FileId, LocalDate } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { ExportSink } from "../../../platform/db/user-data.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { FilesFacade } from "../../files/index.ts";
import { exportReady } from "../events.ts";
import {
  deleteExports,
  findExport,
  finishExport,
  insertExport,
  isSecondPending,
  latestExport,
  type ExportRow,
} from "../infrastructure/db/exports.repo.ts";
import { ownedRowsPage } from "../infrastructure/db/owned-rows.repo.ts";
import { createZipArchive, type ArchiveWriter } from "../infrastructure/zip-archive.ts";

/** Срок сборки (задача privacy.build-export): дольше — процесс упал, заявку можно повторить. */
export const EXPORT_BUILD_SECONDS = 15 * 60;
/** Строк таблицы за один запрос к базе при записи JSON в архив. */
const PAGE_SIZE = 500;

export type DataExportStatus = "none" | "pending" | "ready" | "failed";

export interface DataExportView {
  readonly status: DataExportStatus;
  readonly requestedAt: Date | undefined;
  readonly finishedAt: Date | undefined;
  readonly file: { readonly id: string; readonly name: string; readonly size: number } | undefined;
}

export interface DataExportDeps extends Pick<
  Platform,
  "clock" | "log" | "events" | "realtime" | "userData"
> {
  readonly files: Pick<FilesFacade, "save" | "remove">;
  /** Поставить сборку в транзакции заявки (задача модуля — позднее связывание из module.ts). */
  enqueueBuild(tx: ScopedDb, exportId: string): Promise<void>;
}

export function makeDataExport(d: DataExportDeps) {
  const stale = (row: ExportRow) =>
    d.clock.now().getTime() - row.createdAt.getTime() > EXPORT_BUILD_SECONDS * 1000;

  function view(row: ExportRow | undefined): DataExportView {
    if (row === undefined) {
      return { status: "none", requestedAt: undefined, finishedAt: undefined, file: undefined };
    }
    const ready =
      row.status === "ready" && row.fileId !== null && row.fileName !== null && row.size !== null;
    return {
      status: row.status === "pending" && stale(row) ? "failed" : row.status,
      requestedAt: row.createdAt,
      finishedAt: row.finishedAt ?? undefined,
      file: ready ? { id: row.fileId, name: row.fileName, size: row.size } : undefined,
    };
  }

  /** Последняя заявка домохозяйства s (вкладка «Мои данные»). */
  async function state(s: ScopedDb): Promise<DataExportView> {
    return view(await latestExport(s));
  }

  /** Подготовить архив: готовящийся — та же заявка; иначе прежние архивы удаляются и ставится сборка. */
  async function request(s: ScopedDb): Promise<DataExportView> {
    const latest = await latestExport(s);
    if (latest?.status === "pending" && !stale(latest)) return view(latest);
    let replaced: string[];
    try {
      replaced = await s.transaction(async (tx) => {
        const now = d.clock.now();
        const old = await deleteExports(tx, new Date(now.getTime() - EXPORT_BUILD_SECONDS * 1000));
        const id = await insertExport(tx, now);
        await d.enqueueBuild(tx, id);
        await d.realtime.changed(tx, { entity: "data-export", ids: [id] });
        return old;
      });
    } catch (error) {
      // Вторая заявка разом с первой (свежая готовящаяся не удаляется, индекс не пускает вторую): первая уже
      // поставила сборку — отдаём её.
      if (isSecondPending(error)) return view(await latestExport(s));
      throw error;
    }
    for (const fileId of replaced) await d.files.remove(s, FileId.parse(fileId));
    d.log.info({ userId: s.scope.userId }, "privacy.export-requested");
    return view(await latestExport(s));
  }

  /** Записи архива по реестру владельцев (модули — в порядке modules.ts). */
  async function fill(s: ScopedDb, archive: ArchiveWriter, at: Date): Promise<void> {
    const owners = d.userData();
    const tables = owners.flatMap((owner) =>
      owner.data.tables.map((table, i) => ({
        table,
        path: `data/${owner.module}/${owner.data.tableNames[i] ?? ""}.json`,
      })),
    );
    archive.addBuffer(
      "manifest.json",
      json({
        format: "kosht-my-data",
        version: 1,
        exportedAt: at.toISOString(),
        tables: tables.map((t) => t.path),
      }),
    );
    for (const { table, path } of tables) {
      archive.addStream(path, async function* () {
        yield text("[");
        let after: string | undefined;
        let first = true;
        for (;;) {
          const rows = await ownedRowsPage(s, table, after, PAGE_SIZE);
          for (const row of rows) {
            yield text(`${first ? "\n" : ",\n"}${JSON.stringify(row)}`);
            first = false;
          }
          const last = rows.at(-1);
          if (rows.length < PAGE_SIZE || last === undefined) break;
          after = String(last["id"]);
        }
        yield text(first ? "]\n" : "\n]\n");
      });
    }
    for (const owner of owners) {
      const sink: ExportSink = {
        file: async (path, content) => archive.addBlob(`files/${owner.module}/${path}`, content),
      };
      await owner.data.export?.(s, sink);
    }
  }

  /** Обработчик задачи privacy.build-export: собрать архив заявки, сохранить файлом, сообщить о готовности. */
  async function build(s: ScopedDb, exportId: string): Promise<void> {
    const row = await findExport(s, exportId);
    if (row?.status !== "pending") return;
    const at = d.clock.now();
    const name = `kosht-my-data-${LocalDate.fromInstant(at, DEFAULT_TIME_ZONE)}.zip`;
    const archive = createZipArchive(at);
    // Сохранение идёт параллельно с наполнением: исход ловится сразу, иначе ранний отказ записи был бы
    // необработанным отказом промиса и ронял процесс worker.
    const saving = d.files
      .save(s, { kind: "data-export", name, mime: "application/zip", content: archive.output })
      .then(
        (file) => ({ file }),
        (error: unknown) => ({ error }),
      );
    try {
      await fill(s, archive, at);
      archive.end();
    } catch (error) {
      archive.abort(error);
    }
    const result = await saving;
    if ("error" in result) {
      await finishExport(s, exportId, { status: "failed" }, d.clock.now());
      await d.realtime.changed(s, { entity: "data-export", ids: [exportId] });
      d.log.warn({ exportId }, "privacy.export-failed");
      throw result.error;
    }
    const saved = result.file;
    try {
      await s.transaction(async (tx) => {
        await finishExport(
          tx,
          exportId,
          { status: "ready", fileId: saved.id, fileName: name, size: saved.size },
          d.clock.now(),
        );
        await d.events.publish(tx, exportReady, { ids: [exportId] });
        await d.realtime.changed(tx, { entity: "data-export", ids: [exportId] });
      });
    } catch (error) {
      // Итог не записался — архив без заявки никому не нужен.
      await d.files.remove(s, saved.id);
      throw error;
    }
    d.log.info({ exportId, fileId: saved.id, size: saved.size }, "privacy.export-ready");
  }

  /** Заявка готова (для подписчика notifications: нагрузке события не верим — перечитываем). */
  async function isReady(s: ScopedDb, exportId: string): Promise<boolean> {
    return (await findExport(s, exportId))?.status === "ready";
  }

  return { state, request, build, isReady };
}

export type DataExport = ReturnType<typeof makeDataExport>;

const encoder = new TextEncoder();
const text = (value: string) => encoder.encode(value);
const json = (value: unknown) => text(`${JSON.stringify(value, null, 2)}\n`);
