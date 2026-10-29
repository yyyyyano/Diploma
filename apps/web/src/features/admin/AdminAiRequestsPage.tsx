// «Запросы к ИИ» (ADM-20, ADM-21, ADM-22, OBS-05; Admin.dc.html — Admin--ai-requests): основные цифры журнала расхода
// за период — запросы, токены, условная стоимость, медиана ответа, доля ошибок; по задачам и провайдерам; облако и
// локально; расход дневных лимитов бесплатных тарифов; прайс-лист; ссылка на Langfuse. Цифры считает сервер, сайт их
// только записывает (ai-format.ts). Текстов запросов и ответов нет и не будет: они — в Langfuse.
import type { AiPeriod, AiUsage } from "@kosht/contract";
import { Anchor, Button, Modal, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, Lock, Pencil } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { SkeletonCard, StatCard } from "../../ui/index.ts";
import {
  dollarsToMicros,
  formatCostMicros,
  formatMs,
  formatPermille,
  formatTokens,
  groupDigits,
  microsToDollars,
  type AiUnits,
} from "./ai-format.ts";
import { useProviderName } from "./provider-name.ts";
import classes from "./Admin.module.css";

const PERIODS: readonly AiPeriod[] = ["day", "week", "month"];

export function AdminAiRequestsPage({ period }: { readonly period: AiPeriod }) {
  const { t } = useTranslation("admin");
  const usage = useQuery(orpc.admin.aiUsage.queryOptions({ input: { period } }));
  const [pricing, setPricing] = useState(false);
  if (usage.isPending) return <SkeletonCard />;
  if (usage.isError) {
    return (
      <p className={classes.error} role="alert">
        <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
        {t("ai.requests.error")}
      </p>
    );
  }
  const data = usage.data;
  return (
    <>
      <div className={classes.toolbar}>
        <nav className={classes.segments} aria-label={t("ai.requests.period")}>
          {PERIODS.map((item) => (
            <Link
              key={item}
              to="/admin/ai-requests"
              search={{ period: item }}
              className={classes.segment}
              {...(item === period ? { "aria-current": "page" as const } : {})}
            >
              {t(`ai.requests.periods.${item}`)}
            </Link>
          ))}
        </nav>
        <Button
          variant="default"
          leftSection={<Pencil size={16} strokeWidth={1.8} aria-hidden />}
          onClick={() => setPricing(true)}
        >
          {t("ai.requests.priceList")}
        </Button>
      </div>
      <Tiles usage={data} />
      <div className={classes.grid}>
        <TasksCard usage={data} />
        <AnswersCard usage={data} />
      </div>
      <p className={classes.note}>
        <Lock size={18} strokeWidth={1.8} aria-hidden />
        {t("ai.requests.noTexts")}{" "}
        {data.langfuseUrl === null ? (
          t("ai.requests.noLangfuse")
        ) : (
          <Anchor href={data.langfuseUrl} target="_blank" rel="noreferrer">
            {t("ai.requests.langfuse")}
          </Anchor>
        )}
      </p>
      <PriceDialog
        usage={data}
        period={period}
        opened={pricing}
        onClose={() => setPricing(false)}
      />
    </>
  );
}

function useUnits(): AiUnits {
  const { t } = useTranslation("admin");
  return {
    million: t("ai.units.million"),
    thousand: t("ai.units.thousand"),
    second: t("ai.units.second"),
    millisecond: t("ai.units.millisecond"),
  };
}

function Tiles({ usage }: { readonly usage: AiUsage }) {
  const { t } = useTranslation("admin");
  const units = useUnits();
  const { totals } = usage;
  return (
    <div className={classes.tiles}>
      <StatCard title={t("ai.requests.requests")} value={groupDigits(totals.requests)} />
      <StatCard title={t("ai.requests.tokens")} value={formatTokens(totals.tokens, units)} />
      <StatCard
        title={t("ai.requests.cost")}
        value={formatCostMicros(totals.costMicros)}
        hint={t("ai.requests.costHint")}
      />
      <StatCard title={t("ai.requests.median")} value={formatMs(totals.medianMs, units)} />
      <StatCard
        title={t("ai.requests.errors")}
        value={formatPermille(totals.errorPermille)}
        hint={t("ai.requests.errorsHint", { count: totals.errors, total: totals.requests })}
      />
    </div>
  );
}

