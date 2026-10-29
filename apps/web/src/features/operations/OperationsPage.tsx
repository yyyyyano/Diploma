// «Операции» (design/screens/Operations.dc.html, TXN-01…05, STMT-02, STMT-09, EXPL-01, P5, AGT-07): таблица со
// страницами по 50 (на телефоне — карточки и «Показать ещё»), поиск и фильтры в адресе, ручной ввод и правка — сразу и с
// «Отменить», карточка операции в боковой панели, удаление — только после «Да» (DecisionDialog) и снова «Отменить»,
// «Откуда курс?» у валютной операции. Четыре состояния (DES-16); обновления — поток событий (`transaction`).
// Показ «есть чек», «регулярный» и импорт в карточке — задачи T-028, T-030, T-026; «Выгрузить в Excel» — T-051.
import type { Transaction } from "@kosht/contract";
import { formatMoney } from "@kosht/i18n";
import type { TraceId } from "@kosht/kernel";
import { Button, Modal } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeftRight, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DecisionDialog, UndoActionToast, type UndoResult } from "../../entities/action/index.ts";
import { useCategoryLookup } from "../../entities/category/index.ts";
import { ExplanationSheet } from "../../entities/explanation/index.ts";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf } from "../../lib/errors.ts";
import { EmptyState, PageHeader, Sheet, SkeletonList } from "../../ui/index.ts";
import { hasFilters, OperationsSearch, PAGE_SIZE, toListInput } from "./model/search.ts";
import { OperationForm, type FormResult } from "./OperationForm.tsx";
import { OperationPanel } from "./OperationPanel.tsx";
import { OperationsCards, OperationsTable } from "./OperationsList.tsx";
import { OperationsToolbar } from "./OperationsToolbar.tsx";
import classes from "./OperationsPage.module.css";

type Dialog =
  | { readonly kind: "add" }
  | { readonly kind: "edit"; readonly transaction: Transaction };
type Toast = { readonly token: string; readonly message: string };

const PHONE_QUERY = "(max-width: 860px)";

