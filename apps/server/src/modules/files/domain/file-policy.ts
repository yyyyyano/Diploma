// Белый список типов загрузки (SEC-03): что человек назвал и что пришло. Тип определяется по содержимому (сигнатура,
// infrastructure/sniff), расширение имени — только проверка «не подменено»: `evil.exe`, переименованный в `.pdf`, и
// PDF под именем `.csv` отклоняются. Чистые правила, без файлов и сети.

/** Что загружают; вид задаёт белый список и предел размера. */
export type UploadKind = "receipt-photo" | "statement";

/** Тип по содержимому: ключ белого списка (`pdf`, `xlsx`, `xls`, `csv`, `jpg`, …). */
export type DetectedType = "pdf" | "xlsx" | "xls" | "csv" | "jpg" | "png" | "webp" | "heic";

interface TypeInfo {
  readonly mime: string;
  /** Расширения имени, с которыми этот тип считается неподменённым (пустое имя расширения — тоже можно). */
  readonly extensions: readonly string[];
}

const TYPES: Readonly<Record<DetectedType, TypeInfo>> = {
  pdf: { mime: "application/pdf", extensions: ["pdf"] },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensions: ["xlsx"],
  },
  xls: { mime: "application/vnd.ms-excel", extensions: ["xls"] },
  csv: { mime: "text/csv", extensions: ["csv", "txt"] },
  jpg: { mime: "image/jpeg", extensions: ["jpg", "jpeg", "jfif"] },
  png: { mime: "image/png", extensions: ["png"] },
  webp: { mime: "image/webp", extensions: ["webp"] },
  heic: { mime: "image/heic", extensions: ["heic", "heif"] },
};

const PHOTO_TYPES: readonly DetectedType[] = ["jpg", "png", "webp", "heic"];
/** Выписка: PDF, Excel, CSV и скан — фото страницы (STMT-03, STMT-04 шаг 4). */
const ALLOWED: Readonly<Record<UploadKind, readonly DetectedType[]>> = {
  "receipt-photo": PHOTO_TYPES,
  statement: ["pdf", "xlsx", "xls", "csv", ...PHOTO_TYPES],
};

export type FileVerdict =
  | { readonly ok: true; readonly type: DetectedType; readonly mime: string }
  | { readonly ok: false; readonly reason: "type" | "extension" };

/** Расширение имени в нижнем регистре без точки; «» — расширения нет. */
export function extensionOf(name: string): string {
  const base = name.split(/[/\\]/).at(-1) ?? "";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/**
 * Текст ли это (CSV): без нулевых байтов и управляющих знаков, кроме табуляции и перевода строки. Проверяется начало
 * файла: сигнатуры у CSV нет, поэтому «не бинарный и без известной сигнатуры» — единственный признак.
 */
export function looksLikeText(head: Uint8Array): boolean {
  if (head.byteLength === 0) return false;
  for (const byte of head) {
    if (byte === 0) return false;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return false;
  }
  return true;
}

/**
 * Решение по файлу: `signature` — тип по сигнатуре (undefined — сигнатуры нет), `text` — выглядит ли как текст.
 * Нет сигнатуры и не текст — не из белого списка; тип не из списка вида — то же; расширение не от этого типа — подмена.
 */
export function judgeFile(
  kind: UploadKind,
  name: string,
  signature: DetectedType | undefined,
  text: boolean,
): FileVerdict {
  const type = signature ?? (text ? "csv" : undefined);
  if (type === undefined || !ALLOWED[kind].includes(type)) return { ok: false, reason: "type" };
  const extension = extensionOf(name);
  const info = TYPES[type];
  if (extension !== "" && !info.extensions.includes(extension)) {
    return { ok: false, reason: "extension" };
  }
  return { ok: true, type, mime: info.mime };
}
