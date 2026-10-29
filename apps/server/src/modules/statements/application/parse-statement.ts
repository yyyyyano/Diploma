// Разбор выписки (STMT-04, STMT-05, SEC-03, SEC-10, ARCHITECTURE §11.2 шаги 1–2, §16.1): файл → ParsedStatement.
// Порядок: чтение в песочнице (таблица или картинки скана) → шапка таблицы и отпечаток формата → колонки:
// запомненный формат (без модели) → эвристика по словарю заголовков → модель по маленькому фрагменту (только смысл колонок)
// → операции разбирает программа → сверка цепочки остатков (calc). Скан читает модель с изображениями целиком, а
// ошибки распознавания ловит та же сверка остатков. Описания операций — данные: модель получает их блоком <document>,
// а шлюз нейтрализует приказы (SEC-10). Всё вне транзакции: модель и файлы внутри s.transaction нельзя (LLM_IN_TRANSACTION).
import { Money, type FileId } from "@kosht/kernel";
import { createHash } from "node:crypto";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { Settings } from "../../../platform/settings/settings.ts";
import type { FilesFacade } from "../../files/index.ts";
import type { LlmFacade } from "../../llm/index.ts";
import { checkBalance } from "../domain/balance.ts";
import { schemaFromHeader, schemaFromRoles, isUsable } from "../domain/detect-columns.ts";
import { extractRows, pickCurrency } from "../domain/extract-rows.ts";
import { fileTypeOfMime } from "../domain/file-type.ts";
import { columnsFragment } from "../domain/fragment.ts";
import { readPreamble, type Preamble } from "../domain/preamble.ts";
import { normalizeHeader } from "../domain/column-roles.ts";
import {
  headerSignature,
  locateHeader,
  toGrid,
  type Grid,
  type HeaderLocation,
} from "../domain/structure.ts";
import type {
  ColumnSchema,
  ParsedRow,
  ParsedStatement,
  RawImage,
  RawTable,
  ReadInput,
  Role,
} from "../domain/types.ts";
import { detectDateOrder, detectDecimal, parseAmount, parseDate } from "../domain/values.ts";
import { findFormat, findFormatsOfBank } from "../infrastructure/db/statement-formats.repo.ts";
import { STATEMENTS_COLUMNS_SAMPLE_ROWS } from "../settings.ts";
import {
  COLUMNS_INSTRUCTIONS,
  COLUMNS_PROMPT_VERSION,
  ColumnMapping,
} from "./columns-extraction.ts";
import { DocumentReadError, type DocumentReader } from "./ports.ts";
import {
  SCAN_DOCUMENT,
  SCAN_INSTRUCTIONS,
  SCAN_PROMPT_VERSION,
  ScanStatement,
} from "./scan-extraction.ts";

export interface ParseDeps {
  readonly reader: DocumentReader;
  readonly llm: Pick<LlmFacade, "extract">;
  readonly files: Pick<FilesFacade, "open">;
  readonly settings: Settings;
  readonly log: Logger;
}

/** Валюта по умолчанию, если её нет ни в шапке, ни в колонке: белорусские выписки (предупреждение currency-assumed). */
const DEFAULT_CURRENCY = "BYN";

const isDateCell = (text: string) =>
  parseDate(text, "dmy") !== undefined || parseDate(text, "mdy") !== undefined;

/** Строки шапки банка (над таблицей) и подвала (строки без даты под ней): тексты ячеек через пробел. */
function preambleLines(table: RawTable, header: HeaderLocation): string[] {
  const above = table.lines.slice(0, header.index >= 0 ? header.index : header.dataStart);
  const below = table.lines
    .slice(header.dataStart)
    .filter((line) => !line.cells.some((cell) => isDateCell(cell.text.trim())));
  return [...above, ...below].map((line) => line.cells.map((cell) => cell.text).join(" "));
}

