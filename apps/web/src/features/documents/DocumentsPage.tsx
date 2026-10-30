// «Чеки и документы» (design/screens/Documents.dc.html, STMT-03, STMT-04, STMT-07, STMT-11, NFR-21, P5): загрузка выписки,
// предпросмотр импорта («Нашёл 47 операций по карте •• 4821 за 01.09–30.09. 12 из них уже были загружены»: числа считает
// сервер), «Импортировать N» / «Исправить колонки» / «Отмена», откат с подтверждением и список выписок. Ход разбора —
// события потока (statement-import): страница перезапрашивает импорт сама. Четыре состояния (DES-16). Блок чеков — T-028.
import type { ColumnRole, ImportDetail, ImportSummary } from "@kosht/contract";
import { formatDate, formatMoney } from "@kosht/i18n";
import { Button, Modal, NativeSelect, Stack } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileText, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CategoryBadge } from "../../entities/category/index.ts";
import { DecisionDialog, UndoActionToast } from "../../entities/action/index.ts";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { progressQueryKey, type Progress } from "../../lib/events.ts";
import { ConfirmDialog, EmptyState, Money, PageHeader, SkeletonCard } from "../../ui/index.ts";
import classes from "./DocumentsPage.module.css";
import type { DocumentsSearch } from "./model/search.ts";

const ROLES: readonly ColumnRole[] = [
  "date",
  "time",
  "description",
  "amount",
  "debit",
  "credit",
  "currency",
  "operationAmount",
  "operationCurrency",
  "balance",
  "operationId",
  "ignore",
];

type Dialog =
  | { readonly kind: "columns" }
  | { readonly kind: "rollback"; readonly transactions: number; readonly edited: number };

