// Книга Excel (XLS-02…04, ADR-0012): листы «Операции», «Сводка», «Лимиты». Итоги — живые формулы `SUMIFS` по целым столбцам листа
// данных: правка суммы или категории, новая строка в любом месте листа пересчитывают сводку без обращения к системе (XLS-03).
// Результат формулы кладёт `calc` (ExcelJS его не считает), `fullCalcOnLoad` просит Excel пересчитать всё при открытии.
// Условия по месяцам — по датам (`">="&начало`, `"<"&конец`), а не отдельным столбцом месяца: строка, добавленная руками, сразу
// попадает в нужный месяц. Оформление — токены DES (design/tokens.css): шрифт Onest, хвойный заголовок, формат BYN.
import { createXlsT, type XlsT } from "@kosht/i18n";
import type { Money } from "@kosht/kernel";
import ExcelJS from "exceljs";
import type { ExportInput, ExportRow } from "../domain/model.ts";
import type { Summary, SummaryLine } from "../domain/summary.ts";

// Цвета и шрифт — design/tokens.css (--brand, --ink, --line, --brand-soft, --income, --font-ui); ARGB для Excel.
const FONT = "Onest";
const INK = "FF14211F";
const BRAND = "FF11564D";
const BRAND_SOFT = "FFE3EFEA";
const LINE = "FFE1E6E3";
const INCOME = "FF146C43";
const WHITE = "FFFFFFFF";

const BYN_FORMAT = '#,##0.00" BYN";-#,##0.00" BYN"';
const AMOUNT_FORMAT = "#,##0.00";
const DATE_FORMAT = "dd.mm.yyyy";
const MONTH_FORMAT = "mmmm yyyy";
const PERCENT_FORMAT = '0"%"';

/** Имя листа в формуле — всегда в кавычках: в названии кириллица (`'Операции'!$H:$H`). */
const ref = (sheet: string, column: string): string => `'${sheet}'!$${column}:$${column}`;

/** Рубли из копеек: целое число копеек делится на 100 только при записи в ячейку. */
const major = (money: Money): number => money.minor / 100;

/** «ГГГГ-ММ-ДД» или «ГГГГ-ММ» → дата в UTC: ExcelJS пишет серийный номер дня без сдвига пояса. */
function utcDate(day: string): Date {
  return new Date(
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10) || "1")),
  );
}

const COLUMN = {
  date: "A",
  account: "B",
  type: "C",
  counterparty: "D",
  category: "E",
  amount: "F",
  byn: "H",
} as const;

