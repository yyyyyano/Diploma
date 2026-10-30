// Взнос в копилку (BUD-04, AGT-05, P5; design/screens/Main.dc.html — «Внести»): окно с суммой, вход проверяет схема контракта.
// Взнос сразу записывается, а «Отменить» — у вызвавшей страницы (onDone отдаёт undoToken): окно подтверждения не нужно.
import { ContributeInput, type BudgetGoal } from "@kosht/contract";
import { parseMoney } from "@kosht/i18n";
import { Button, Modal, TextInput } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import classes from "./GoalCard.module.css";

export interface ContributeDialogProps {
  /** Копилка, в которую вносим; `null` — окно закрыто. */
  readonly goal: BudgetGoal | null;
  readonly onClose: () => void;
  readonly onDone: (result: { goal: BudgetGoal; undoToken: string; amountText: string }) => void;
}

export function ContributeDialog({ goal, onClose, onDone }: ContributeDialogProps) {
  const { t } = useTranslation(["budget", "errors"]);
  const [amount, setAmount] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const contribute = useMutation(
    orpc.budgets.contribute.mutationOptions({
      onError: (error) => {
        const reason = errorParamsOf(error)["reason"];
        setFailure(
          t("budget:actionError", {
            reason:
              typeof reason === "string"
                ? t(`budget:reasons.${reason}`, { defaultValue: t("errors:VALIDATION") })
                : t(`errors:${errorCodeOf(error)}`),
          }),
        );
      },
      onSuccess: (result) => {
        onDone({ goal: result.goal, undoToken: result.undoToken, amountText: amount });
        setAmount("");
        setFailure(null);
      },
    }),
  );
  const parsed = parseMoney(amount, "BYN");
  const input =
    goal === null || parsed === undefined
      ? undefined
      : ContributeInput.safeParse({ goalId: goal.id, amount: parsed });
  const valid = input?.success === true && parsed !== undefined && parsed.minor > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (input?.success === true && valid) contribute.mutate(input.data);
  };
  return (
    <Modal
      opened={goal !== null}
      onClose={onClose}
      title={t("budget:contributeForm.title", { name: goal?.name ?? "" })}
    >
      <form onSubmit={submit}>
        <TextInput
          label={t("budget:contributeForm.amount")}
          inputMode="decimal"
          data-autofocus
          value={amount}
          error={!valid && amount !== "" ? t("budget:contributeForm.amountInvalid") : null}
          onChange={(event) => setAmount(event.currentTarget.value)}
        />
        {failure !== null && <p role="alert">{failure}</p>}
        <div className={classes.contributionsHead}>
          <Button variant="default" onClick={onClose}>
            {t("budget:contributeForm.cancel")}
          </Button>
          <Button type="submit" disabled={!valid} loading={contribute.isPending}>
            {t("budget:contributeForm.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