export function makeParseStatement(d: ParseDeps) {
  /** Колонки определяет модель по маленькому фрагменту (STMT-04 шаг 2); ответ вне схемы — ошибка шлюза. */
  async function schemaByModel(
    s: ScopedDb,
    grid: Grid,
    header: HeaderLocation,
  ): Promise<ColumnSchema | undefined> {
    const rows = await d.settings.get(STATEMENTS_COLUMNS_SAMPLE_ROWS);
    const mapping = await d.llm.extract(s.scope, {
      task: "statement.columns",
      schema: ColumnMapping,
      instructions: COLUMNS_INSTRUCTIONS,
      document: columnsFragment(grid, header, rows),
      promptVersion: COLUMNS_PROMPT_VERSION,
    });
    const width = Math.max(
      header.texts.length,
      ...grid.lines.slice(header.dataStart, header.dataStart + 50).map((line) => line.cells.length),
    );
    const roles: Role[] = Array.from({ length: width }, () => "ignore");
    for (const column of mapping.columns) {
      if (column.index < width && roles[column.index] === "ignore")
        roles[column.index] = column.role;
    }
    return schemaFromRoles(grid, header.dataStart, roles);
  }

  async function parseTable(s: ScopedDb, table: RawTable): Promise<ParsedStatement> {
    const header = locateHeader(table);
    if (header === undefined) throw new AppError("STATEMENT_UNREADABLE");
    // PDF без шапки в таблице по координатам не выровнять.
    if (table.kind === "pdf" && header.index < 0) throw new AppError("STATEMENT_UNREADABLE");
    const grid = toGrid(table, header);
    const fingerprint = createHash("sha256")
      .update(headerSignature(table.kind, header, grid))
      .digest("hex");
    const preamble = readPreamble(preambleLines(table, header));
    const bankKey = preamble.bank === undefined ? undefined : normalizeHeader(preamble.bank);

    const attempt = (schema: ColumnSchema) => {
      const picked = pickCurrency(preamble.currency, grid, header.dataStart, schema);
      const currency = picked ?? DEFAULT_CURRENCY;
      return {
        schema,
        currency,
        assumed: picked === undefined,
        ...pack(extractRows(grid, header.dataStart, schema, currency)),
      };
    };
    const pack = (extracted: ReturnType<typeof extractRows>) => ({
      extracted,
      usable: isUsable(extracted),
    });

    let formatChanged = false;
    let done: (ReturnType<typeof attempt> & { method: ParsedStatement["method"] }) | undefined;

    // 1. Запомненный формат — без модели (STMT-05). Не подошёл — формат банка изменился: определяем заново.
    const remembered = await findFormat(s, fingerprint);
    if (remembered !== undefined) {
      const result = attempt(remembered.schema);
      if (result.usable) done = { ...result, method: "remembered" };
      else formatChanged = true;
    } else if (bankKey !== undefined) {
      // Отпечаток новый, а формат этого банка в этом виде файла уже запоминали: формат изменился.
      formatChanged = (await findFormatsOfBank(s, bankKey, table.kind)).length > 0;
    }
    // 2. Эвристика по словарю заголовков.
    if (done === undefined) {
      const schema = schemaFromHeader(grid, header);
      const result = schema === undefined ? undefined : attempt(schema);
      if (result?.usable === true) done = { ...result, method: "detected" };
    }
    // 3. Модель — только смысл колонок.
    if (done === undefined) {
      const schema = await schemaByModel(s, grid, header);
      const result = schema === undefined ? undefined : attempt(schema);
      if (result?.usable !== true) throw new AppError("STATEMENT_UNREADABLE");
      done = { ...result, method: "model" };
    }

    const { rows } = done.extracted;
    const warnings: string[] = [];
    if (done.assumed) warnings.push("currency-assumed");
    if (done.extracted.skipped > 0) warnings.push("rows-skipped");
    return assemble({
      preamble,
      currency: done.currency,
      rows,
      method: done.method,
      sourceKind: table.kind,
      fingerprint,
      schema: done.schema,
      formatChanged,
      warnings,
    });
  }

  /** Скан: модель с изображениями переписывает страницы; суммы и даты разбирает программа (STMT-04 шаг 4). */
  async function parseScan(s: ScopedDb, images: readonly RawImage[]): Promise<ParsedStatement> {
    const scanned = await d.llm.extract(s.scope, {
      task: "statement.scan",
      schema: ScanStatement,
      instructions: SCAN_INSTRUCTIONS,
      document: SCAN_DOCUMENT,
      images: images.map((image) => ({ data: image.bytes, mediaType: image.mime })),
      promptVersion: SCAN_PROMPT_VERSION,
    });
    const decimal =
      detectDecimal([
        ...scanned.rows.map((row) => row.amount),
        ...scanned.rows.flatMap((row) => row.balance ?? []),
      ]) ?? ",";
    const order = detectDateOrder(scanned.rows.map((row) => row.date));
    const currency = scanned.currency ?? DEFAULT_CURRENCY;
    const rows: ParsedRow[] = [];
    let skipped = 0;
    for (const row of scanned.rows) {
      const when = parseDate(row.date, order);
      const minor = parseAmount(row.amount, decimal);
      if (when === undefined || minor === undefined) {
        skipped++;
        continue;
      }
      const balance = row.balance === null ? undefined : parseAmount(row.balance, decimal);
      rows.push({
        date: when.date,
        ...(when.time === undefined ? {} : { time: when.time }),
        description: row.description.replace(/\s+/g, " ").trim(),
        amount: Money.of(minor, currency),
        ...(balance === undefined ? {} : { balance: Money.of(balance, currency) }),
      });
    }
    if (rows.length === 0) throw new AppError("STATEMENT_UNREADABLE");
    const warnings: string[] = [];
    if (scanned.currency === null) warnings.push("currency-assumed");
    if (skipped > 0) warnings.push("rows-skipped");
    const preamble: Preamble = {
      ...(scanned.bank === null ? {} : { bank: scanned.bank }),
      ...(scanned.accountMask === null ? {} : { accountMask: scanned.accountMask }),
      ...(scanned.currency === null ? {} : { currency: scanned.currency }),
      ...(scanned.openingBalance === null ||
      parseAmount(scanned.openingBalance, decimal) === undefined
        ? {}
        : { openingMinor: parseAmount(scanned.openingBalance, decimal) as number }),
      ...(scanned.closingBalance === null ||
      parseAmount(scanned.closingBalance, decimal) === undefined
        ? {}
        : { closingMinor: parseAmount(scanned.closingBalance, decimal) as number }),
    };
    return assemble({
      preamble,
      currency,
      rows,
      method: "model",
      sourceKind: "scan",
      formatChanged: false,
      warnings,
    });
  }

  /** Разобрать байты файла известного типа. */
  async function parseBytes(s: ScopedDb, input: ReadInput): Promise<ParsedStatement> {
    const started = performance.now();
    let document;
    try {
      document = await d.reader.read(input);
    } catch (error) {
      if (error instanceof DocumentReadError) {
        d.log.warn({ reason: error.reason }, "statements.unreadable");
        throw new AppError("STATEMENT_UNREADABLE");
      }
      throw error;
    }
    const parsed =
      document.kind === "table"
        ? await parseTable(s, document.table)
        : await parseScan(s, document.images);
    d.log.info(
      {
        method: parsed.method,
        count: parsed.rows.length,
        status: parsed.balance.status,
        ms: Math.round(performance.now() - started),
      },
      "statements.parsed",
    );
    return parsed;
  }

  /** Разобрать загруженный файл выписки по id (его проверил и сохранил модуль files). */
  async function parseStatement(s: ScopedDb, fileId: FileId): Promise<ParsedStatement> {
    const file = await d.files.open(s, fileId);
    const type = fileTypeOfMime(file.mime);
    if (type === undefined) throw new AppError("STATEMENT_UNREADABLE");
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    return parseBytes(s, { type, bytes });
  }

  return { parseStatement, parseBytes };
}

