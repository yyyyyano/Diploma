// «Операции» (design/screens/Operations.dc.html, TXN-01…05, STMT-02, STMT-09, EXPL-01, P5, AGT-07): таблица со
// страницами по 50 (на телефоне — карточки и «Показать ещё»), поиск и фильтры в адресе, ручной ввод и правка — сразу и с
// «Отменить», карточка операции в боковой панели, удаление — только после «Да» (DecisionDialog) и снова «Отменить»,
// «Откуда курс?» у валютной операции. Четыре состояния (DES-16); обновления — поток событий (`transaction`).
// Показ «есть чек», «регулярный» и импорт в карточке — задачи T-028, T-030, T-026; «Выгрузить в Excel» — T-051.
import { MARKERS_MAX, type Transaction } from "@kosht/contract";
import { formatMoney } from "@kosht/i18n";
import type { TraceId } from "@kosht/kernel";
import { Button, Modal } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueries,
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
import { BulkBar } from "./BulkBar.tsx";
import { BulkCategoryDialog } from "./BulkCategoryDialog.tsx";
import classes from "./OperationsPage.module.css";

type Dialog =
  | { readonly kind: "add" }
  | { readonly kind: "edit"; readonly transaction: Transaction };
type Toast = { readonly token: string; readonly message: string };
/** Вопрос «Да/Нет» на экране: id решения, кнопка-глагол с числом и что сказать после «Да» (с «Отменить»). */
type Question = {
  readonly id: string;
  readonly confirmLabel?: string;
  readonly done: string;
};

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
  const [question, setQuestion] = useState<Question | null>(null);
  const [pickCategory, setPickCategory] = useState(false);
  const [traceId, setTraceId] = useState<TraceId | null>(null);
  // Выбранные строки (TXN-04): сбрасываются, когда меняются фильтры или страница.
  const scopeKey = JSON.stringify({ ...search, op: undefined });
  const [picked, setPicked] = useState<{ readonly key: string; readonly ids: ReadonlySet<string> }>(
    {
      key: scopeKey,
      ids: new Set(),
    },
  );
  const selected: ReadonlySet<string> = picked.key === scopeKey ? picked.ids : new Set();

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
  // REC-02: «регулярный» у строк страницы — один запрос на страницу, а не на строку; нет ответа — просто нет метки.
  const chunks = Array.from({ length: Math.ceil(items.length / MARKERS_MAX) }, (_, index) =>
    items.slice(index * MARKERS_MAX, (index + 1) * MARKERS_MAX).map((item) => item.id),
  );
  const markers = useQueries({
    queries: chunks.map((ids) => orpc.recurring.markers.queryOptions({ input: { ids } })),
  });
  const regular: ReadonlySet<string> = new Set(markers.flatMap((query) => query.data?.ids ?? []));

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
  const ask = (confirmLabel: string, doneText: string) => (result: { decisionId: string }) =>
    setQuestion({ id: result.decisionId, confirmLabel, done: doneText });
  const requestDelete = useMutation(
    orpc.transactions.requestDelete.mutationOptions({ onError: fail }),
  );
  const requestCategory = useMutation(
    orpc.transactions.requestChangeCategory.mutationOptions({ onError: fail }),
  );
  const requestTransfer = useMutation(
    orpc.transactions.requestMarkTransfer.mutationOptions({ onError: fail }),
  );
  const explainRate = useMutation(
    orpc.transactions.explainRate.mutationOptions({
      onSuccess: ({ traceId: id }) => setTraceId(id),
      onError: () => setNotice(t("operations:panel.whyError")),
    }),
  );

  const toggle = (id: string) => {
    const ids = new Set(selected);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    setPicked({ key: scopeKey, ids });
  };
  const toggleAll = () => {
    const shown = items.map((item) => item.id);
    const all = shown.every((id) => selected.has(id));
    setPicked({ key: scopeKey, ids: new Set(all ? [] : shown) });
  };
  const clearSelection = () => setPicked({ key: scopeKey, ids: new Set() });
  const chosen = items.filter((item) => selected.has(item.id));
  const chosenIds = chosen.map((item) => item.id);
  const count = chosen.length;

  /** Исправление категории создало правило контрагента — спросить про прошлые операции (CAT-05). */
  const afterUpdate = (updated: { applyToPast: { decisionId: string; count: number } | null }) => {
    if (updated.applyToPast === null) return;
    const past = updated.applyToPast;
    setQuestion({
      id: past.decisionId,
      confirmLabel: t("operations:bulk.confirmRule", { count: past.count }),
      done: t("operations:done.ruleApplied", { count: past.count }),
    });
  };

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
        onSuccess: (updated) => {
          void done(t("operations:done.updated", { name: titleOf(updated.transaction) }))(updated);
          afterUpdate(updated);
        },
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
        {count > 0 && (
          <BulkBar
            count={count}
            onChangeCategory={() => setPickCategory(true)}
            onMarkTransfer={() =>
              requestTransfer.mutate(
                { ids: chosenIds },
                {
                  onSuccess: ask(
                    t("operations:bulk.confirmTransfer", { count }),
                    t("operations:done.markedTransfer", { count }),
                  ),
                },
              )
            }
            onDelete={() =>
              requestDelete.mutate(
                { ids: chosenIds },
                {
                  onSuccess: ask(
                    t("operations:bulk.confirmDelete", { count }),
                    t("operations:done.deletedMany", { count }),
                  ),
                },
              )
            }
            onClear={clearSelection}
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
            regular={regular}
            page={search.page ?? 1}
            pageSize={PAGE_SIZE}
            onPage={(page) => setSearch({ page })}
            onOpen={(id) => setSearch({ op: OperationsSearch.shape.op.parse(id) })}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
          />
        )}
        {!failed && loaded && !empty && isPhone && (
          <OperationsCards
            items={items}
            total={total}
            accounts={accountItems}
            regular={regular}
            hasMore={moreQuery.hasNextPage}
            loadingMore={moreQuery.isFetchingNextPage}
            onMore={() => void moreQuery.fetchNextPage()}
            onOpen={(id) => setSearch({ op: OperationsSearch.shape.op.parse(id) })}
            selected={selected}
            onToggle={toggle}
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
            onDelete={(transaction) =>
              requestDelete.mutate(
                { ids: [transaction.id] },
                {
                  onSuccess: ask(
                    t("common:decision.yes"),
                    t("operations:done.deleted", { name: titleOf(transaction) }),
                  ),
                },
              )
            }
            onCategory={(transaction, category) =>
              update.mutate(
                {
                  id: transaction.id,
                  expectedVersion: transaction.version,
                  patch: { category },
                },
                {
                  onSuccess: (updated) => {
                    void done(t("operations:done.updated", { name: titleOf(updated.transaction) }))(
                      updated,
                    );
                    afterUpdate(updated);
                  },
                },
              )
            }
            onWhyRate={(transaction) => explainRate.mutate({ id: transaction.id })}
          />
        )}
      </Sheet>

      {pickCategory && (
        <BulkCategoryDialog
          count={count}
          kind={
            chosen.length > 0 && chosen.every((item) => item.type === "income")
              ? "income"
              : "expense"
          }
          pending={requestCategory.isPending}
          onClose={() => setPickCategory(false)}
          onNext={(category) =>
            requestCategory.mutate(
              { ids: chosenIds, category },
              {
                onSuccess: (result) => {
                  setPickCategory(false);
                  ask(
                    t("operations:bulk.confirmCategory", { count }),
                    t("operations:done.categoryChanged", { count }),
                  )(result);
                },
              },
            )
          }
        />
      )}
      {question !== null && (
        <DecisionDialog
          decisionId={question.id}
          opened
          {...(question.confirmLabel === undefined ? {} : { confirmLabel: question.confirmLabel })}
          onClose={() => setQuestion(null)}
          onAnswered={(status, undoToken) => {
            if (status === "yes") {
              setSearch({ op: undefined });
              clearSelection();
              if (undoToken !== null) setToast({ token: undoToken, message: question.done });
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
