// «Откуда эта цифра?» (EXPL-01, EXPL-02, design/screens/Main.dc.html — Main--why-panel): сохранённый расчёт числа —
// крупно итог, период, формула из подписей словаря formulas по ключам трассы (у вычитания первое слагаемое — с «+»,
// остальные — с «−»), основания со ссылками. Ничего не считает (P1): значения — из трассы сервера.
import type { Explanation } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import type { Money as MoneyValue, TraceNode, TraceRef, TraceValue } from "@kosht/kernel";
import type { TFunction } from "i18next";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Formula, Money } from "../../ui/index.ts";
import classes from "./ExplanationView.module.css";

/** Подпись ключа трассы из словаря formulas; нет подписи — запасная (тест словаря не даёт такому случиться). */
export function formulaLabel(t: TFunction<["common", "formulas"]>, key: string): string {
  return t(`formulas:${key}`, { defaultValue: t("formulas:unknown") });
}

/** Куда ведёт основание: операция — в «Операции», норма — в «Базу законов»; курс — без ссылки. */
export function refHref(ref: TraceRef): string | undefined {
  if (ref.kind === "transaction") return `/operations?open=${encodeURIComponent(ref.id)}`;
  if (ref.kind === "fragmentVersion") return `/laws?fragment=${encodeURIComponent(ref.id)}`;
  return undefined;
}

function isMoney(value: TraceValue): value is MoneyValue {
  return typeof value === "object";
}

function valueOf(value: TraceValue, kind?: "income" | "expense"): ReactNode {
  return isMoney(value) ? (
    <Money value={value} tabular {...(kind ? { kind } : {})} />
  ) : (
    String(value)
  );
}

/** Все основания дерева без повторов, в порядке обхода. */
function collectRefs(node: TraceNode, seen = new Map<string, TraceRef>()): TraceRef[] {
  for (const ref of node.refs) seen.set(`${ref.kind}:${ref.id}`, ref);
  for (const input of node.inputs) collectRefs(input, seen);
  return [...seen.values()];
}

export interface ExplanationViewProps {
  readonly explanation: Explanation;
}

export function ExplanationView({ explanation }: ExplanationViewProps) {
  const { t } = useTranslation(["common", "formulas"]);
  const root = explanation.trace;
  const title = formulaLabel(t, root.key);
  const rows = root.inputs.map((input, index) => ({
    id: `${String(index)}:${input.key}`,
    label: formulaLabel(t, input.key),
    value: valueOf(
      input.value,
      root.op === "sub" ? (index === 0 ? "income" : "expense") : undefined,
    ),
  }));
  const refs = collectRefs(root);
  return (
    <div className={classes.view}>
      <div>
        <p className={classes.subject}>{title}</p>
        <p className={classes.value}>
          {isMoney(root.value) ? <Money value={root.value} size="kpi" /> : String(root.value)}
        </p>
        {explanation.period !== null && (
          <p className={classes.period}>
            {t("common:explanation.period", {
              from: formatDate(explanation.period.from),
              to: formatDate(explanation.period.to),
            })}
          </p>
        )}
      </div>
      {rows.length > 0 && (
        <section aria-label={t("common:explanation.calc")}>
          <h3 className={classes.heading}>{t("common:explanation.calc")}</h3>
          <Formula rows={rows} total={{ id: root.key, label: title, value: valueOf(root.value) }} />
        </section>
      )}
      {refs.length > 0 && (
        <section aria-label={t("common:explanation.basis")}>
          <h3 className={classes.heading}>{t("common:explanation.basis")}</h3>
          <ul className={classes.refs}>
            {refs.map((ref) => {
              const href = refHref(ref);
              const label = t(`common:explanation.refs.${ref.kind}`);
              return (
                <li key={`${ref.kind}:${ref.id}`}>
                  {href === undefined ? label : <a href={href}>{label}</a>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <p className={classes.note}>
        <ShieldCheck size={16} strokeWidth={1.8} aria-hidden />
        {t("common:explanation.note")}
      </p>
    </div>
  );
}
