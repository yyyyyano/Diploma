// «Что ассистент знает обо мне» (design/screens/Memory.dc.html, PROF-03, PROF-05): факты по темам с источником, датой и
// статусом; подтвердить предположение, исправить, удалить — сразу и с «Отменить» (P5); добавить свой факт; ключи PROF-01
// без значения — «Не указано · Указать». Четыре состояния (DES-16). Возраст детей и «младше 18» — оценка сервера на
// сегодня (PROF-06); счётчики фактов — это подсчёт строк списка, денег страница не считает.
import type { FactKey, FactTopic, FactValueInput, ProfileFact } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import { Button, Modal } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  BookUser,
  Check,
  CircleCheck,
  CircleDashed,
  Download,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UndoActionToast } from "../../entities/action/index.ts";
import {
  FactEditor,
  factLabel,
  FactValueText,
  keyLabel,
} from "../../entities/profile-fact/index.ts";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf } from "../../lib/errors.ts";
import { EmptyState, PageHeader, SkeletonCard, StatusBadge } from "../../ui/index.ts";
import classes from "./MemoryPage.module.css";

/** Темы в порядке макета и ключи PROF-01, которые в теме могут быть «не указаны». */
const GROUPS: readonly { topic: FactTopic; keys: readonly FactKey[] }[] = [
  { topic: "family", keys: ["children", "familyStatus", "largeFamily"] },
  { topic: "income", keys: ["income.salary", "income.regular"] },
  { topic: "employment", keys: ["employment", "mainEmployer"] },
  { topic: "obligations", keys: ["obligations.regular"] },
  { topic: "housing", keys: ["housingQueue", "property.apartment"] },
  { topic: "property", keys: ["property.car", "property.land"] },
  { topic: "benefits", keys: ["benefitCategory", "youngSpecialist"] },
  { topic: "other", keys: [] },
];

const KNOWN_KEYS = GROUPS.flatMap((group) => group.keys);

type Editing = { readonly key: FactKey; readonly fact?: ProfileFact };
type Toast = { readonly token: string; readonly message: string };