/** search.import — импорт, открытый по ссылке из карточки операции (STMT-10). */
export function DocumentsPage({ search = {} }: { readonly search?: DocumentsSearch }) {
  const { t } = useTranslation(["documents", "errors", "common"]);
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const list = useQuery(orpc.statements.list.queryOptions());
  const [openId, setOpenId] = useState<string | null>(search.import ?? null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<{ token: string; message: string } | null>(null);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.statements.key() });

  const failed = (error: unknown) =>
    setNotice(
      t("documents:actionError", {
        reason: t(`errors:${errorCodeOf(error)}`, errorParamsOf(error)),
      }),
    );

  const detail = useQuery({
    ...orpc.statements.get.queryOptions({ input: { id: openId ?? "" } }),
    enabled: openId !== null,
  });
  const progress = useQuery<Progress>({
    queryKey: progressQueryKey("statement-import", openId ?? ""),
    queryFn: () => ({}),
    enabled: false,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const saved = await orpc.files.upload.call({ kind: "statement", files: [file] });
      const first = saved.files[0];
      if (first === undefined) throw new Error("no-file");
      return orpc.statements.start.call({ fileId: first.id });
    },
    onSuccess: async ({ id }) => {
      setNotice(null);
      setOpenId(id);
      await refresh();
    },
    onError: (error) =>
      setNotice(
        t("documents:upload.error", {
          reason: t(`errors:${errorCodeOf(error)}`, errorParamsOf(error)),
        }),
      ),
  });
  const confirm = useMutation(
    orpc.statements.confirm.mutationOptions({
      onSuccess: async (result) => {
        setNotice(null);
        setToast({
          token: result.undoToken,
          message: t("documents:done.imported", { count: result.imported }),
        });
        if (result.decisionId !== null) setDecisionId(result.decisionId);
        await refresh();
        await queryClient.invalidateQueries({ queryKey: orpc.transactions.key() });
        await queryClient.invalidateQueries({ queryKey: orpc.accounts.key() });
      },
      onError: failed,
    }),
  );
  const cancel = useMutation(
    orpc.statements.cancel.mutationOptions({
      onSuccess: async () => {
        setOpenId(null);
        await refresh();
      },
      onError: failed,
    }),
  );
  const fix = useMutation(
    orpc.statements.fixColumns.mutationOptions({
      onSuccess: async () => {
        setDialog(null);
        await refresh();
      },
      onError: failed,
    }),
  );
  const rollback = useMutation(
    orpc.statements.rollback.mutationOptions({
      onSuccess: async () => {
        setDialog(null);
        setNotice(t("documents:done.rolledBack"));
        await refresh();
        await queryClient.invalidateQueries({ queryKey: orpc.transactions.key() });
        await queryClient.invalidateQueries({ queryKey: orpc.accounts.key() });
      },
      onError: failed,
    }),
  );
  const askRollback = useMutation(
    orpc.statements.rollbackInfo.mutationOptions({
      onSuccess: (info) => setDialog({ kind: "rollback", ...info }),
      onError: failed,
    }),
  );

  const items = list.data?.items;
  const current = detail.data;

  return (
    <>
      <PageHeader
        title={t("documents:title")}
        subtitle={t("documents:subtitle")}
        actions={
          <>
            <input
              ref={input}
              type="file"
              hidden
              accept=".pdf,.xlsx,.xls,.csv,.txt,image/*"
              aria-label={t("documents:upload.label")}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file !== undefined) upload.mutate(file);
              }}
            />
            <Button
              leftSection={<Upload size={18} aria-hidden />}
              loading={upload.isPending}
              onClick={() => input.current?.click()}
            >
              {t("documents:upload.button")}
            </Button>
          </>
        }
      />
      <div className={classes.body}>
        <p className={classes.hint}>{t("documents:upload.hint")}</p>
        {notice !== null && (
          <p className={classes.error} role="alert">
            <AlertTriangle size={18} aria-hidden />
            {notice}
          </p>
        )}
        {list.isPending && <SkeletonCard />}
        {list.isError && (
          <EmptyState
            tone="error"
            icon={AlertTriangle}
            title={t("documents:error.title")}
            description={t("documents:error.text")}
            actions={
              <Button onClick={() => void list.refetch()}>{t("documents:error.retry")}</Button>
            }
          />
        )}
        {items?.length === 0 && openId === null && (
          <EmptyState
            icon={FileText}
            title={t("documents:empty.title")}
            description={t("documents:empty.text")}
          />
        )}
        {openId !== null && current !== undefined && (
          <ImportPanel
            detail={current}
            percent={progress.data?.percent}
            busy={confirm.isPending || cancel.isPending}
            onConfirm={() => confirm.mutate({ id: current.summary.id })}
            onCancel={() => cancel.mutate({ id: current.summary.id })}
            onColumns={() => setDialog({ kind: "columns" })}
            onRollback={() => askRollback.mutate({ id: current.summary.id })}
          />
        )}
        {items !== undefined && items.length > 0 && (
          <section aria-labelledby="documents-list">
            <h2 id="documents-list" className={classes.panelTitle}>
              {t("documents:list.heading")}
            </h2>
            <ul className={classes.list}>
              {items.map((item) => (
                <ImportItem
                  key={item.id}
                  item={item}
                  opened={item.id === openId}
                  onOpen={() => setOpenId(item.id)}
                />
              ))}
            </ul>
          </section>
        )}
      </div>

      {dialog?.kind === "columns" && current?.columns != null && (
        <ColumnsDialog
          detail={current}
          pending={fix.isPending}
          onClose={() => setDialog(null)}
          onSave={(columns) => fix.mutate({ id: current.summary.id, columns })}
        />
      )}
      {dialog?.kind === "rollback" && current !== undefined && (
        <ConfirmDialog
          opened
          tone="danger"
          title={t("documents:rollback.title")}
          confirmLabel={t("documents:rollback.confirm")}
          pending={rollback.isPending}
          onConfirm={() => rollback.mutate({ id: current.summary.id })}
          onCancel={() => setDialog(null)}
        >
          <p>{t("documents:rollback.text", { count: dialog.transactions })}</p>
          {dialog.edited > 0 && <p>{t("documents:rollback.edited", { count: dialog.edited })}</p>}
        </ConfirmDialog>
      )}
      {toast !== null && (
        <UndoActionToast
          opened
          token={toast.token}
          message={toast.message}
          onClose={() => setToast(null)}
          onResult={(result) => {
            setToast(null);
            if (result.ok) {
              setNotice(t("documents:done.rolledBack"));
              void refresh();
              void queryClient.invalidateQueries({ queryKey: orpc.transactions.key() });
              void queryClient.invalidateQueries({ queryKey: orpc.accounts.key() });
            } else {
              failed(result.error);
            }
          }}
        />
      )}
      {decisionId !== null && (
        <DecisionDialog decisionId={decisionId} opened onClose={() => setDecisionId(null)} />
      )}
    </>
  );
}

