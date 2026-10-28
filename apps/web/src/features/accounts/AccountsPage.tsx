// «Счета» (design/screens/Accounts.dc.html, STMT-01, STMT-02, STMT-09, EXPL-01): итоги «Всего на счетах» и «Доступно без
// накопительного» в BYN по курсу НБРБ, карточки счетов с остатком и днём остатка, у валюты — эквивалент в BYN; ⓘ у
// каждого числа открывает «Откуда эта цифра?» (accounts.explain сохраняет расчёт → ExplanationSheet). Добавить,
// переименовать, задать начальный остаток — сразу и с «Отменить» (P5); удалить — только через «Да» (DecisionDialog,
// AGT-07). Курса нет — итог не показан, видно почему. Четыре состояния (DES-16); список обновляет поток событий.
import {
  CreateAccountInput,
  NewAccountKind,
  type AccountListItem,
  type ExplainSubject,
} from "@kosht/contract";
import { formatDate, formatMoneyParts, parseMoney } from "@kosht/i18n";
import type { TraceId } from "@kosht/kernel";
import { Button, Menu, Modal, SegmentedControl, Select, Stack, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeftRight,
  Clock,
  EllipsisVertical,
  FileText,
  Plus,
  Wallet,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import { DecisionDialog, UndoActionToast } from "../../entities/action/index.ts";
import { AccountCard, useAccountName } from "../../entities/account/index.ts";
import { ExplanationSheet } from "../../entities/explanation/index.ts";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf } from "../../lib/errors.ts";
import {
  EmptyState,
  Money,
  PageHeader,
  SkeletonCard,
  StatCard,
  WhyButton,
} from "../../ui/index.ts";
import classes from "./AccountsPage.module.css";

const CURRENCIES = ["BYN", "USD", "EUR", "RUB", "CNY", "PLN"] as const;

type Dialog =
  | { readonly kind: "add" }
  | { readonly kind: "rename"; readonly account: AccountListItem }
  | { readonly kind: "initial"; readonly account: AccountListItem };

type Toast = { readonly token: string; readonly message: string };

/** «Наличные» в BYN и «Карта, не указана» — служебные: меню без «Удалить» (сервер проверяет сам). */
function isService(account: AccountListItem): boolean {
  return (
    account.kind === "unknown-card" ||
    (account.kind === "cash" && account.balance.currency === "BYN" && account.name === null)
  );
}

