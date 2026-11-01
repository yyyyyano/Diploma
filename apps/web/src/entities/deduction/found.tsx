// Найденные вычеты (TAX-20, DASH-02, NOTIF-02): карточка экрана «Налоговые вычеты» и янтарная карточка главной — общие действия
// («Это не моё», «Оформлено», «Вернуть» — сразу, с «Отменить»), один вопрос об учёте нуждающихся (ответ — факт профиля) и отметка
// «показан». Суммы «до» посчитал калькулятор налогов (T-045) и пришли с traceId — сайт ничего не считает (P1).
import { TransactionId, type FoundDeduction } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import type { TraceId } from "@kosht/kernel";
import { Button } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  CircleHelp,
  Eye,
  GraduationCap,
  Home,
  Sparkles,
  Undo2,
  Baby,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { LawRefChip, Money, StatusBadge, WhyButton, type StatusTone } from "../../ui/index.ts";
import { UndoActionToast } from "../action/index.ts";
import { Checklist } from "../checklist/index.ts";
import { ExplanationSheet } from "../explanation/index.ts";
import classes from "./found.module.css";
import { useDeductionTexts } from "./DeductionResultView.tsx";

const KIND_ICON = { education: GraduationCap, housing: Home, children: Baby } as const;
const CHECKLIST = {
  education: "deduction-education",
  housing: "deduction-housing",
  children: "deduction-standard",
} as const;
const NORM_URL = "https://pravo.by/document/?guid=3871&p0=Hk0900071";

/** Состояние находки словами: «Нужно уточнить» — жильё с вопросом об учёте. */
function statusOf(item: FoundDeduction): {
  key: "new" | "shown" | "filed" | "dismissed" | "ask";
  tone: StatusTone;
  icon: typeof Sparkles;
} {
  if (item.status === "dismissed") return { key: "dismissed", tone: "neutral", icon: Undo2 };
  if (item.status === "filed") return { key: "filed", tone: "ok", icon: CheckCircle2 };
  if (item.reason === "ask-queue") return { key: "ask", tone: "warn", icon: CircleHelp };
  if (item.status === "new") return { key: "new", tone: "amber", icon: Sparkles };
  return { key: "shown", tone: "neutral", icon: Eye };
}

/** Действия над находкой: меняют состояние сразу и показывают «Отменить». `toast` — рисует страница. */
export function useFoundChange(): {
  change: (id: FoundDeduction["id"], status: "dismissed" | "filed" | "shown") => void;
  pending: boolean;
  failed: boolean;
  toast: ReactNode;
} {
  useDeductionTexts();
  const { t } = useTranslation("deductions");
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ token: string; message: string } | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.tax.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.dashboard.key() }),
    ]);
  const mutation = useMutation(
    orpc.tax.setFoundStatus.mutationOptions({
      onSuccess: async (data, input) => {
        setToast({ token: data.undoToken, message: t(`found.toast.${input.status}`) });
        await refresh();
      },
    }),
  );
  return {
    change: (id, status) => mutation.mutate({ id, status }),
    pending: mutation.isPending,
    failed: mutation.isError,
    toast: toast !== null && (
      <UndoActionToast
        token={toast.token as never}
        message={toast.message}
        opened
        onClose={() => setToast(null)}
        onResult={() => void refresh()}
      />
    ),
  };
}

/** «Новый» → «показан», когда человек увидел находку (экран вычетов, главная). */
export function useMarkShown(items: readonly FoundDeduction[]): void {
  const queryClient = useQueryClient();
  const mutation = useMutation(
    orpc.tax.markFoundShown.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.tax.key() }),
    }),
  );
  const fresh = items.filter((item) => item.status === "new").map((item) => item.id);
  const key = fresh.join(",");
  // Только по составу новых находок: ошибка отметки не должна зациклить запросы (`mutate` у TanStack Query стабилен).
  const { mutate } = mutation;
  useEffect(() => {
    if (key !== "") mutate({ ids: key.split(",") as never });
  }, [key, mutate]);
}