interface Assembly {
  readonly preamble: Preamble;
  readonly currency: string;
  readonly rows: readonly ParsedRow[];
  readonly method: ParsedStatement["method"];
  readonly sourceKind: ParsedStatement["sourceKind"];
  readonly fingerprint?: string;
  readonly schema?: ColumnSchema;
  readonly formatChanged: boolean;
  readonly warnings: readonly string[];
}

/** Собрать результат: шапка, строки и сверка цепочки остатков (STMT-04 шаг 3). */
function assemble(a: Assembly): ParsedStatement {
  const check = checkBalance(a.rows, a.currency, {
    openingMinor: a.preamble.openingMinor,
    closingMinor: a.preamble.closingMinor,
  });
  return {
    ...(a.preamble.bank === undefined ? {} : { bank: a.preamble.bank }),
    ...(a.preamble.accountMask === undefined ? {} : { accountMask: a.preamble.accountMask }),
    currency: a.currency,
    ...(a.preamble.period === undefined ? {} : { period: a.preamble.period }),
    ...(check.opening === undefined ? {} : { opening: check.opening }),
    ...(check.closing === undefined ? {} : { closing: check.closing }),
    rows: a.rows,
    method: a.method,
    ...(a.fingerprint === undefined ? {} : { fingerprint: a.fingerprint }),
    ...(a.schema === undefined ? {} : { schema: a.schema }),
    sourceKind: a.sourceKind,
    formatChanged: a.formatChanged,
    balance: {
      status: check.status,
      ...(check.difference === undefined ? {} : { difference: check.difference }),
      ...(check.trace === undefined ? {} : { trace: check.trace }),
    },
    warnings: a.warnings,
  };
}