export function AccountsPage() {
  const { t } = useTranslation(["accounts", "errors"]);
  const { t: tUi } = useTranslation("ui");
  const queryClient = useQueryClient();
  const nameOf = useAccountName();
  const accounts = useQuery(orpc.accounts.list.queryOptions());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [traceId, setTraceId] = useState<TraceId | null>(null);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.accounts.key() });

  const failed = (error: unknown) =>
    setNotice(t("accounts:actionError", { reason: t(`errors:${errorCodeOf(error)}`) }));
  const changed = (message: string) => async (result: { undoToken: string }) => {
    setDialog(null);
    setNotice(null);
    setToast({ token: result.undoToken, message });
    await refresh();
  };
  const create = useMutation(orpc.accounts.create.mutationOptions({ onError: failed }));
  const rename = useMutation(orpc.accounts.rename.mutationOptions({ onError: failed }));
  const initial = useMutation(orpc.accounts.setInitialBalance.mutationOptions({ onError: failed }));
  const requestDelete = useMutation(
    orpc.accounts.requestDelete.mutationOptions({
      onSuccess: ({ decisionId: id }) => setDecisionId(id),
      onError: failed,
    }),
  );
  const explain = useMutation(
    orpc.accounts.explain.mutationOptions({
      onSuccess: ({ traceId: id }) => setTraceId(id),
      onError: () => setNotice(t("accounts:totals.whyError")),
    }),
  );
  const why = (subject: z.infer<typeof ExplainSubject>, label: string) => (
    <WhyButton subject={label} onClick={() => explain.mutate({ subject })} />
  );

  const data = accounts.data;
  const items = data?.items;
  const totals = data?.totals;
  const noRate =
    totals !== undefined && totals.missingRates.length > 0
      ? t("accounts:totals.noRate", { currencies: totals.missingRates.join(", ") })
      : null;

  return (
    <>
      <PageHeader
        title={t("accounts:title")}
        {...(data === undefined
          ? {}
          : {
              subtitle: t("accounts:subtitle", {
                date: formatDate(data.onDate),
                accounts: t("accounts:count", { count: data.items.length }),
              }),
            })}
        actions={
          <Button
            leftSection={<Plus size={18} aria-hidden />}
            onClick={() => setDialog({ kind: "add" })}
          >
            {t("accounts:add.button")}
          </Button>
        }
      />
      <div className={classes.body}>
        {accounts.isPending && (
          <div className={classes.grid}>
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}
        {accounts.isError && (
          <EmptyState
            tone="error"
            icon={AlertTriangle}
            title={t("accounts:error.title")}
            description={t("accounts:error.text")}
            actions={
              <Button onClick={() => void accounts.refetch()}>{t("accounts:error.retry")}</Button>
            }
          />
        )}
        {items?.length === 0 && (
          <EmptyState
            icon={Wallet}
            title={t("accounts:empty.title")}
            description={t("accounts:empty.text")}
          />
        )}
        {notice !== null && (
          <p className={classes.error} role="alert">
            <AlertTriangle size={18} aria-hidden />
            {notice}
          </p>
        )}
        {data !== undefined && items !== undefined && items.length > 0 && totals !== undefined && (
          <>
            <section className={classes.stats} aria-label={t("accounts:totals.total")}>
              <StatCard
                tone="free"
                title={t("accounts:totals.total")}
                value={totals.total === null ? "—" : <Money value={totals.total} size="kpi" />}
                hint={noRate ?? t("accounts:totals.totalHint", { date: formatDate(data.onDate) })}
                {...(totals.total === null
                  ? {}
                  : { why: why({ kind: "total" }, t("accounts:why.total")) })}
              />
              <StatCard
                title={t("accounts:totals.available")}
                value={
                  totals.available === null ? "—" : <Money value={totals.available} size="kpi" />
                }
                hint={noRate ?? t("accounts:totals.availableHint")}
                {...(totals.available === null
                  ? {}
                  : { why: why({ kind: "available" }, t("accounts:why.available")) })}
              />
            </section>
            <section className={classes.grid} aria-label={t("accounts:listLabel")}>
              {items.map((account) => {
                const name = nameOf(account);
                return (
                  <AccountCard
                    key={account.id}
                    account={account}
                    whyBalance={why(
                      { kind: "account", id: account.id },
                      t("accounts:why.balance", { name }),
                    )}
                    {...(account.balanceInByn === null
                      ? {}
                      : {
                          whyInByn: why(
                            { kind: "account", id: account.id },
                            t("accounts:why.inByn", { name }),
                          ),
                        })}
                    menu={
                      <AccountMenu
                        name={name}
                        service={isService(account)}
                        onRename={() => setDialog({ kind: "rename", account })}
                        onInitial={() => setDialog({ kind: "initial", account })}
                        onDelete={() => requestDelete.mutate({ id: account.id })}
                      />
                    }
                  />
                );
              })}
            </section>
            <HowBalances />
          </>
        )}
      </div>

      <Modal
        opened={dialog !== null}
        onClose={() => setDialog(null)}
        closeButtonProps={{ "aria-label": tUi("sheet.close") }}
        title={
          dialog?.kind === "rename"
            ? t("accounts:rename.title")
            : dialog?.kind === "initial"
              ? t("accounts:initial.title")
              : t("accounts:add.title")
        }
      >
        {dialog?.kind === "add" && (
          <AddAccountForm
            pending={create.isPending}
            onCancel={() => setDialog(null)}
            onSubmit={(input) =>
              create.mutate(input, {
                onSuccess: (result) =>
                  void changed(t("accounts:add.done", { name: nameOf(result.account) }))(result),
              })
            }
          />
        )}
        {dialog?.kind === "rename" && (
          <RenameForm
            initial={dialog.account.name ?? nameOf(dialog.account)}
            pending={rename.isPending}
            onCancel={() => setDialog(null)}
            onSubmit={(name) =>
              rename.mutate(
                { id: dialog.account.id, name },
                {
                  onSuccess: (result) =>
                    void changed(t("accounts:rename.done", { name: nameOf(result.account) }))(
                      result,
                    ),
                },
              )
            }
          />
        )}
        {dialog?.kind === "initial" && (
          <InitialForm
            account={dialog.account}
            pending={initial.isPending}
            onCancel={() => setDialog(null)}
            onSubmit={(initialBalance) =>
              initial.mutate(
                { id: dialog.account.id, initialBalance },
                {
                  onSuccess: (result) =>
                    void changed(t("accounts:initial.done", { name: nameOf(result.account) }))(
                      result,
                    ),
                },
              )
            }
          />
        )}
      </Modal>

      {decisionId !== null && (
        <DecisionDialog
          decisionId={decisionId}
          opened
          onClose={() => setDecisionId(null)}
          onAnswered={() => void refresh()}
        />
      )}
      {traceId !== null && (
        <ExplanationSheet traceId={traceId} opened onClose={() => setTraceId(null)} />
      )}
      {toast !== null && (
        <UndoActionToast
          key={toast.token}
          token={toast.token}
          message={toast.message}
          opened
          onClose={() => setToast(null)}
          onResult={(result) => {
            setNotice(
              result.ok || errorCodeOf(result.error) !== "CONFLICT"
                ? null
                : t("accounts:undoConflict"),
            );
            void refresh();
          }}
        />
      )}
    </>
  );
}

