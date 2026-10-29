// Приём файлов (SEC-03, STMT-03, RCPT-01): тип по содержимому + белый список, предел размера вида, не больше N файлов
// за раз. Все файлы проверяются до сохранения первого — один плохой файл не оставляет «хвост» из принятых. В
// хранилище уходит тип, найденный по содержимому, а не заявленный клиентом. Имя — только метаданные (safeFileName).
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { judgeFile, looksLikeText, type UploadKind } from "../domain/file-policy.ts";
import { detectType } from "../infrastructure/sniff/detect-type.ts";
import {
  FILES_MAX_PER_UPLOAD,
  FILES_MAX_PHOTO_BYTES,
  FILES_MAX_STATEMENT_BYTES,
} from "../settings.ts";
import type { Files } from "./files.ts";

/** Файл запроса: имя и заявленный тип клиента игнорируются, кроме имени как метаданных. */
export interface Upload {
  readonly name: string;
  readonly content: Uint8Array;
}

export interface AcceptedFile {
  readonly id: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
}

/** Сколько байт читать для проверки «текст ли»: сигнатуры у CSV нет, хватает начала файла. */
const TEXT_PROBE_BYTES = 64 * 1024;
const MIB = 1024 * 1024;

export function makeAcceptUpload(d: Pick<Platform, "settings"> & { readonly files: Files }) {
  /** Принять файлы вида kind и сохранить их домохозяйству s; ошибка любого файла — ни один не сохраняется. */
  return async function acceptUpload(
    s: ScopedDb,
    kind: UploadKind,
    uploads: readonly Upload[],
  ): Promise<AcceptedFile[]> {
    const maxCount = await d.settings.get(FILES_MAX_PER_UPLOAD);
    if (uploads.length > maxCount) throw new AppError("TOO_MANY_FILES", { limit: maxCount });
    const maxBytes = await d.settings.get(
      kind === "statement" ? FILES_MAX_STATEMENT_BYTES : FILES_MAX_PHOTO_BYTES,
    );
    const verdicts = [];
    for (const upload of uploads) {
      // Размер — до разбора содержимого: огромный файл не читается сигнатурой.
      if (upload.content.byteLength > maxBytes) {
        throw new AppError("FILE_TOO_LARGE", {
          name: upload.name,
          limitMb: Math.floor(maxBytes / MIB),
        });
      }
      const signature = await detectType(upload.content);
      const text = looksLikeText(upload.content.subarray(0, TEXT_PROBE_BYTES));
      const verdict = judgeFile(kind, upload.name, signature, text);
      if (!verdict.ok) throw new AppError("FILE_TYPE_NOT_ALLOWED", { name: upload.name });
      verdicts.push(verdict);
    }
    const accepted: AcceptedFile[] = [];
    for (const [index, upload] of uploads.entries()) {
      const verdict = verdicts[index];
      if (verdict === undefined || !verdict.ok) continue;
      const saved = await d.files.save(s, {
        kind: kind === "statement" ? "statement" : "receipt-photo",
        name: upload.name,
        mime: verdict.mime,
        content: upload.content,
      });
      accepted.push({ id: saved.id, name: upload.name, mime: verdict.mime, size: saved.size });
    }
    return accepted;
  };
}

export type AcceptUpload = ReturnType<typeof makeAcceptUpload>;