export function MemoryPage() {
  const { t } = useTranslation("profile");
  const { t: tUi } = useTranslation("ui");
  const queryClient = useQueryClient();
  const facts = useQuery(orpc.profile.facts.queryOptions());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [later, setLater] = useState<readonly string[]>([]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.profile.key() });

  const save = useMutation(
    orpc.profile.setFact.mutationOptions({
      onSuccess: async ({ fact, undoToken }) => {
        setEditing(null);
        setToast({ token: undoToken, message: t("memory.saved", { label: factLabel(t, fact) }) });
        await refresh();
      },
    }),
  );
  const confirm = useMutation(
    orpc.profile.confirmFact.mutationOptions({
      onSuccess: async ({ fact, undoToken }) => {
        setToast({
          token: undoToken,
          message: t("memory.confirmedToast", { label: factLabel(t, fact) }),
        });
        await refresh();
      },
    }),
  );
  const remove = useMutation(
    orpc.profile.deleteFact.mutationOptions({
      onSuccess: async ({ undoToken }, { id }) => {
        const fact = facts.data?.facts.find((item) => item.id === id);
        setToast({
          token: undoToken,
          message: t("memory.removed", { label: fact === undefined ? "" : factLabel(t, fact) }),
        });
        await refresh();
      },
    }),
  );

  const list = facts.data?.facts;
  const assumed = list?.filter((fact) => fact.status === "assumed") ?? [];
  const toCheck = assumed.filter((fact) => !later.includes(fact.id));
  const missing = KNOWN_KEYS.filter((key) => !list?.some((fact) => fact.value.key === key));
  const failed = save.isError || confirm.isError || remove.isError;

  return (
    <>
      <PageHeader
        title={t("memory.title")}
        subtitle={t("memory.subtitle")}
        actions={
          <Button
            leftSection={<Plus size={18} aria-hidden />}
            onClick={() => setEditing({ key: "note" })}
          >
            {t("memory.add")}
          </Button>
        }
      />
      <div className={classes.body}>
        {facts.isPending && (
          <div className={classes.columns}>
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}
        {facts.isError && (
          <EmptyState
            tone="error"
            icon={AlertTriangle}
            title={t("memory.error.title")}
            description={t("memory.error.text")}
            actions={
              <Button onClick={() => void facts.refetch()}>{t("memory.error.retry")}</Button>
            }
          />
        )}
        {list !== undefined && (
          <>
            <div className={classes.top}>
              <section className={classes.card} aria-labelledby="memory-intro">
                <div className={classes.introHead}>
                  <span className={classes.introIcon}>
                    <BookUser size={22} strokeWidth={1.8} aria-hidden />
                  </span>
                  <div>
                    <h2 id="memory-intro" className={classes.cardTitle}>
                      {t("memory.introTitle")}
                    </h2>
                    <p className={classes.muted}>{t("memory.introText")}</p>
                  </div>
                </div>
                <ul className={classes.counts} aria-label={t("memory.counts")}>
                  <li className={classes.count}>
                    <CircleCheck size={16} aria-hidden />
                    {t("memory.confirmed", { count: list.length - assumed.length })}
                  </li>
                  <li className={classes.count}>
                    <CircleDashed size={16} aria-hidden />
                    {t("memory.assumed", { count: assumed.length })}
                  </li>
                  <li className={classes.count}>
                    <CircleDashed size={16} aria-hidden />
                    {t("memory.missing", { count: missing.length })}
                  </li>
                </ul>
              </section>
              <section className={classes.card} aria-labelledby="memory-storage">
                <h2 id="memory-storage" className={classes.smallTitle}>
                  <ShieldCheck size={18} strokeWidth={1.8} aria-hidden />
                  {t("memory.storageTitle")}
                </h2>
                <p className={classes.muted}>{t("memory.storageText")}</p>
                <Link to="/settings" search={{ tab: "my-data" }} className={classes.link}>
                  <Download size={16} aria-hidden />
                  {t("memory.download")}
                </Link>
              </section>
            </div>

            {list.length === 0 && (
              <EmptyState
                icon={BookUser}
                title={t("memory.empty.title")}
                description={t("memory.empty.text")}
                actions={
                  <Button onClick={() => setEditing({ key: "note" })}>{t("memory.add")}</Button>
                }
              />
            )}

            {assumed.length > 0 && (
              <section className={classes.check} aria-labelledby="memory-check">
                {toCheck[0] === undefined ? (
                  <>
                    <h2 id="memory-check" className={classes.cardTitle}>
                      {t("memory.checkedTitle")}
                    </h2>
                    <p className={classes.muted}>{t("memory.checkedText")}</p>
                  </>
                ) : (
                  <AssumptionCheck
                    fact={toCheck[0]}
                    left={toCheck.length - 1}
                    pending={confirm.isPending}
                    onYes={(fact) => confirm.mutate({ id: fact.id })}
                    onFix={(fact) => setEditing({ key: fact.value.key, fact })}
                    onLater={(fact) => setLater((ids) => [...ids, fact.id])}
                  />
                )}
              </section>
            )}

            {failed && (
              <p className={classes.error} role="alert">
                <AlertTriangle size={18} aria-hidden />
                {t("memory.saveError")}
              </p>
            )}
            {notice !== null && <output className={classes.muted}>{notice}</output>}

            <div className={classes.columns}>
              {GROUPS.map((group) => {
                const own = list.filter((fact) => fact.topic === group.topic);
                const empty = group.keys.filter((key) => missing.includes(key));
                if (own.length === 0 && empty.length === 0) return null;
                const titleId = `memory-topic-${group.topic}`;
                return (
                  <section key={group.topic} className={classes.card} aria-labelledby={titleId}>
                    <div className={classes.groupHead}>
                      <h2 id={titleId} className={classes.cardTitle}>
                        {t(`topics.${group.topic}`)}
                      </h2>
                      <span className={classes.muted}>
                        {t("memory.factsCount", { count: own.length + empty.length })}
                      </span>
                    </div>
                    <ul className={classes.facts}>
                      {own.map((fact) => (
                        <FactRow
                          key={fact.id}
                          fact={fact}
                          onConfirm={() => confirm.mutate({ id: fact.id })}
                          onEdit={() => setEditing({ key: fact.value.key, fact })}
                          onRemove={() => remove.mutate({ id: fact.id })}
                        />
                      ))}
                      {empty.map((key) => (
                        <li key={key} className={classes.fact}>
                          <div className={classes.factMain}>
                            <p className={classes.factLabel}>{keyLabel(t, key)}</p>
                            <p className={classes.factValue}>
                              {t("memory.notSpecified")}{" "}
                              <span className={classes.muted}>{t("memory.askLater")}</span>
                            </p>
                          </div>
                          <Button
                            variant="default"
                            size="sm"
                            leftSection={<Plus size={16} aria-hidden />}
                            aria-label={t("memory.specifyLabel", { label: keyLabel(t, key) })}
                            onClick={() => setEditing({ key })}
                          >
                            {t("memory.specify")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>

            <section aria-labelledby="memory-help">
              <div className={classes.groupHead}>
                <h2 id="memory-help" className={classes.sectionTitle}>
                  {t("memory.helpTitle")}
                </h2>
                <span className={classes.muted}>{t("memory.helpLead")}</span>
              </div>
              <ul className={classes.help}>
                {(["deductions", "calendar", "afford", "free"] as const).map((item) => (
                  <li key={item} className={classes.card}>
                    <h3 className={classes.smallTitle}>{t(`memory.help.${item}.title`)}</h3>
                    <p className={classes.muted}>{t(`memory.help.${item}.text`)}</p>
                  </li>
                ))}
              </ul>
            </section>
            <p className={classes.footer}>
              <Download size={16} aria-hidden />
              {t("memory.footer")}{" "}
              <Link to="/settings" search={{ tab: "my-data" }} className={classes.link}>
                {t("memory.download")}
              </Link>{" "}
              {t("memory.footerTail")}
            </p>
          </>
        )}
      </div>

      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        closeButtonProps={{ "aria-label": tUi("sheet.close") }}
        title={
          editing === null || editing.key === "note"
            ? t("memory.addTitle")
            : t("memory.editTitle", { label: keyLabel(t, editing.key) })
        }
      >
        {editing !== null && (
          <>
            {editing.key === "note" && editing.fact === undefined && (
              <p className={classes.muted}>{t("memory.addHint")}</p>
            )}
            <FactEditor
              factKey={editing.key}
              {...(editing.fact === undefined ? {} : { fact: editing.fact })}
              pending={save.isPending}
              onCancel={() => setEditing(null)}
              onSubmit={(value: FactValueInput) =>
                save.mutate({
                  ...(editing.fact?.value.key === "note" ? { id: editing.fact.id } : {}),
                  value,
                })
              }
            />
          </>
        )}
      </Modal>

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
                : t("memory.undoConflict"),
            );
            void refresh();
          }}
        />
      )}
    </>
  );
}

function AssumptionCheck({
  fact,
  left,
  pending,
  onYes,
  onFix,
  onLater,
}: {
  readonly fact: ProfileFact;
  readonly left: number;
  readonly pending: boolean;
  readonly onYes: (fact: ProfileFact) => void;
  readonly onFix: (fact: ProfileFact) => void;
  readonly onLater: (fact: ProfileFact) => void;
}) {
  const { t } = useTranslation("profile");
  return (
    <div className={classes.checkBody}>
      <span className={classes.checkIcon}>
        <Sparkles size={20} strokeWidth={1.8} aria-hidden />
      </span>
      <div className={classes.checkText}>
        <p className={classes.eyebrow}>
          <span id="memory-check">{t("memory.checkLabel")}</span>
          {left > 0 && (
            <span className={classes.muted}> {t("memory.checkLeft", { count: left })}</span>
          )}
        </p>
        <p className={classes.checkQuestion}>
          {t("memory.checkPrefix", { label: factLabel(t, fact) })} <FactValueText fact={fact} />
        </p>
        <p className={classes.muted}>{t("memory.checkWhy")}</p>
        <div className={classes.actions}>
          <Button
            size="sm"
            leftSection={<Check size={16} aria-hidden />}
            loading={pending}
            onClick={() => onYes(fact)}
          >
            {t("memory.checkYes")}
          </Button>
          <Button
            size="sm"
            variant="default"
            leftSection={<Pencil size={16} aria-hidden />}
            onClick={() => onFix(fact)}
          >
            {t("memory.checkFix")}
          </Button>
          <Button size="sm" variant="subtle" onClick={() => onLater(fact)}>
            {t("memory.checkLater")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FactRow({
  fact,
  onConfirm,
  onEdit,
  onRemove,
}: {
  readonly fact: ProfileFact;
  readonly onConfirm: () => void;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}) {
  const { t } = useTranslation("profile");
  const label = factLabel(t, fact);
  return (
    <li className={classes.fact}>
      <div className={classes.factMain}>
        <p className={classes.factLabel}>{label}</p>
        <p className={classes.factValue}>
          <FactValueText fact={fact} />
        </p>
        <div className={classes.meta}>
          {fact.status === "confirmed" ? (
            <StatusBadge tone="ok" icon={CircleCheck}>
              {t("status.confirmed")}
            </StatusBadge>
          ) : (
            <StatusBadge tone="neutral" icon={CircleDashed}>
              {t("status.assumed")}
            </StatusBadge>
          )}
          <span className={classes.source}>{t(`source.${fact.source}`)}</span>
          <span className={classes.muted}>{formatDate(fact.recordedOn)}</span>
        </div>
      </div>
      <div className={classes.rowActions}>
        {fact.status === "assumed" && (
          <Button
            variant="default"
            size="sm"
            leftSection={<Check size={16} aria-hidden />}
            aria-label={t("memory.confirmLabel", { label })}
            onClick={onConfirm}
          >
            {t("memory.confirm")}
          </Button>
        )}
        <button
          type="button"
          className={classes.iconButton}
          aria-label={t("memory.edit", { label })}
          onClick={onEdit}
        >
          <Pencil size={18} aria-hidden />
        </button>
        <button
          type="button"
          className={classes.iconButton}
          aria-label={t("memory.remove", { label })}
          onClick={onRemove}
        >
          <Trash2 size={18} aria-hidden />
        </button>
      </div>
    </li>
  );
}
