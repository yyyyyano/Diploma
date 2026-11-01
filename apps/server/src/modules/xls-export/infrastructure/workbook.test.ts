import { Money } from "@kosht/kernel";
import ExcelJS from "exceljs";
import { HyperFormula, type RawCellContent } from "hyperformula";
import { beforeAll, describe, expect, it } from "vitest";
import type { ExportInput, ExportRow } from "../domain/model.ts";
import { summarize } from "../domain/summary.ts";
import { buildWorkbook, renderWorkbook } from "./workbook.ts";

const byn = (minor: number) => Money.of(minor, "BYN");

function row(patch: Partial<ExportRow> & Pick<ExportRow, "date" | "type">): ExportRow {
  return {
    account: "Наличные",
    counterparty: "Евроопт",
    category: "Продукты",
    amount: byn(1000),
    amountByn: byn(1000),
    ...patch,
  };
}

const input: ExportInput = {
  from: "2026-09-01",
  to: "2026-10-31",
  limitMonth: "2026-10",
  limits: [
    { category: "Продукты", limit: byn(20000) },
    { category: "Кафе", limit: byn(5000) },
  ],
  rows: [
    row({ date: "2026-09-03", type: "expense", amount: byn(1000), amountByn: byn(1000) }),
    row({ date: "2026-09-10", type: "expense", amount: byn(847), amountByn: byn(847) }),
    row({ date: "2026-09-12", type: "refund", amount: byn(200), amountByn: byn(200) }),
    row({
      date: "2026-09-15",
      type: "income",
      category: "Зарплата",
      amount: byn(300000),
      amountByn: byn(300000),
      counterparty: "Работодатель",
    }),
    row({ date: "2026-10-02", type: "expense", amount: byn(15999), amountByn: byn(15999) }),
    row({
      date: "2026-10-04",
      type: "expense",
      category: "Кафе",
      amount: byn(1200),
      amountByn: byn(1200),
    }),
    row({
      date: "2026-10-05",
      type: "transfer",
      category: "",
      amount: byn(50000),
      amountByn: byn(50000),
    }),
    row({
      date: "2026-10-06",
      type: "expense",
      category: "Такси",
      amount: Money.of(500, "USD"),
      amountByn: null,
    }),
    row({
      date: "2026-10-07",
      type: "expense",
      category: "Подписки",
      amount: Money.of(1000, "USD"),
      amountByn: byn(3150),
    }),
    row({
      date: "2026-10-08",
      type: "expense",
      counterparty: '=HYPERLINK("http://evil.example","Нажмите")',
      category: "Прочее",
      amount: byn(100),
      amountByn: byn(100),
    }),
  ],
};

async function load(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as unknown as ArrayBuffer);
  return book;
}

/** Серийный номер дня Excel (система 1900, как у HyperFormula по умолчанию). */
const serial = (date: Date): number => Math.round(date.getTime() / 86_400_000) + 25569;

/** Книга → листы для HyperFormula: формулы строкой «=…», даты числом, как их хранит Excel. */
function toSheets(book: ExcelJS.Workbook): Record<string, RawCellContent[][]> {
  const sheets: Record<string, RawCellContent[][]> = {};
  book.eachSheet((sheet) => {
    const data: RawCellContent[][] = [];
    for (let r = 1; r <= sheet.rowCount; r += 1) {
      const cells: RawCellContent[] = [];
      for (let c = 1; c <= sheet.columnCount; c += 1) {
        const cell = sheet.getCell(r, c);
        const value = cell.value;
        if (typeof cell.formula === "string") cells.push(`=${cell.formula}`);
        else if (value instanceof Date) cells.push(serial(value));
        else if (value === null || value === undefined) cells.push(null);
        else cells.push(value as RawCellContent);
      }
      data.push(cells);
    }
    sheets[sheet.name] = data;
  });
  return sheets;
}

let bytes: Uint8Array;
let book: ExcelJS.Workbook;

beforeAll(async () => {
  bytes = await renderWorkbook(input, summarize(input));
  book = await load(bytes);
});

