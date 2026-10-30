// Цель в карточке (BUD-04, BUD-05, BUD-07, EXPL-01; design/screens/Budget.dc.html .goal, Main.dc.html .goal): название,
// срок, накоплено из суммы, процент, «Откладывайте по X в месяц» и «укладывается ли в свободный остаток». Все числа —
// с сервера (P1), ⓘ открывает сохранённый расчёт. full — экран «Лимиты и цели» (взносы копилки, подсказки), compact —
// главная (название, полоса, процент, кнопка «Внести»).
import type { BudgetGoal } from "@kosht/contract";
import { formatDate, formatMoney } from "@kosht/i18n";
import type { TraceId } from "@kosht/kernel";
import { Button } from "@mantine/core";
import { AlertTriangle, CircleCheck, PiggyBank, Plus, RefreshCw, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Money, StatusBadge, WhyButton } from "../../ui/index.ts";
import classes from "./GoalCard.module.css";

export interface GoalCardProps {
  readonly goal: BudgetGoal;
  readonly variant?: "full" | "compact";
  /** Свободный остаток в месяц — для строки «укладывается в …»; нет — «недостаточно данных». */
  readonly freeBalance?: BudgetGoal["target"] | null;
  readonly onWhy: (traceId: TraceId) => void;
  readonly onContribute?: (goal: BudgetGoal) => void;
  /** Меню действий (изменить, удалить) — слот страницы. */
  readonly actions?: ReactNode;
}

export function GoalCard({
  goal,
  variant = "full",
  freeBalance = null,
  onWhy,
  onContribute,
  actions,
}: GoalCardProps) {
  const { t } = useTranslation("budget");
  const full = variant === "full";
  const piggy = goal.kind === "piggy";
  const noProgress = goal.saved === null;
  const done = goal.contribution !== null && goal.contribution.minor === 0;
  return (
    <article className={classes.goal} aria-label={goal.name}>
      <header className={classes.head}>
        <span className={classes.icon} aria-hidden>
          {piggy ? (
            <PiggyBank size={20} strokeWidth={1.8} />
          ) : (
            <Wallet size={20} strokeWidth={1.8} />
          )}
        </span>
        <div className={classes.title}>
          <h3 className={classes.name}>{goal.name}</h3>
          <p className={classes.sub}>
            {t("goals.deadline", { date: formatDate(goal.deadline) })} ·{" "}
            {t("goals.monthsLeft", { count: goal.monthsLeft })}
          </p>
        </div>
        {full && (
          <StatusBadge tone="neutral" icon={piggy ? PiggyBank : Wallet}>
            {piggy ? t("goals.kindPiggy") : t("goals.kindAccount")}
          </StatusBadge>
        )}
        {actions}
      </header>

      <div className={classes.amounts}>
        {goal.saved === null ? (
          <span className={classes.unknown}>
            {goal.accountMissing ? t("goals.accountMissing") : t("goals.noRate")}
          </span>
        ) : (
          <span className={classes.saved}>
            <Money value={goal.saved} />
            <span className={classes.of}>
              {" "}
              {t("goals.of")} <Money value={goal.target} />
            </span>
          </span>
        )}
        {goal.traceId !== null && (
          <WhyButton
            subject={t("goals.whyLabel", { name: goal.name })}
            onClick={() => onWhy(goal.traceId as TraceId)}
          />
        )}
        {goal.percent !== null && (
          <span className={classes.percent}>{t("goals.percent", { percent: goal.percent })}</span>
        )}
      </div>
      {!noProgress && (
        <progress
          className={classes.bar}
          aria-label={goal.name}
          aria-valuetext={t("goals.percent", { percent: goal.percent ?? 0 })}
          value={Math.min(100, goal.percent ?? 0)}
          max={100}
        />
      )}

      {full && !noProgress && (
        <div className={classes.advice}>
          <div className={classes.adviceRow}>
            <span className={classes.adviceText}>
              {done ? (
                t("goals.done")
              ) : goal.contribution === null ? null : (
                <>{t("goals.contribution", { amount: formatMoney(goal.contribution) })}</>
              )}
            </span>
            {goal.contributionTraceId !== null && (
              <WhyButton
                subject={t("goals.whyContribution", { name: goal.name })}
                onClick={() => onWhy(goal.contributionTraceId as TraceId)}
              />
            )}
          </div>
          {!done && (
            <p className={classes.fits} data-fits={String(goal.fitsFreeBalance)}>
              <CircleCheck size={16} aria-hidden />
              {goal.fitsFreeBalance === null || freeBalance === null
                ? t("goals.fitsUnknown")
                : goal.fitsFreeBalance
                  ? t("goals.fits", { free: formatMoney(freeBalance) })
                  : t("goals.notFits", { free: formatMoney(freeBalance) })}
            </p>
          )}
        </div>
      )}
      {full && goal.behind && (
        <p className={classes.behind}>
          <AlertTriangle size={16} aria-hidden />
          {t("goals.behind", { planned: formatMoney(goal.planned) })}
        </p>
      )}
      {full && !piggy && !goal.accountMissing && (
        <p className={classes.hint}>
          <RefreshCw size={14} aria-hidden /> {t("goals.linkedHint")}
        </p>
      )}

      {piggy && onContribute !== undefined && (
        <div className={classes.contributions}>
          <div className={classes.contributionsHead}>
            {full && <h4 className={classes.contributionsTitle}>{t("goals.contributions")}</h4>}
            <Button
              size="xs"
              leftSection={<Plus size={14} aria-hidden />}
              onClick={() => onContribute(goal)}
            >
              {t("goals.contribute")}
            </Button>
          </div>
          {full && goal.contributions.length === 0 && (
            <p className={classes.hint}>{t("goals.noContributions")}</p>
          )}
          {full && goal.contributions.length > 0 && (
            <ul className={classes.list}>
              {goal.contributions.map((contribution) => (
                <li key={contribution.id} className={classes.contribution}>
                  <span>{formatDate(contribution.madeOn)}</span>
                  <Money value={contribution.amount} kind="income" tabular />
                </li>
              ))}
            </ul>
          )}
          {full && <p className={classes.hint}>{t("goals.piggyHint")}</p>}
        </div>
      )}
    </article>
  );
}