function styleHeader(row: ExcelJS.Row): void {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { name: FONT, bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function styleBody(sheet: ExcelJS.Worksheet, firstRow: number): void {
  for (let index = firstRow; index <= sheet.rowCount; index += 1) {
    sheet.getRow(index).eachCell({ includeEmpty: false }, (cell) => {
      cell.font = {
        name: FONT,
        color: { argb: INK },
        ...(cell.font?.bold === true ? { bold: true } : {}),
      };
      cell.border = { bottom: { style: "thin", color: { argb: LINE } } };
    });
  }
}

function operationsSheet(book: ExcelJS.Workbook, rows: readonly ExportRow[], t: XlsT) {
  const sheet = book.addWorksheet(t("sheet.operations"));
  sheet.columns = [
    { header: t("operations.date"), width: 13 },
    { header: t("operations.account"), width: 24 },
    { header: t("operations.type"), width: 12 },
    { header: t("operations.counterparty"), width: 32 },
    { header: t("operations.category"), width: 26 },
    { header: t("operations.amount"), width: 14 },
    { header: t("operations.currency"), width: 10 },
    { header: t("operations.amountByn"), width: 18 },
  ];
  rows.forEach((row, index) => {
    const line = index + 2;
    const added = sheet.addRow([
      utcDate(row.date),
      row.account,
      t(`type.${row.type}`),
      row.counterparty,
      row.category,
      major(row.amount),
      row.amount.currency,
    ]);
    // Рублёвая операция: сумма в BYN — формула «= сумма», правка суммы сразу меняет сводку. Валютная — значение из записи
    // (курс НБРБ на день операции); курса нет — ячейка пустая и в итоги не входит.
    if (row.amountByn !== null) {
      added.getCell(8).value =
        row.amount.currency === "BYN"
          ? { formula: `F${String(line)}`, result: major(row.amountByn) }
          : major(row.amountByn);
    }
    added.getCell(1).numFmt = DATE_FORMAT;
    added.getCell(6).numFmt = AMOUNT_FORMAT;
    added.getCell(8).numFmt = BYN_FORMAT;
    // Описание — всегда текст: ячейка-строка, даже если начинается с «=» (в Excel она остаётся текстом, не формулой).
  });
  styleHeader(sheet.getRow(1));
  styleBody(sheet, 2);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: `H${String(Math.max(rows.length + 1, 2))}` };
  return sheet;
}

/** Сумма столбца «Сумма в BYN» по типу и условиям; `extra` — пары «диапазон, условие» формулы. */
function sumIfs(operations: string, type: string, extra: readonly string[]): string {
  return (
    [
      `SUMIFS(${ref(operations, COLUMN.byn)}`,
      `${ref(operations, COLUMN.type)},"${type}"`,
      ...extra,
    ].join(",") + ")"
  );
}

/** Месяц `monthCell` (первое число): `дата >= начало` и `дата < начало следующего месяца`. */
const inMonth = (operations: string, monthCell: string): string[] => [
  `${ref(operations, COLUMN.date)},">="&${monthCell}`,
  `${ref(operations, COLUMN.date)},"<"&EDATE(${monthCell},1)`,
];

/** Расходы = покупки − возвраты (FIN-01), как у сайта. */
function netExpense(operations: string, t: XlsT, extra: readonly string[]): string {
  return `${sumIfs(operations, t("type.expense"), extra)}-${sumIfs(operations, t("type.refund"), extra)}`;
}

function summarySheet(
  book: ExcelJS.Workbook,
  summary: Summary,
  operationsName: string,
  t: XlsT,
): ExcelJS.Worksheet {
  const sheet = book.addWorksheet(t("sheet.summary"));
  const monthCount = summary.months.length;
  const totalColumn = monthCount + 2;
  const letter = (column: number) => sheet.getColumn(column).letter;
  sheet.getColumn(1).width = 30;
  for (let column = 2; column <= totalColumn; column += 1) sheet.getColumn(column).width = 17;

  const header = sheet.addRow([t("summary.category")]);
  summary.months.forEach((month, index) => {
    const cell = header.getCell(index + 2);
    cell.value = utcDate(month);
    cell.numFmt = MONTH_FORMAT;
  });
  header.getCell(totalColumn).value = t("summary.total");
  styleHeader(header);

  const put = (
    row: ExcelJS.Row,
    line: SummaryLine,
    formulaOf: (monthCell: string, nameCell: string) => string,
    totalFormula: string,
  ) => {
    line.byMonth.forEach((money, index) => {
      const column = index + 2;
      row.getCell(column).value = {
        formula: formulaOf(`${letter(column)}$1`, `$A${String(row.number)}`),
        result: major(money),
      };
      row.getCell(column).numFmt = BYN_FORMAT;
    });
    row.getCell(totalColumn).value = { formula: totalFormula, result: major(line.total) };
    row.getCell(totalColumn).numFmt = BYN_FORMAT;
  };
  const rowTotal = (row: ExcelJS.Row) =>
    `SUM(B${String(row.number)}:${letter(totalColumn - 1)}${String(row.number)})`;

  for (const category of summary.categories) {
    const row = sheet.addRow([category.name]);
    put(
      row,
      category,
      (monthCell, nameCell) =>
        netExpense(operationsName, t, [
          `${ref(operationsName, COLUMN.category)},${nameCell}`,
          ...inMonth(operationsName, monthCell),
        ]),
      rowTotal(row),
    );
  }

  const expenses = sheet.addRow([t("summary.expenses")]);
  put(
    expenses,
    summary.expenses,
    (monthCell) => netExpense(operationsName, t, inMonth(operationsName, monthCell)),
    rowTotal(expenses),
  );
  const income = sheet.addRow([t("summary.income")]);
  put(
    income,
    summary.income,
    (monthCell) => sumIfs(operationsName, t("type.income"), inMonth(operationsName, monthCell)),
    rowTotal(income),
  );
  const difference = sheet.addRow([t("summary.difference")]);
  put(
    difference,
    summary.difference,
    (monthCell) => {
      const column = `${monthCell.replace(/\$\d+$/, "")}`;
      return `${column}${String(income.number)}-${column}${String(expenses.number)}`;
    },
    rowTotal(difference),
  );

  styleBody(sheet, 2);
  for (const row of [expenses, income, difference]) {
    row.eachCell((cell) => {
      cell.font = { name: FONT, bold: true, color: { argb: row === income ? INCOME : INK } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_SOFT } };
    });
  }
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  return sheet;
}