function AccountMenu({
  name,
  service,
  onRename,
  onInitial,
  onDelete,
}: {
  readonly name: string;
  readonly service: boolean;
  readonly onRename: () => void;
  readonly onInitial: () => void;
  readonly onDelete: () => void;
}) {
  const { t } = useTranslation("accounts");
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <button type="button" className={classes.menuButton} aria-label={t("menu.label", { name })}>
          <EllipsisVertical size={20} aria-hidden />
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={onRename}>{t("menu.rename")}</Menu.Item>
        <Menu.Item onClick={onInitial}>{t("menu.initial")}</Menu.Item>
        {service ? (
          <Menu.Label>{t("menu.protected")}</Menu.Label>
        ) : (
          <Menu.Item color="red" onClick={onDelete}>
            {t("menu.remove")}
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

function AddAccountForm({
  pending,
  onSubmit,
  onCancel,
}: {
  readonly pending: boolean;
  readonly onSubmit: (input: z.input<typeof CreateAccountInput>) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation("accounts");
  const [kind, setKind] = useState<z.infer<typeof NewAccountKind>>("card");
  const [name, setName] = useState("");
  const [bank, setBank] = useState("");
  const [mask, setMask] = useState("");
  const [currency, setCurrency] = useState<string>("BYN");
  const [amount, setAmount] = useState("");
  const balance = amount.trim() === "" ? null : parseMoney(amount, currency);
  const input = CreateAccountInput.safeParse({
    kind,
    name: name.trim() === "" ? null : name,
    bank: bank.trim() === "" ? null : bank,
    mask: mask === "" ? null : mask,
    currency,
    initialBalance: balance ?? null,
  });
  const valid = input.success && balance !== undefined;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (input.success && balance !== undefined) onSubmit(input.data);
  };
  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <p className={classes.muted}>{t("add.intro")}</p>
        <div>
          <p className={classes.label} id="account-kind">
            {t("add.kind")}
          </p>
          <SegmentedControl
            aria-labelledby="account-kind"
            fullWidth
            value={kind}
            onChange={(value) => setKind(NewAccountKind.parse(value))}
            data={NewAccountKind.options.map((value) => ({ value, label: t(`kind.${value}`) }))}
            className={classes.kinds}
          />
        </div>
        <TextInput
          label={t("add.name")}
          placeholder={t("add.namePlaceholder")}
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <div className={classes.pair}>
          <TextInput
            label={t("add.bank")}
            value={bank}
            maxLength={60}
            onChange={(event) => setBank(event.currentTarget.value)}
          />
          <TextInput
            label={t("add.mask")}
            description={t("add.maskHint")}
            inputMode="numeric"
            maxLength={4}
            value={mask}
            error={mask !== "" && !/^\d{4}$/.test(mask) ? t("add.maskInvalid") : null}
            onChange={(event) => setMask(event.currentTarget.value.replace(/\D/g, ""))}
          />
        </div>
        <div className={classes.pair}>
          <Select
            label={t("add.currency")}
            data={CURRENCIES.map((code) => ({ value: code, label: t(`add.currencies.${code}`) }))}
            value={currency}
            allowDeselect={false}
            onChange={(value) => setCurrency(value ?? "BYN")}
          />
          <TextInput
            label={t("add.initial")}
            description={t("add.initialHint")}
            inputMode="decimal"
            value={amount}
            error={balance === undefined ? t("add.amountInvalid") : null}
            onChange={(event) => setAmount(event.currentTarget.value)}
          />
        </div>
        <div className={classes.formActions}>
          <Button variant="subtle" onClick={onCancel}>
            {t("add.cancel")}
          </Button>
          <Button type="submit" disabled={!valid} loading={pending}>
            {t("add.submit")}
          </Button>
        </div>
      </Stack>
    </form>
  );
}

function RenameForm({
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  readonly initial: string;
  readonly pending: boolean;
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation("accounts");
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed !== "") onSubmit(trimmed);
      }}
    >
      <Stack gap="md">
        <TextInput
          label={t("rename.name")}
          value={name}
          maxLength={60}
          data-autofocus
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <div className={classes.formActions}>
          <Button variant="subtle" onClick={onCancel}>
            {t("rename.cancel")}
          </Button>
          <Button type="submit" disabled={trimmed === ""} loading={pending}>
            {t("rename.submit")}
          </Button>
        </div>
      </Stack>
    </form>
  );
}