/** Один вопрос об учёте нуждающихся (AGT-06): ответ — факт профиля, повторно не спрашивается. */
function QueueQuestion() {
  const { t } = useTranslation("deductions");
  const queryClient = useQueryClient();
  const answer = useMutation(
    orpc.profile.setFact.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.tax.key() }),
    }),
  );
  const send = (status: "now" | "no") =>
    answer.mutate({ value: { key: "housingQueue", status, since: null } });
  return (
    <div className={classes.question}>
      <p className={classes.questionTitle}>{t("found.question.title")}</p>
      <div className={classes.buttons}>
        <Button variant="default" loading={answer.isPending} onClick={() => send("now")}>
          {t("found.question.yes")}
        </Button>
        <Button variant="default" loading={answer.isPending} onClick={() => send("no")}>
          {t("found.question.no")}
        </Button>
      </div>
      {answer.isError && (
        <p className={classes.error} role="alert">
          {t("found.question.error")}
        </p>
      )}
    </div>
  );
}

/** Основание находки словами и суммой: «Вы оплатили обучение: БГУ, 12.09.2026, на сумму 2 000,00 BYN». */
function Lead({ item }: { readonly item: FoundDeduction }) {
  const { t } = useTranslation("deductions");
  const payee = item.payee ?? t("found.lead.loanPayee");
  if (item.kind === "education") {
    const date = item.operation === null ? "" : formatDate(item.operation.on);
    return (
      <p className={classes.lead}>
        {item.payee === null
          ? t("found.lead.educationNoPayee", { date })
          : t("found.lead.education", { payee: item.payee, date })}{" "}
        {item.operation !== null && <Money value={item.operation.amount} tabular />}
      </p>
    );
  }
  if (item.kind === "children") {
    return (
      <p className={classes.lead}>
        {t("found.lead.children")} {item.amount !== null && <Money value={item.amount.amount} />}{" "}
        {t("found.amount.perMonth")}.
      </p>
    );
  }
  return (
    <p className={classes.lead}>
      {t(item.reason === "ask-queue" ? "found.lead.housingAsk" : "found.lead.housingCheck", {
        payee,
      })}
    </p>
  );
}

function Amount({
  item,
  onWhy,
}: {
  readonly item: FoundDeduction;
  readonly onWhy: (traceId: TraceId) => void;
}) {
  const { t } = useTranslation("deductions");
  if (item.amount === null) return null;
  const { amount, traceId } = item.amount;
  return (
    <p className={classes.amount}>
      <span className={classes.amountLabel}>
        {item.kind === "children" ? t("found.amount.perMonth") : t("found.amount.upTo")}
      </span>
      <Money value={amount} size="kpi" />
      <WhyButton
        subject={t("found.why", { subject: t(`found.kind.${item.kind}`) })}
        onClick={() => onWhy(traceId)}
      />
    </p>
  );
}