function TasksCard({ usage }: { readonly usage: AiUsage }) {
  const { t } = useTranslation("admin");
  const most = Math.max(1, ...usage.byTask.map((row) => row.requests));
  return (
    <section className={classes.card} aria-labelledby="admin-by-task">
      <h2 id="admin-by-task" className={classes.cardTitle}>
        {t("ai.requests.byTask")}
      </h2>
      {usage.byTask.length === 0 ? (
        <p className={classes.hint}>{t("ai.requests.nobody")}</p>
      ) : (
        <ul className={classes.bars}>
          {usage.byTask.map((row) => {
            const title = t(`ai.tasks.${row.task}.title`, { defaultValue: row.task });
            return (
              <li key={row.task} className={classes.barRow}>
                <span>{title}</span>
                <span className={classes.mono}>{groupDigits(row.requests)}</span>
                <progress
                  className={classes.bar}
                  value={row.requests}
                  max={most}
                  aria-label={t("ai.requests.byTaskRow", { task: title, count: row.requests })}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function AnswersCard({ usage }: { readonly usage: AiUsage }) {
  const { t } = useTranslation("admin");
  const units = useUnits();
  const total = usage.cloudRequests + usage.localRequests;
  // Доли — для подписи; строки провайдеров и лимитов приходят с сервера готовыми числами.
  const cloudPercent = total === 0 ? 0 : Math.round((usage.cloudRequests * 100) / total);
  const name = useProviderName();
  return (
    <section className={classes.card} aria-labelledby="admin-answers">
      <h2 id="admin-answers" className={classes.cardTitle}>
        {t("ai.requests.whoAnswered")}
      </h2>
      {total === 0 ? (
        <p className={classes.hint}>{t("ai.requests.nobody")}</p>
      ) : (
        <>
          <ul className={classes.bars}>
            {usage.byProvider.map((row) => (
              <li key={row.provider} className={classes.barRow}>
                <span>{name(row.provider)}</span>
                <span className={classes.mono}>{groupDigits(row.requests)}</span>
                <progress
                  className={classes.bar}
                  value={row.requests}
                  max={Math.max(1, total)}
                  aria-label={`${name(row.provider)}: ${String(row.requests)}`}
                />
              </li>
            ))}
          </ul>
          <p className={classes.hint}>
            {t("ai.requests.cloudShare", { percent: cloudPercent, local: 100 - cloudPercent })}{" "}
            {t("ai.requests.cloudShareHint")}
          </p>
        </>
      )}
      <h3 className={classes.subTitle}>{t("ai.requests.limits")}</h3>
      <ul className={classes.bars}>
        {usage.dailyLimits.map((row) => (
          <li key={row.id} className={classes.limitGroup}>
            {(
              [
                ["limitRequests", row.requests, (value: number) => groupDigits(value)],
                ["limitTokens", row.tokens, (value: number) => formatTokens(value, units)],
              ] as const
            ).map(([key, used, format]) => (
              <div key={key} className={classes.barRow}>
                <span>
                  {t(`ai.requests.${key}`, {
                    provider: `${name(row.provider)} · ${row.id.slice(row.provider.length + 1)}`,
                  })}
                </span>
                <span className={classes.mono}>
                  {used.limit === null
                    ? t("ai.requests.limitUnknown", { used: format(used.used) })
                    : t("ai.requests.limitUsed", {
                        used: format(used.used),
                        limit: format(used.limit),
                      })}
                </span>
                {used.limit !== null && (
                  <progress
                    className={classes.bar}
                    value={Math.min(used.used, used.limit)}
                    max={used.limit}
                    aria-label={t(`ai.requests.${key}`, { provider: row.id })}
                  />
                )}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PriceDialog(props: {
  readonly usage: AiUsage;
  readonly period: AiPeriod;
  readonly opened: boolean;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation(["admin", "errors"]);
  const queryClient = useQueryClient();
  const providerName = useProviderName();
  const [drafts, setDrafts] = useState<Record<string, { input: string; output: string }>>({});
  const [done, setDone] = useState<string | undefined>();
  const save = useMutation(
    orpc.admin.setAiPrice.mutationOptions({
      onSuccess: (next, input) => {
        queryClient.setQueryData(
          orpc.admin.aiUsage.queryKey({ input: { period: next.period } }),
          next,
        );
        setDrafts((current) => {
          const { [input.id]: _saved, ...rest } = current;
          return rest;
        });
        setDone(input.id);
      },
    }),
  );
  const failure =
    save.error === null
      ? undefined
      : t(`errors:${errorCodeOf(save.error)}`, errorParamsOf(save.error));
  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title={t("admin:ai.requests.priceDialog.title")}
      centered
      size={680}
      radius="lg"
      closeButtonProps={{ "aria-label": t("admin:ai.requests.priceDialog.close") }}
    >
      <div className={classes.modelForm}>
        <p className={classes.hint}>{t("admin:ai.requests.priceDialog.hint")}</p>
        {props.usage.prices.map((price) => {
          const draft = drafts[price.id] ?? {
            input: microsToDollars(price.inputMicrosPerMillion),
            output: microsToDollars(price.outputMicrosPerMillion),
          };
          const input = dollarsToMicros(draft.input);
          const output = dollarsToMicros(draft.output);
          const name = `${providerName(price.provider)} · ${price.model}`;
          return (
            <form
              key={price.id}
              noValidate
              className={classes.priceInputs}
              onSubmit={(event) => {
                event.preventDefault();
                if (input !== undefined && output !== undefined) {
                  save.mutate({
                    id: price.id,
                    inputMicrosPerMillion: input,
                    outputMicrosPerMillion: output,
                  });
                }
              }}
            >
              <strong>{name}</strong>
              <TextInput
                aria-label={t("admin:ai.requests.priceDialog.inputLabel", { model: name })}
                inputMode="decimal"
                error={input === undefined ? " " : undefined}
                value={draft.input}
                onChange={(event) =>
                  setDrafts({
                    ...drafts,
                    [price.id]: { ...draft, input: event.currentTarget.value },
                  })
                }
              />
              <TextInput
                aria-label={t("admin:ai.requests.priceDialog.outputLabel", { model: name })}
                inputMode="decimal"
                error={output === undefined ? " " : undefined}
                value={draft.output}
                onChange={(event) =>
                  setDrafts({
                    ...drafts,
                    [price.id]: { ...draft, output: event.currentTarget.value },
                  })
                }
              />
              <Button
                type="submit"
                variant="default"
                disabled={input === undefined || output === undefined}
                loading={save.isPending && save.variables.id === price.id}
              >
                {t("admin:ai.requests.priceDialog.save")}
              </Button>
            </form>
          );
        })}
        {done !== undefined && !save.isError && (
          <output className={classes.ok}>
            <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
            {t("admin:ai.requests.priceDialog.saved", { model: done })}
          </output>
        )}
        {failure !== undefined && (
          <p className={classes.error} role="alert">
            <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
            {failure}
          </p>
        )}
      </div>
    </Modal>
  );
}