function InitialForm({
  account,
  pending,
  onSubmit,
  onCancel,
}: {
  readonly account: AccountListItem;
  readonly pending: boolean;
  readonly onSubmit: (balance: NonNullable<ReturnType<typeof parseMoney>>) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation("accounts");
  const { currency } = account.initialBalance;
  const start = formatMoneyParts(account.initialBalance);
  const [amount, setAmount] = useState(`${start.negative ? "-" : ""}${start.amount}`);
  const balance = parseMoney(amount, currency);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (balance !== undefined) onSubmit(balance);
      }}
    >
      <Stack gap="md">
        <p className={classes.muted}>{t("initial.hint")}</p>
        <TextInput
          label={t("initial.amount", { currency })}
          inputMode="decimal"
          value={amount}
          data-autofocus
          error={balance === undefined ? t("add.amountInvalid") : null}
          onChange={(event) => setAmount(event.currentTarget.value)}
        />
        <div className={classes.formActions}>
          <Button variant="subtle" onClick={onCancel}>
            {t("initial.cancel")}
          </Button>
          <Button type="submit" disabled={balance === undefined} loading={pending}>
            {t("initial.submit")}
          </Button>
        </div>
      </Stack>
    </form>
  );
}

function HowBalances() {
  const { t } = useTranslation("accounts");
  return (
    <section className={classes.how} aria-labelledby="accounts-how">
      <h2 id="accounts-how" className={classes.howTitle}>
        {t("how.title")}
      </h2>
      <ul className={classes.howList}>
        <li className={classes.howItem}>
          <FileText size={20} strokeWidth={1.8} aria-hidden className={classes.howIcon} />
          <p>
            <strong>{t("how.statementLead")}</strong> {t("how.statement")}
          </p>
        </li>
        <li className={classes.howItem}>
          <ArrowLeftRight size={20} strokeWidth={1.8} aria-hidden className={classes.howIcon} />
          <p>
            <strong>{t("how.transfersLead")}</strong> {t("how.transfers")}
          </p>
        </li>
        <li className={classes.howItem}>
          <Clock size={20} strokeWidth={1.8} aria-hidden className={classes.howIcon} />
          <p>
            <strong>{t("how.receiptLead")}</strong> {t("how.receipt")}
          </p>
        </li>
      </ul>
    </section>
  );
}