function limitsSheet(
  book: ExcelJS.Workbook,
  input: ExportInput,
  summary: Summary,
  operationsName: string,
  t: XlsT,
): ExcelJS.Worksheet {
  const sheet = book.addWorksheet(t("sheet.limits"));
  sheet.columns = [
    { header: t("limits.category"), width: 30 },
    { header: t("limits.limit"), width: 18 },
    { header: t("limits.fact"), width: 18 },
    { header: t("limits.percent"), width: 12 },
    { width: 4 },
    { header: t("limits.month"), width: 18 },
  ];
  sheet.getCell("G1").value = utcDate(input.limitMonth);
  sheet.getCell("G1").numFmt = MONTH_FORMAT;
  sheet.getColumn(7).width = 18;
  summary.limits.forEach((limit, index) => {
    const line = index + 2;
    const row = sheet.getRow(line);
    row.getCell(1).value = limit.category;
    row.getCell(2).value = major(limit.limit);
    row.getCell(2).numFmt = BYN_FORMAT;
    row.getCell(3).value = {
      formula: netExpense(operationsName, t, [
        `${ref(operationsName, COLUMN.category)},$A${String(line)}`,
        ...inMonth(operationsName, "$G$1"),
      ]),
      result: major(limit.fact),
    };
    row.getCell(3).numFmt = BYN_FORMAT;
    // BUD-02: процент — целый, вниз (159,99 из 200 — ещё 79 %); лимит не больше нуля — пусто.
    row.getCell(4).value = {
      formula: `IF(B${String(line)}>0,MAX(0,ROUNDDOWN(C${String(line)}*100/B${String(line)},0)),"")`,
      result: limit.percent ?? "",
    };
    row.getCell(4).numFmt = PERCENT_FORMAT;
  });
  styleHeader(sheet.getRow(1));
  styleBody(sheet, 2);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  return sheet;
}

/** Книга в памяти: листы, формулы с кэш-результатами и оформление. */
export function buildWorkbook(input: ExportInput, summary: Summary): ExcelJS.Workbook {
  const t = createXlsT();
  const book = new ExcelJS.Workbook();
  book.creator = "Кошт";
  book.calcProperties.fullCalcOnLoad = true;
  const operations = operationsSheet(book, input.rows, t);
  summarySheet(book, summary, operations.name, t);
  limitsSheet(book, input, summary, operations.name, t);
  return book;
}

/** Книга целиком: байты `.xlsx`. */
export async function renderWorkbook(
  input: ExportInput,
  summary: Summary,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await buildWorkbook(input, summary).xlsx.writeBuffer());
}
