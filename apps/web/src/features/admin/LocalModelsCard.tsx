// «Локальные модели» (ADM-50, NFR-25; Admin.dc.html — блок «Локальные модели» вкладки «Провайдеры ИИ»): модели каталога с
// размером, состоянием и полосой прогресса, «Скачать» (и докачать), «Проверить модели» (самотест, запасной режим на
// процессоре). Прогресс — опрос раз в 2 с, пока что-то скачивается: у системной задачи нет домохозяйства, потока
// событий для неё нет. Тексты ошибок — по машинному коду (без текстов с сервера).
import type { LocalModelsOverview, LocalModelState } from "@kosht/contract";
import { formatFileSize } from "@kosht/i18n";
import { Button } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Download, FlaskConical, MinusCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { SkeletonCard, StatusBadge, type StatusTone } from "../../ui/index.ts";
import classes from "./Admin.module.css";

const TONES: Readonly<Record<LocalModelState, StatusTone>> = {
  absent: "neutral",
  pending: "warn",
  downloading: "brand",
  verifying: "brand",
  ready: "ok",
  failed: "danger",
};

/** Опрос раз в 2 с, пока идёт скачивание (или ждёт очереди). */
const POLL_MS = 2000;
const POLLING: readonly LocalModelsOverview["state"][] = ["downloading"];

export function LocalModelsCard() {
  const { t } = useTranslation(["admin", "errors"]);
  const queryClient = useQueryClient();
  const key = orpc.admin.localModels.queryKey();
  const overview = useQuery(
    orpc.admin.localModels.queryOptions({
      refetchInterval: (query) =>
        query.state.data !== undefined && POLLING.includes(query.state.data.state)
          ? POLL_MS
          : false,
    }),
  );
  const store = (next: LocalModelsOverview) => queryClient.setQueryData(key, next);
  const download = useMutation(
    orpc.admin.downloadLocalModels.mutationOptions({ onSuccess: store }),
  );
  const selfTest = useMutation(
    orpc.admin.selfTestLocalModels.mutationOptions({ onSuccess: store }),
  );
  const failure = download.error ?? selfTest.error;

  if (overview.isPending) return <SkeletonCard />;
  if (overview.isError) {
    return (
      <p className={classes.error} role="alert">
        <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
        {t("admin:ai.local.error")}
      </p>
    );
  }
  const data = overview.data;
  const downloading = data.state === "downloading";
  return (
    <section className={classes.card} aria-labelledby="admin-local-models">
      <div>
        <h2 id="admin-local-models" className={classes.cardTitle}>
          {t("admin:ai.local.title")}
        </h2>
        <p className={classes.hint}>{t("admin:ai.local.hint")}</p>
      </div>
      <ul className={classes.bars}>
        {data.models.map((model) => (
          <li key={model.id} className={classes.localRow}>
            <div className={classes.cardHead}>
              <div className={classes.chainText}>
                <strong>
                  {t(`admin:ai.local.models.${model.id}.title`, { defaultValue: model.id })}
                </strong>
                <span className={classes.hint}>
                  {t(`admin:ai.local.models.${model.id}.note`, { defaultValue: "" })} ·{" "}
                  {t("admin:ai.local.sizeOf", {
                    done: formatFileSize(model.bytesDone),
                    total: formatFileSize(model.bytesTotal),
                  })}
                </span>
              </div>
              <StatusBadge
                tone={TONES[model.state]}
                icon={
                  model.state === "ready"
                    ? CheckCircle2
                    : model.state === "failed"
                      ? AlertCircle
                      : MinusCircle
                }
              >
                {t(`admin:ai.local.states.${model.state}`)}
              </StatusBadge>
            </div>
            {(model.state === "downloading" ||
              model.state === "verifying" ||
              model.state === "pending") && (
              <progress
                className={classes.bar}
                value={model.bytesDone}
                max={Math.max(1, model.bytesTotal)}
                aria-label={t(`admin:ai.local.models.${model.id}.title`, {
                  defaultValue: model.id,
                })}
              />
            )}
            {model.state === "failed" && model.errorCode !== null && (
              <output className={classes.hint}>
                {t(`admin:ai.local.errors.${model.errorCode}`, {
                  defaultValue: t("admin:ai.local.errors.UNKNOWN"),
                })}
              </output>
            )}
          </li>
        ))}
      </ul>
      <div className={classes.actions}>
        {data.state !== "ready" && (
          <Button
            leftSection={<Download size={16} strokeWidth={1.8} aria-hidden />}
            loading={download.isPending}
            disabled={downloading}
            onClick={() => download.mutate({})}
          >
            {data.state === "failed"
              ? t("admin:ai.local.retry")
              : data.bytesDone > 0
                ? t("admin:ai.local.resume")
                : t("admin:ai.local.download")}
          </Button>
        )}
        <Button
          variant="default"
          leftSection={<FlaskConical size={16} strokeWidth={1.8} aria-hidden />}
          loading={selfTest.isPending}
          onClick={() => selfTest.mutate({})}
        >
          {t("admin:ai.local.selfTest")}
        </Button>
      </div>
      <output className={classes.hint}>
        {data.selfTest.state === "failed"
          ? t("admin:ai.local.selfTestStates.failed", { problem: data.selfTest.problem ?? "" })
          : t(`admin:ai.local.selfTestStates.${data.selfTest.state}`)}
      </output>
      {data.selfTest.cpuFallback && (
        <p className={classes.note}>
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {t("admin:ai.local.cpuFallback")}
        </p>
      )}
      {download.isSuccess && downloading && (
        <output className={classes.ok}>
          <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
          {t("admin:ai.local.started")}
        </output>
      )}
      {failure !== null && (
        <p className={classes.error} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {t(`errors:${errorCodeOf(failure)}`, errorParamsOf(failure))}
        </p>
      )}
    </section>
  );
}
