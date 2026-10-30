// Окно «Новая цель» / правка цели (BUD-04, BUD-05; design/screens/Budget.dc.html — Budget--new-goal): способ копить,
// название, сумма, срок; рядом — «Откладывайте по X в месяц» и «укладывается ли в свободный остаток» (сервер: `previewGoal`).
// Сайт взнос не считает (P1): строка предпросмотра — ответ сервера.
import { CreateGoalInput, GoalKind, PreviewGoalInput, type BudgetGoal } from "@kosht/contract";
import { formatMoney, formatMoneyParts, parseMoney } from "@kosht/i18n";
import { Button, Select, Stack, TextInput } from "@mantine/core";
import { skipToken, useQuery } from "@tanstack/react-query";
import { Wallet, PiggyBank } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import classes from "./BudgetPage.module.css";

export function GoalForm({
  goal,
  pending,
  onSubmit,
  onCancel,
}: {
  /** Правка: меняются название, сумма, срок; вид и счёт — нет. */
  readonly goal?: BudgetGoal;
  readonly pending: boolean;
  readonly onSubmit: (input: ReturnType<typeof CreateGoalInput.parse>) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation("budget");
  const editing = goal !== undefined;
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? "piggy");
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(
    goal === undefined ? "" : formatMoneyParts(goal.target).amount,
  );
  const [deadline, setDeadline] = useState<string>(goal?.deadline ?? "");
  const [accountId, setAccountId] = useState<string | null>(goal?.accountId ?? null);
  const accounts = useQuery({ ...orpc.accounts.list.queryOptions(), enabled: kind === "account" });
  const savings = (accounts.data?.items ?? []).filter(
    (a) => a.kind === "savings" || a.kind === "deposit",
  );
  const parsed = parseMoney(target, "BYN");
  const input = CreateGoalInput.safeParse({
    name,
    kind,
    ...(parsed === undefined ? {} : { target: parsed }),
    deadline,
    ...(kind === "account" && accountId !== null ? { accountId } : {}),
  });
  const valid =
    input.success &&
    parsed !== undefined &&
    parsed.minor > 0 &&
    (kind === "piggy" || accountId !== null);
  const previewInput = PreviewGoalInput.safeParse({
    ...(parsed === undefined ? {} : { target: parsed }),
    deadline,
    ...(kind === "account" && accountId !== null ? { accountId } : {}),
  });
  const preview = useQuery(
    orpc.budgets.previewGoal.queryOptions({
      input: !editing && valid && previewInput.success ? previewInput.data : skipToken,
    }),
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (input.success && valid) onSubmit(input.data);
  };
  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        {!editing && (
          <fieldset className={classes.fieldset}>
            <legend className={classes.legend}>{t("goalForm.how")}</legend>
            <div className={classes.kinds}>
              {(["piggy", "account"] as const).map((value) => (
                <label key={value} className={classes.kind} data-selected={kind === value}>
                  <input
                    type="radio"
                    name="goal-kind"
                    className={classes.visuallyHidden}
                    checked={kind === value}
                    onChange={() => setKind(value)}
                  />
                  <span className={classes.kindTitle}>
                    {value === "piggy" ? (
                      <PiggyBank size={16} aria-hidden />
                    ) : (
                      <Wallet size={16} aria-hidden />
                    )}
                    {t(value === "piggy" ? "goalForm.piggy" : "goalForm.account")}
                  </span>
                  <span className={classes.kindText}>
                    {t(value === "piggy" ? "goalForm.piggyText" : "goalForm.accountText")}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <TextInput
          label={t("goalForm.name")}
          placeholder={t("goalForm.namePlaceholder")}
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <div className={classes.pair}>
          <TextInput
            label={t("goalForm.target")}
            placeholder={t("goalForm.targetPlaceholder")}
            inputMode="decimal"
            value={target}
            error={
              !valid && target !== "" && (parsed === undefined || parsed.minor <= 0)
                ? t("goalForm.targetInvalid")
                : null
            }
            onChange={(event) => setTarget(event.currentTarget.value)}
          />
          <TextInput
            label={t("goalForm.deadline")}
            type="date"
            value={deadline}
            onChange={(event) => setDeadline(event.currentTarget.value)}
          />
        </div>
        {kind === "account" && !editing && (
          <Select
            label={t("goalForm.accountLabel")}
            placeholder={t("goalForm.accountPlaceholder")}
            allowDeselect={false}
            value={accountId}
            onChange={setAccountId}
            data={savings.map((a) => ({
              value: a.id,
              label: `${a.name ?? a.kind} ${a.mask === null ? "" : `•• ${a.mask}`}`.trim(),
            }))}
            nothingFoundMessage={t("goalForm.noSavings")}
          />
        )}
        {!editing && (
          <div className={classes.preview} aria-live="polite">
            {preview.data === undefined ? (
              <p>{t("goalForm.previewEmpty")}</p>
            ) : (
              <>
                <p className={classes.previewMain}>
                  {t("goalForm.previewContribution", {
                    amount: formatMoney(preview.data.contribution),
                  })}
                </p>
                <p className={classes.muted}>
                  {preview.data.fitsFreeBalance === null || preview.data.freeBalance === null
                    ? t("goalForm.previewUnknown")
                    : t(
                        preview.data.fitsFreeBalance
                          ? "goalForm.previewFits"
                          : "goalForm.previewNotFits",
                        {
                          free: formatMoney(preview.data.freeBalance),
                        },
                      )}
                </p>
              </>
            )}
          </div>
        )}
        <div className={classes.buttons}>
          <Button type="submit" disabled={!valid} loading={pending}>
            {t(editing ? "goalForm.save" : "goalForm.create")}
          </Button>
          <Button variant="default" onClick={onCancel}>
            {t("goalForm.cancel")}
          </Button>
        </div>
      </Stack>
    </form>
  );
}