function ImportItem({
  item,
  opened,
  onOpen,
}: {
  readonly item: ImportSummary;
  readonly opened: boolean;
  readonly onOpen: () => void;
}) {
  const { t } = useTranslation("documents");
  const title = [item.bank ?? t("list.unknownBank"), item.mask === null ? null : `•• ${item.mask}`]
    .filter((part) => part !== null)
    .join(" ");
  return (
    <li className={classes.item}>
      <div>
        <h3 className={classes.itemTitle}>{title}</h3>
        <p className={classes.itemMeta}>
          {t(`status.${item.status}`)}
          {item.period !== null &&
            ` · ${t("list.period", { from: formatDate(item.period.from), to: formatDate(item.period.to) })}`}
          {item.found > 0 && ` · ${t("list.counts", { count: item.found })}`}
        </p>
      </div>
      {!opened && (
        <Button variant="default" onClick={onOpen}>
          {t("list.open")}
        </Button>
      )}
    </li>
  );
}

function ImportPanel({
  detail,
  percent,
  busy,
  onConfirm,
  onCancel,
  onColumns,
  onRollback,
}: {
  readonly detail: ImportDetail;
  readonly percent: number | undefined;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onColumns: () => void;
  readonly onRollback: () => void;
}) {
  const { t } = useTranslation(["documents", "common", "errors"]);
  const s = detail.summary;

  if (s.status === "parsing" || s.status === "importing") {
    return (
      <section className={classes.panel} aria-live="polite" aria-labelledby="doc-parsing">
        <h2 id="doc-parsing" className={classes.panelTitle}>
          {t("documents:parsing.title")}
        </h2>
        <p className={classes.hint}>{t("documents:parsing.text")}</p>
        {percent !== undefined && (
          <p className={classes.hint}>{t("documents:parsing.percent", { percent })}</p>
        )}
      </section>
    );
  }
  if (s.status === "failed") {
    return (
      <EmptyState
        tone="error"
        icon={AlertTriangle}
        title={t("documents:failed.title")}
        description={t("documents:failed.text")}
        actions={
          <>
            {detail.columns !== null && (
              <Button onClick={onColumns}>{t("documents:failed.fix")}</Button>
            )}
            <Button variant="default" onClick={onCancel} loading={busy}>
              {t("documents:preview.cancel")}
            </Button>
          </>
        }
      />
    );
  }

  const operations = t("common:count.operations", { count: s.found });
  const from = s.period === null ? "" : formatDate(s.period.from);
  const to = s.period === null ? "" : formatDate(s.period.to);
  const summary =
    s.period === null
      ? t("documents:preview.noPeriod", { operations })
      : s.mask === null
        ? t("documents:preview.noCard", { operations, from, to })
        : t("documents:preview.withCard", { operations, mask: s.mask, from, to });

  return (
    <section className={classes.panel} aria-labelledby="doc-preview">
      <h2 id="doc-preview" className={classes.panelTitle}>
        {t("documents:preview.title")}
      </h2>
      <p className={classes.summary}>
        {summary} {s.duplicates > 0 && t("documents:preview.duplicates", { count: s.duplicates })}
      </p>
      <p className={classes.badges}>
        <span className={classes.badge}>
          {t("documents:preview.badges.new", { count: s.newCount })}
        </span>
        <span className={classes.badge}>
          {t("documents:preview.badges.duplicates", { count: s.duplicates })}
        </span>
        <span className={classes.badge}>
          {t("documents:preview.badges.skipped", { count: s.skipped })}
        </span>
      </p>
      <ul className={classes.notes}>
        {s.newCount === 0 && s.status === "ready" && <li>{t("documents:preview.nothingNew")}</li>}
        {s.balance !== null && s.balance.status === "ok" && (
          <li>{t("documents:preview.balanceOk")}</li>
        )}
        {s.balance !== null && s.balance.status === "unknown" && (
          <li>{t("documents:preview.balanceUnknown")}</li>
        )}
        {s.balance !== null && s.balance.status === "mismatch" && s.balance.difference !== null && (
          <li className={classes.warn}>
            {t("documents:preview.balanceMismatch", { amount: formatMoney(s.balance.difference) })}
          </li>
        )}
        {s.formatChanged && <li>{t("documents:preview.formatChanged")}</li>}
        {s.method !== null && <li>{t(`documents:preview.method.${s.method}`)}</li>}
        {s.doubtful > 0 && <li>{t("documents:preview.doubtful", { count: s.doubtful })}</li>}
        {s.skipped > 0 && <li>{t("documents:preview.skipped", { count: s.skipped })}</li>}
      </ul>

      {detail.rows.length > 0 && (
        <>
          <h3 className={classes.itemTitle}>{t("documents:preview.firstRows")}</h3>
          <div className={classes.scroll}>
            <table className={classes.table}>
              <thead>
                <tr>
                  <th scope="col">{t("documents:preview.columns.raw")}</th>
                  <th scope="col">{t("documents:preview.columns.merchant")}</th>
                  <th scope="col">{t("documents:preview.columns.category")}</th>
                  <th scope="col">{t("documents:preview.columns.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {detail.rows.map((row, index) => (
                  <tr key={`${row.date}-${String(index)}`}>
                    <td className={classes.raw}>
                      {formatDate(row.date)} · {row.description}
                      {row.duplicate && (
                        <span className={classes.badge}>
                          {t("documents:preview.duplicateBadge")}
                        </span>
                      )}
                      {row.doubtful && !row.duplicate && (
                        <span className={classes.badge}>
                          {t("documents:preview.doubtfulBadge")}
                        </span>
                      )}
                    </td>
                    <td>{row.merchantName ?? t(`documents:preview.kind.${row.kind}`)}</td>
                    <td>
                      {row.kind === "transfer" ? (
                        t("documents:preview.kind.transfer")
                      ) : (
                        <CategoryBadge category={row.category} />
                      )}
                    </td>
                    <td>
                      <Money
                        value={{ minor: Math.abs(row.amount.minor), currency: row.amount.currency }}
                        kind={
                          row.kind === "transfer"
                            ? "transfer"
                            : row.amount.minor < 0
                              ? "expense"
                              : "income"
                        }
                        tabular
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className={classes.actions}>
        {s.status === "ready" && (
          <>
            <Button onClick={onConfirm} loading={busy} disabled={s.newCount === 0}>
              {t("documents:preview.importButton", { count: s.newCount })}
            </Button>
            {detail.columns !== null && (
              <Button variant="default" onClick={onColumns}>
                {t("documents:preview.fixColumns")}
              </Button>
            )}
            <Button variant="subtle" onClick={onCancel} loading={busy}>
              {t("documents:preview.cancel")}
            </Button>
            <span className={classes.fileKept}>{t("documents:preview.fileKept")}</span>
          </>
        )}
        {s.status === "imported" && (
          <Button variant="default" onClick={onRollback}>
            {t("documents:list.rollback")}
          </Button>
        )}
      </div>
    </section>
  );
}

function ColumnsDialog({
  detail,
  pending,
  onClose,
  onSave,
}: {
  readonly detail: ImportDetail;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onSave: (columns: { index: number; role: ColumnRole }[]) => void;
}) {
  const { t } = useTranslation("documents");
  const sample = detail.columns;
  const [roles, setRoles] = useState<ColumnRole[]>(sample === null ? [] : [...sample.roles]);
  if (sample === null) return null;
  return (
    <Modal
      opened
      onClose={onClose}
      title={t("columns.title")}
      size="lg"
      closeButtonProps={{ "aria-label": t("columns.close") }}
    >
      <Stack className={classes.columns}>
        <p className={classes.hint}>{t("columns.text")}</p>
        {roles.map((role, index) => (
          <div key={index}>
            <NativeSelect
              label={t("columns.column", { number: index + 1 })}
              description={[
                sample.header[index],
                ...sample.rows.slice(0, 2).map((row) => row[index]),
              ]
                .filter((cell) => cell !== undefined && cell !== "")
                .join(" · ")}
              value={role}
              data={ROLES.map((value) => ({ value, label: t(`columns.role.${value}`) }))}
              onChange={(event) =>
                setRoles((current) =>
                  current.map((existing, i) =>
                    i === index ? (event.currentTarget.value as ColumnRole) : existing,
                  ),
                )
              }
            />
          </div>
        ))}
        <div className={classes.actions}>
          <Button
            loading={pending}
            onClick={() => onSave(roles.map((role, index) => ({ index, role })))}
          >
            {t("columns.save")}
          </Button>
          <Button variant="default" onClick={onClose}>
            {t("columns.close")}
          </Button>
        </div>
      </Stack>
    </Modal>
  );
}