/** Карточка находки на экране «Налоговые вычеты». */
export function FoundCard({
  item,
  onChange,
  busy,
}: {
  readonly item: FoundDeduction;
  readonly onChange: (status: "dismissed" | "filed" | "shown") => void;
  readonly busy: boolean;
}) {
  useDeductionTexts();
  const { t } = useTranslation("deductions");
  const [open, setOpen] = useState(false);
  const [traceId, setTraceId] = useState<TraceId | null>(null);
  const status = statusOf(item);
  const Icon = KIND_ICON[item.kind];
  const inactive = item.status === "dismissed" || item.status === "filed";
  return (
    <article className={classes.card} aria-labelledby={`found-${item.id}`}>
      <header className={classes.head}>
        <span className={classes.icon}>
          <Icon size={22} strokeWidth={1.8} aria-hidden />
        </span>
        <div className={classes.headText}>
          <h3 className={classes.title} id={`found-${item.id}`}>
            {t(`found.kind.${item.kind}`)}
          </h3>
          <p className={classes.meta}>
            <StatusBadge tone={status.tone} icon={status.icon}>
              {t(`found.status.${status.key}`)}
            </StatusBadge>
            <LawRefChip label={t(`found.norm.${item.kind}`)} href={NORM_URL} external />
          </p>
        </div>
        <Amount item={item} onWhy={setTraceId} />
      </header>
      <Lead item={item} />
      {item.operation !== null && (
        <p className={classes.basis}>
          <Link to="/operations" search={{ op: TransactionId.parse(item.operation.id) }}>
            {t("found.actions.openOperation")}
          </Link>
        </p>
      )}
      {item.reason === "ask-queue" && item.status !== "dismissed" && <QueueQuestion />}
      <div className={classes.buttons}>
        {item.status === "dismissed" ? (
          <Button variant="default" loading={busy} onClick={() => onChange("shown")}>
            {t("found.actions.restore")}
          </Button>
        ) : (
          <>
            {item.reason !== "ask-queue" && (
              <Button variant="default" onClick={() => setOpen(!open)} aria-expanded={open}>
                {open ? t("found.actions.hide") : t("found.actions.how")}
              </Button>
            )}
            {!inactive && item.reason !== "ask-queue" && (
              <Button loading={busy} onClick={() => onChange("filed")}>
                {t("found.actions.filed")}
              </Button>
            )}
            {item.status !== "filed" && (
              <Button variant="subtle" loading={busy} onClick={() => onChange("dismissed")}>
                {t("found.actions.notMine")}
              </Button>
            )}
            {item.status === "filed" && (
              <Button variant="subtle" loading={busy} onClick={() => onChange("shown")}>
                {t("found.actions.restore")}
              </Button>
            )}
          </>
        )}
      </div>
      {open && <Checklist id={CHECKLIST[item.kind]} subject={{ kind: "deduction", id: item.id }} />}
      {traceId !== null && (
        <ExplanationSheet traceId={traceId} opened onClose={() => setTraceId(null)} />
      )}
    </article>
  );
}

/** Янтарная карточка главной (DASH-02): первая находка и «Ещё: …»; «Это не моё» — с «Отменить». */
export function FoundBanner({ items }: { readonly items: readonly FoundDeduction[] }) {
  useDeductionTexts();
  const { t } = useTranslation("deductions");
  const { change, pending, failed, toast } = useFoundChange();
  const [traceId, setTraceId] = useState<TraceId | null>(null);
  useMarkShown(items);
  const [first, ...rest] = items;
  if (first === undefined) return null;
  return (
    <section className={classes.banner} aria-labelledby="home-found-title">
      <p className={classes.bannerKicker}>{t("found.banner.title")}</p>
      <h2 className={classes.bannerTitle} id="home-found-title">
        {t(`found.kind.${first.kind}`)}
      </h2>
      <Lead item={first} />
      {first.amount !== null && first.kind !== "children" && (
        <Amount item={first} onWhy={setTraceId} />
      )}
      {rest.length > 0 && (
        <p className={classes.more}>
          {t("found.banner.more", {
            items: rest.map((item) => t(`found.kind.${item.kind}`)).join(", "),
          })}
        </p>
      )}
      <div className={classes.buttons}>
        <Button component={Link} to="/deductions">
          {t("found.actions.how")}
        </Button>
        <Button variant="subtle" loading={pending} onClick={() => change(first.id, "dismissed")}>
          {t("found.actions.notMine")}
        </Button>
      </div>
      {failed && (
        <p className={classes.error} role="alert">
          {t("found.changeError")}
        </p>
      )}
      {toast}
      {traceId !== null && (
        <ExplanationSheet traceId={traceId} opened onClose={() => setTraceId(null)} />
      )}
    </section>
  );
}