export function OperationsPage({ search }: { readonly search: OperationsSearch }) {
  const { t } = useTranslation(["operations", "errors", "common"]);
  const { t: tUi } = useTranslation("ui");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const categories = useCategoryLookup();
  const isPhone = useMediaQuery(PHONE_QUERY) === true;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);
  const [traceId, setTraceId] = useState<TraceId | null>(null);

  const accounts = useQuery(orpc.accounts.list.queryOptions());
  const accountItems = accounts.data?.items ?? [];

  // Компьютер — одна страница по номеру из адреса; телефон — страницы подряд («Показать ещё»).
  const pageQuery = useQuery({
    ...orpc.transactions.list.queryOptions({ input: toListInput(search) }),
    enabled: !isPhone,
    placeholderData: keepPreviousData,
  });
  const moreQuery = useInfiniteQuery(
    orpc.transactions.list.infiniteOptions({
      input: (page: number) => toListInput(search, page),
      initialPageParam: 1,
      getNextPageParam: (last) =>
        last.page * last.pageSize < last.total ? last.page + 1 : undefined,
      enabled: isPhone,
    }),
  );
  const items = isPhone
    ? (moreQuery.data?.pages.flatMap((page) => page.items) ?? [])
    : (pageQuery.data?.items ?? []);
  const total = isPhone ? (moreQuery.data?.pages[0]?.total ?? 0) : (pageQuery.data?.total ?? 0);
  const loaded = isPhone ? moreQuery.data !== undefined : pageQuery.data !== undefined;
  const failed = isPhone ? moreQuery.isError : pageQuery.isError;
  const retry = () => void (isPhone ? moreQuery.refetch() : pageQuery.refetch());
  const filtered = hasFilters(search);

  const setSearch = (patch: Partial<OperationsSearch>, replace = false) =>
    void navigate({ to: "/operations", search: (prev) => ({ ...prev, ...patch }), replace });
  const reset = () => void navigate({ to: "/operations", search: {} });

  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.transactions.key() });
  const fail = (error: unknown) =>
    setNotice(t("operations:actionError", { reason: t(`errors:${errorCodeOf(error)}`) }));
  const titleOf = (item: Transaction) =>
    item.merchantName ??
    (item.category === null
      ? t(`operations:typeOne.${item.type}`)
      : categories.nameOf(item.category));
  const done = (message: string) => async (result: { undoToken: string }) => {
    setDialog(null);
    setNotice(null);
    setToast({ token: result.undoToken, message });
    await refresh();
  };

  const create = useMutation(orpc.transactions.create.mutationOptions({ onError: fail }));
  const update = useMutation(orpc.transactions.update.mutationOptions({ onError: fail }));
  const requestDelete = useMutation(
    orpc.transactions.requestDelete.mutationOptions({
      onSuccess: ({ decisionId: id }) => setDecisionId(id),
      onError: fail,
    }),
  );
  const explainRate = useMutation(
    orpc.transactions.explainRate.mutationOptions({
      onSuccess: ({ traceId: id }) => setTraceId(id),
      onError: () => setNotice(t("operations:panel.whyError")),
    }),
  );

  const submit = (result: FormResult) => {
    if (result.kind === "create") {
      create.mutate(result.input, {
        onSuccess: (created) =>
          void done(
            t("operations:done.created", {
              name: titleOf(created.transaction),
              amount: formatMoney(created.transaction.amount),
            }),
          )(created),
      });
      return;
    }
    if (dialog?.kind !== "edit") return;
    const { transaction } = dialog;
    update.mutate(
      { id: transaction.id, expectedVersion: transaction.version, patch: result.patch },
      {
        onSuccess: (updated) =>
          void done(t("operations:done.updated", { name: titleOf(updated.transaction) }))(updated),
      },
    );
  };

  const undone = (result: UndoResult) => {
    setNotice(
      result.ok || errorCodeOf(result.error) !== "CONFLICT"
        ? null
        : t("operations:done.undoConflict"),
    );
    void refresh();
  };

  const showToolbar = !failed && (filtered || !loaded || total > 0);
  const empty = loaded && total === 0;

  return (
    <>
      <PageHeader
        title={t("operations:title")}
        subtitle={
          loaded
            ? total === 0
              ? t("operations:subtitleEmpty")
              : t("operations:subtitle", {
                  operations: t("common:count.operations", { count: total }),
                })
            : undefined
        }
        actions={
          <Button
            leftSection={<Plus size={18} aria-hidden />}
            onClick={() => setDialog({ kind: "add" })}
          >
            {t("operations:add.button")}
          </Button>
        }
      />
      <div className={classes.body}>
        {showToolbar && (
          <OperationsToolbar
            search={search}
            accounts={accountItems}
            onChange={setSearch}
            onReset={reset}
          />
        )}
        {notice !== null && (
          <p className={classes.error} role="alert">
            <AlertTriangle size={18} aria-hidden />
            {notice}
          </p>
        )}
        {failed && (
          <EmptyState
            tone="error"
            icon={AlertTriangle}
            title={t("operations:error.title")}
            description={t("operations:error.text")}
            actions={<Button onClick={retry}>{t("operations:error.retry")}</Button>}
          />
        )}
        {!failed && !loaded && <SkeletonList />}
        {!failed && empty && !filtered && (
          <EmptyState
            icon={ArrowLeftRight}
            title={t("operations:empty.title")}
            description={t("operations:empty.text")}
            actions={
              <Button
                leftSection={<Plus size={18} aria-hidden />}
                onClick={() => setDialog({ kind: "add" })}
              >
                {t("operations:add.button")}
              </Button>
            }
          />
        )}
        {!failed && empty && filtered && (
          <EmptyState
            icon={ArrowLeftRight}
            title={t("operations:nothing.title")}
            description={t("operations:nothing.text")}
            actions={<Button onClick={reset}>{t("operations:filters.reset")}</Button>}
          />
        )}
        {!failed && loaded && !empty && !isPhone && (
          <OperationsTable
            items={items}
            total={total}
            accounts={accountItems}
            page={search.page ?? 1}
            pageSize={PAGE_SIZE}
            onPage={(page) => setSearch({ page })}
            onOpen={(id) => setSearch({ op: OperationsSearch.shape.op.parse(id) })}
          />
        )}
        {!failed && loaded && !empty && isPhone && (
          <OperationsCards
            items={items}
            total={total}
            accounts={accountItems}
            hasMore={moreQuery.hasNextPage}
            loadingMore={moreQuery.isFetchingNextPage}
            onMore={() => void moreQuery.fetchNextPage()}
            onOpen={(id) => setSearch({ op: OperationsSearch.shape.op.parse(id) })}
          />
        )}
      </div>

      {/* Окно монтируется только открытым: после карточки (Sheet) оно оказывается в DOM позже и лежит поверх неё —
          окно, смонтированное раньше панели, оказалось бы под её фоном, и «Сохранить» нельзя было бы нажать. */}
      {dialog !== null && (
        <Modal
          opened
          onClose={() => setDialog(null)}
          closeButtonProps={{ "aria-label": tUi("sheet.close") }}
          title={
            dialog.kind === "edit" ? t("operations:form.editTitle") : t("operations:form.addTitle")
          }
          size={560}
        >
          {accounts.data !== undefined && (
            <OperationForm
              accounts={accountItems}
              today={accounts.data.onDate}
              {...(dialog.kind === "edit" ? { transaction: dialog.transaction } : {})}
              pending={create.isPending || update.isPending}
              onSubmit={submit}
              onCancel={() => setDialog(null)}
            />
          )}
        </Modal>
      )}

      <Sheet
        opened={search.op !== undefined}
        onClose={() => setSearch({ op: undefined })}
        title={t("operations:panel.title")}
        position={isPhone ? "bottom" : "right"}
      >
        {search.op !== undefined && (
          <OperationPanel
            id={search.op}
            accounts={accountItems}
            onEdit={(transaction) => setDialog({ kind: "edit", transaction })}
            onDelete={(transaction) => {
              setDeleted(titleOf(transaction));
              requestDelete.mutate({ ids: [transaction.id] });
            }}
            onCategory={(transaction, category) =>
              update.mutate(
                {
                  id: transaction.id,
                  expectedVersion: transaction.version,
                  patch: { category },
                },
                {
                  onSuccess: (updated) =>
                    void done(t("operations:done.updated", { name: titleOf(updated.transaction) }))(
                      updated,
                    ),
                },
              )
            }
            onWhyRate={(transaction) => explainRate.mutate({ id: transaction.id })}
          />
        )}
      </Sheet>

      {decisionId !== null && (
        <DecisionDialog
          decisionId={decisionId}
          opened
          onClose={() => setDecisionId(null)}
          onAnswered={(status, undoToken) => {
            if (status === "yes") {
              setSearch({ op: undefined });
              if (undoToken !== null) {
                setToast({
                  token: undoToken,
                  message: t("operations:done.deleted", { name: deleted ?? "" }),
                });
              }
            }
            void refresh();
          }}
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
          onResult={undone}
        />
      )}
    </>
  );
}
