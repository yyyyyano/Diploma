// Вкладка «Уведомления» (NOTIF-04, design/screens/Settings.dc.html — Settings--notifications-settings): матрица вид ×
// канал, сохраняется сразу. Столбец Telegram неактивен, пока бот не подключён (T-052, T-053). «Итоги недели» и
// «Напоминания календаря по умолчанию» — задачи своих модулей (T-050, T-047).
import { USER_NOTIFICATION_KINDS, type UserNotificationKind } from "@kosht/contract";
import { Switch } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { SkeletonList } from "../../ui/index.ts";
import classes from "./SettingsPage.module.css";

export function NotificationSettings() {
  const { t } = useTranslation("notifications");
  const queryClient = useQueryClient();
  const prefs = useQuery(orpc.notifications.preferences.queryOptions());
  const save = useMutation(
    orpc.notifications.setPreference.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: orpc.notifications.preferences.key() }),
    }),
  );
  const web = (kind: UserNotificationKind) =>
    prefs.data?.items.find((p) => p.kind === kind)?.web ?? true;

  return (
    <>
      <p className={classes.banner}>
        <Send size={18} strokeWidth={1.8} aria-hidden />
        {t("preferences.telegramHint")}
      </p>
      <section className={classes.card} aria-labelledby="settings-notifications">
        <div>
          <h2 id="settings-notifications" className={classes.cardTitle}>
            {t("preferences.title")}
          </h2>
          <p className={classes.hint}>{t("preferences.hint")}</p>
        </div>
        {prefs.isPending && <SkeletonList rows={4} />}
        {prefs.isError && <p role="alert">{t("preferences.error")}</p>}
        {prefs.isSuccess && (
          <div className={classes.tableWrap}>
            <table className={classes.matrix}>
              <thead>
                <tr>
                  <th scope="col">{t("preferences.kind")}</th>
                  <th scope="col">{t("preferences.web")}</th>
                  <th scope="col">{t("preferences.telegram")}</th>
                </tr>
              </thead>
              <tbody>
                {USER_NOTIFICATION_KINDS.map((kind) => (
                  <tr key={kind}>
                    <th scope="row">
                      <span className={classes.kindTitle}>{t(`kinds.${kind}.title`)}</span>
                      <span className={classes.hint}>{t(`kinds.${kind}.description`)}</span>
                    </th>
                    <td>
                      <Switch
                        checked={web(kind)}
                        aria-label={t("preferences.toggle", {
                          kind: t(`kinds.${kind}.title`),
                          channel: t("preferences.web"),
                        })}
                        onChange={(event) =>
                          save.mutate({
                            kind,
                            channel: "web",
                            enabled: event.currentTarget.checked,
                          })
                        }
                      />
                    </td>
                    <td>
                      <Switch
                        checked={false}
                        disabled
                        aria-label={t("preferences.toggle", {
                          kind: t(`kinds.${kind}.title`),
                          channel: t("preferences.telegram"),
                        })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
