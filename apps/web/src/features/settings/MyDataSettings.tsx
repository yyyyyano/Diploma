// Вкладка «Мои данные» (design/screens/Settings.dc.html — Settings--my-data): «Скачать все мои данные» (PRIV-05) —
// заявка `privacy.requestExport`, архив собирает задача сервера; пока готовится, вкладку обновит поток событий
// (`realtime.changed` по data-export), о готовности придёт уведомление; готовый архив скачивается обычной ссылкой
// `/api/files/<id>` (выдаёт только владельцу). «Удалить аккаунт» (PRIV-06) — необратимо, поэтому ConfirmDialog с
// перечнем того, что удалится, и паролем; после удаления кэш очищается целиком и открывается вход.
import { DeleteAccountInput, type DataExportState } from "@kosht/contract";
import { formatDate, formatFileSize } from "@kosht/i18n";
import { DEFAULT_TIME_ZONE, LocalDate } from "@kosht/kernel";
import { Button, Loader, PasswordInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, Download, FileArchive, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { ConfirmDialog, SkeletonCard } from "../../ui/index.ts";
import classes from "./SettingsPage.module.css";

export function MyDataSettings() {
  return (
    <>
      <ExportCard />
      <DeleteCard />
    </>
  );
}

function ExportCard() {
  const { t } = useTranslation(["settings", "errors"]);
  const queryClient = useQueryClient();
  const state = useQuery(orpc.privacy.dataExport.queryOptions());
  const request = useMutation(
    orpc.privacy.requestExport.mutationOptions({
      onSuccess: (next) => queryClient.setQueryData(orpc.privacy.dataExport.queryKey(), next),
    }),
  );
  if (state.isPending) return <SkeletonCard />;
  const current: DataExportState | undefined = state.data;
  const status = current?.status;
  return (
    <section className={classes.card} aria-labelledby="settings-export">
      <div className={classes.row}>
        <span className={classes.rowIcon}>
          <Download size={20} strokeWidth={1.8} aria-hidden />
        </span>
        <div className={classes.rowText}>
          <h2 id="settings-export" className={classes.cardTitle}>
            {t("settings:myData.export.title")}
          </h2>
          <p className={classes.hint}>{t("settings:myData.export.text")}</p>
        </div>
      </div>
      {state.isError && (
        <p className={classes.error} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {t("settings:myData.export.error")}
        </p>
      )}
      {status === "pending" && (
        <output className={classes.actions}>
          <Loader size="sm" aria-hidden />
          <span className={classes.hint}>{t("settings:myData.export.pending")}</span>
        </output>
      )}
      {status === "ready" && current?.file != null && (
        <div className={classes.fileRow}>
          <FileArchive size={20} strokeWidth={1.8} aria-hidden />
          <div className={classes.rowText}>
            <p className={classes.fileName}>{current.file.name}</p>
            {current.finishedAt !== null && (
              <p className={classes.hint}>
                {t("settings:myData.export.ready", {
                  size: formatFileSize(current.file.size),
                  date: formatDate(
                    LocalDate.fromInstant(new Date(current.finishedAt), DEFAULT_TIME_ZONE),
                  ),
                })}
              </p>
            )}
          </div>
          <Button
            component="a"
            href={`/api/files/${current.file.id}`}
            download={current.file.name}
            variant="default"
            leftSection={<Download size={16} strokeWidth={1.8} aria-hidden />}
          >
            {t("settings:myData.export.download")}
          </Button>
        </div>
      )}
      {status === "failed" && (
        <p className={classes.error} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {t("settings:myData.export.failed")}
        </p>
      )}
      {status !== "pending" && !state.isError && (
        <div className={classes.actions}>
          <Button
            variant={status === "ready" ? "default" : "filled"}
            leftSection={<Download size={16} strokeWidth={1.8} aria-hidden />}
            loading={request.isPending}
            onClick={() => request.mutate({})}
          >
            {status === "ready" || status === "failed"
              ? t("settings:myData.export.again")
              : t("settings:myData.export.prepare")}
          </Button>
        </div>
      )}
      {request.isError && (
        <p className={classes.error} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {t(`errors:${errorCodeOf(request.error)}`, errorParamsOf(request.error))}
        </p>
      )}
    </section>
  );
}

function DeleteCard() {
  const { t } = useTranslation(["settings", "errors", "auth"]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [opened, setOpened] = useState(false);
  const [password, setPassword] = useState("");
  const [missing, setMissing] = useState(false);
  const remove = useMutation(
    orpc.identity.deleteAccount.mutationOptions({
      // Данные удалённого аккаунта не должны остаться в кэше (frontend-feature.md): кэш — целиком.
      onSuccess: async () => {
        queryClient.clear();
        await navigate({ to: "/login" });
      },
    }),
  );
  const close = () => {
    setOpened(false);
    setPassword("");
    setMissing(false);
    remove.reset();
  };
  const serverError =
    remove.error === null
      ? undefined
      : errorCodeOf(remove.error) === "INVALID_CREDENTIALS"
        ? t("settings:myData.delete.wrongPassword")
        : t(`errors:${errorCodeOf(remove.error)}`, errorParamsOf(remove.error));
  return (
    <section className={`${classes.card} ${classes.danger}`} aria-labelledby="settings-delete">
      <div className={classes.row}>
        <span className={`${classes.rowIcon} ${classes.dangerIcon}`}>
          <Trash2 size={20} strokeWidth={1.8} aria-hidden />
        </span>
        <div className={classes.rowText}>
          <h2 id="settings-delete" className={classes.cardTitle}>
            {t("settings:myData.delete.title")}
          </h2>
          <p className={classes.hint}>{t("settings:myData.delete.text")}</p>
        </div>
      </div>
      <div className={classes.actions}>
        <Button
          variant="default"
          className={classes.dangerButton}
          leftSection={<Trash2 size={16} strokeWidth={1.8} aria-hidden />}
          onClick={() => setOpened(true)}
        >
          {t("settings:myData.delete.open")}
        </Button>
      </div>
      <ConfirmDialog
        opened={opened}
        title={t("settings:myData.delete.dialogTitle")}
        confirmLabel={t("settings:myData.delete.confirm")}
        tone="danger"
        pending={remove.isPending}
        onCancel={close}
        onConfirm={() => {
          const input = DeleteAccountInput.safeParse({ password });
          setMissing(!input.success);
          if (input.success) remove.mutate(input.data);
        }}
      >
        <p className={classes.text}>{t("settings:myData.delete.lead")}</p>
        <ul className={classes.list}>
          <li>{t("settings:myData.delete.items.money")}</li>
          <li>{t("settings:myData.delete.items.documents")}</li>
          <li>{t("settings:myData.delete.items.profile")}</li>
          <li>{t("settings:myData.delete.items.ai")}</li>
        </ul>
        <PasswordInput
          label={t("settings:myData.delete.password")}
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          error={missing ? t("settings:myData.delete.passwordRequired") : undefined}
          visibilityToggleButtonProps={{ "aria-label": t("auth:password.show") }}
        />
        {serverError !== undefined && (
          <p className={classes.error} role="alert">
            <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
            {serverError}
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}