function engine() {
  return HyperFormula.buildFromSheets(toSheets(book), { licenseKey: "gpl-v3" });
}

/** Значение ячейки «Сводки» по названию строки и номеру месяца (0 — первый, `total` — «Итого»). */
function summaryValue(hf: HyperFormula, name: string, month: number | "total"): number {
  const sheet = hf.getSheetId("Сводка") ?? -1;
  const dims = hf.getSheetDimensions(sheet);
  for (let r = 0; r < dims.height; r += 1) {
    if (hf.getCellValue({ sheet, row: r, col: 0 }) === name) {
      const col = month === "total" ? dims.width - 1 : month + 1;
      return Number(hf.getCellValue({ sheet, row: r, col }));
    }
  }
  throw new Error(`Нет строки «${name}»`);
}

describe("XLS-02: состав файла", () => {
  it("три листа: «Операции», «Сводка», «Лимиты»", () => {
    expect(book.worksheets.map((s) => s.name)).toEqual(["Операции", "Сводка", "Лимиты"]);
  });

  it("лист «Операции» — исходные данные в порядке спецификации", () => {
    const sheet = book.getWorksheet("Операции");
    expect(sheet?.getRow(1).values).toEqual([
      undefined,
      "Дата",
      "Счёт",
      "Тип",
      "Контрагент",
      "Категория",
      "Сумма",
      "Валюта",
      "Сумма в BYN",
    ]);
    expect(sheet?.getCell("C2").value).toBe("Расход");
    expect(sheet?.getCell("F2").value).toBe(10);
    expect(sheet?.getCell("G2").value).toBe("BYN");
  });

  it("операция без курса — пустая ячейка BYN, валютная — значение по курсу", () => {
    const sheet = book.getWorksheet("Операции");
    expect(sheet?.getCell("G9").value).toBe("USD");
    expect(sheet?.getCell("H9").value).toBeNull();
    expect(sheet?.getCell("H10").value).toBe(31.5);
  });

  it("в сводке нет диаграмм и сводных таблиц", () => {
    for (const sheet of book.worksheets) expect(sheet.getImages()).toEqual([]);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("текст «=HYPERLINK(…)» в описании остаётся текстом, а не формулой", () => {
    const cell = book.getWorksheet("Операции")?.getCell("D11");
    expect(cell?.type).toBe(ExcelJS.ValueType.String);
    expect(cell?.formula).toBeUndefined();
    expect(cell?.value).toBe('=HYPERLINK("http://evil.example","Нажмите")');
  });
});

describe("XLS-04: оформление", () => {
  it("заголовки закреплены, на листе данных есть фильтр, пересчёт при открытии включён", () => {
    for (const sheet of book.worksheets) {
      expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    }
    expect(book.getWorksheet("Операции")?.autoFilter).toBe("A1:H11");
    // ExcelJS при чтении `calcPr` не отдаёт, поэтому — у книги до записи (в файл попадает `fullCalcOnLoad="1"`).
    expect(buildWorkbook(input, summarize(input)).calcProperties.fullCalcOnLoad).toBe(true);
  });

  it("суммы в формате BYN, шрифт и цвет заголовка — из токенов DES", () => {
    const operations = book.getWorksheet("Операции");
    expect(operations?.getCell("H2").numFmt).toContain("BYN");
    expect(operations?.getCell("A1").font).toMatchObject({ name: "Onest", bold: true });
    expect(operations?.getCell("A1").fill).toMatchObject({ fgColor: { argb: "FF11564D" } });
  });
});

describe("XLS-02: формулы сводки", () => {
  it("итоги считаются SUMIFS по целым столбцам листа «Операции» в кавычках", () => {
    const sheet = book.getWorksheet("Сводка");
    const formula = String(sheet?.getCell("B2").formula);
    expect(formula).toContain("SUMIFS('Операции'!$H:$H");
    expect(formula).toContain('">="&B$1');
    expect(formula).toContain('"<"&EDATE(B$1,1)');
  });

  it("у каждой формулы записан кэш-результат, равный пересчёту независимым движком", () => {
    const hf = engine();
    const mismatches: string[] = [];
    let checked = 0;
    for (const sheet of book.worksheets) {
      const id = hf.getSheetId(sheet.name) ?? -1;
      sheet.eachRow((r, rowNumber) => {
        r.eachCell((cell, colNumber) => {
          if (typeof cell.formula !== "string") return;
          const live = hf.getCellValue({ sheet: id, row: rowNumber - 1, col: colNumber - 1 });
          // ExcelJS при чтении теряет результат 0 (в файле `<v>0</v>` есть); пропавшее значение допустимо только у нуля.
          const cached =
            (cell.value as { result?: unknown }).result ?? (live === 0 ? 0 : undefined);
          const same =
            typeof cached === "number"
              ? Math.abs(Number(live) - cached) < 1e-6
              : cached === "" && (live === "" || live === null);
          if (!same)
            mismatches.push(
              `${sheet.name}!${cell.address}: ${JSON.stringify(cached)} ≠ ${JSON.stringify(live)}`,
            );
          checked += 1;
        });
      });
    }
    expect(mismatches).toEqual([]);
    expect(checked).toBeGreaterThan(20);
  });
});

describe("XLS-03 (КП): правка листа «Операции» пересчитывает сводку", () => {
  it("смена суммы операции меняет итог категории и расходы месяца", () => {
    const hf = engine();
    const before = summaryValue(hf, "Продукты", 0);
    expect(before).toBeCloseTo(10 + 8.47 - 2, 6);
    const operations = hf.getSheetId("Операции") ?? -1;
    // F3 — «Евроопт», 8,47 BYN; H3 = F3 (рублёвая операция).
    hf.setCellContents({ sheet: operations, row: 2, col: 5 }, 20);
    expect(summaryValue(hf, "Продукты", 0)).toBeCloseTo(10 + 20 - 2, 6);
    expect(summaryValue(hf, "Расходы", 0)).toBeCloseTo(10 + 20 - 2, 6);
    expect(summaryValue(hf, "Разница", 0)).toBeCloseTo(3000 - 28, 6);
  });

  it("смена категории переносит сумму в другую строку сводки", () => {
    const hf = engine();
    const operations = hf.getSheetId("Операции") ?? -1;
    hf.setCellContents({ sheet: operations, row: 1, col: 4 }, "Кафе");
    expect(summaryValue(hf, "Продукты", 0)).toBeCloseTo(8.47 - 2, 6);
    expect(summaryValue(hf, "Кафе", 0)).toBeCloseTo(10, 6);
  });

  it("новая строка внутри листа попадает в месяц по дате", () => {
    const hf = engine();
    const operations = hf.getSheetId("Операции") ?? -1;
    const last = hf.getSheetDimensions(operations).height;
    hf.setCellContents(
      { sheet: operations, row: last, col: 0 },
      serial(new Date(Date.UTC(2026, 9, 20))),
    );
    hf.setCellContents({ sheet: operations, row: last, col: 2 }, "Расход");
    hf.setCellContents({ sheet: operations, row: last, col: 4 }, "Кафе");
    hf.setCellContents({ sheet: operations, row: last, col: 7 }, 5);
    expect(summaryValue(hf, "Кафе", 1)).toBeCloseTo(12 + 5, 6);
  });

  it("переводы и операции без курса в итоги не входят", () => {
    const hf = engine();
    expect(summaryValue(hf, "Расходы", 1)).toBeCloseTo(159.99 + 12 + 31.5 + 1, 6);
  });
});

describe("XLS-02: лист «Лимиты»", () => {
  it("факт — формула по месяцу лимитов, процент — вниз до целого", () => {
    const hf = engine();
    const limits = hf.getSheetId("Лимиты") ?? -1;
    expect(hf.getCellValue({ sheet: limits, row: 1, col: 2 })).toBeCloseTo(159.99, 6);
    expect(hf.getCellValue({ sheet: limits, row: 1, col: 3 })).toBe(79);
    expect(hf.getCellValue({ sheet: limits, row: 2, col: 3 })).toBe(24);
  });
});
