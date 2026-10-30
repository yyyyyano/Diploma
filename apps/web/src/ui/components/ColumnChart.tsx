// Динамика по месяцам (DASH-02, DASH-03, DES-14, design/screens/Main.dc.html .cols): парные столбцы «доходы» и «расходы».
// Свои CSS-столбцы по макету, а не Recharts (ADR-0013, замер T-033). Высота — доля от наибольшего значения (геометрия, не
// деньги: суммы и подписи приходят готовыми с сервера, P1). Столбец — кнопка с полной подписью («Расходы, май: 1 200,00
// BYN»): нажатие ведёт в операции месяца (DASH-03), клавиатура и диктор работают без отдельной таблицы.
import { cx } from "../cx.ts";
import classes from "./ColumnChart.module.css";

export interface Column {
  readonly id: string;
  /** Подпись под столбцами: «май». */
  readonly label: string;
  /** Высоты — копейки, только для пропорции. */
  readonly income: number;
  readonly expense: number;
  /** Полные подписи для диктора и подсказки: «Доходы, май: 2 400,00 BYN». */
  readonly incomeText: string;
  readonly expenseText: string;
}

export interface ColumnChartProps {
  readonly columns: readonly Column[];
  /** Название диаграммы для диктора. */
  readonly label: string;
  /** Месяц выделен (период страницы). */
  readonly selectedId?: string;
  readonly onSelect?: (id: string, kind: "income" | "expense") => void;
}

export function ColumnChart({ columns, label, selectedId, onSelect }: ColumnChartProps) {
  const max = Math.max(1, ...columns.flatMap((column) => [column.income, column.expense]));
  const height = (value: number) => `${String(Math.max(value > 0 ? 3 : 0, (value / max) * 100))}%`;
  return (
    <figure className={classes.chart} aria-label={label}>
      {columns.map((column) => (
        <div
          key={column.id}
          className={cx(classes.month, column.id === selectedId && classes.selected)}
        >
          <div className={classes.bars}>
            {(["income", "expense"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className={cx(classes.bar, classes[kind])}
                style={{ height: height(column[kind]) }}
                aria-label={kind === "income" ? column.incomeText : column.expenseText}
                title={kind === "income" ? column.incomeText : column.expenseText}
                onClick={() => onSelect?.(column.id, kind)}
              />
            ))}
          </div>
          <span className={classes.label}>{column.label}</span>
        </div>
      ))}
    </figure>
  );
}
