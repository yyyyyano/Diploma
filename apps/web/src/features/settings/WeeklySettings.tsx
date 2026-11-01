// «Итоги недели» во вкладке «Уведомления» (WEEK-03, design/screens/Settings.dc.html): включить или выключить, день недели и время
// отправки — сохраняется сразу. Расчёт срока — на сервере (обход сверяет день и время по поясу системы); здесь только настройка.
import { Switch, TextInput, NativeSelect } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useWeeklyTexts } from "../../entities/weekly/index.ts";
import { orpc } from "../../lib/api.ts";
import { SkeletonList } from "../../ui/index.ts";
import classes from "./SettingsPage.module.css";

const DAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/u;

export function WeeklySettings() {
  useWeeklyTexts();
  const { t } = useTranslation("weekly");
  const queryClient = useQueryClient();
  const prefs = useQuery(orpc.weekly.preferences.queryOptions({ input: {} }));
  const [time, setTime] = useState<string | null>(null);
  const save = useMutation(
    orpc.weekly.setPreferences.mutationOptions({
      onSettled: () => queryClient.invalidateQueries({ queryKey: orpc.weekly.key() }),
    }),
  );
  const current = prefs.data;
  const shownTime = time ?? current?.time ?? "";
  const invalid = time !== null && !TIME.test(time);

  return (
    <section className={classes.card} aria-labelledby="settings-weekly">
      <div>
        <h2 id="settings-weekly" className={classes.cardTitle}>
          {t("settings.title")}
        </h2>
        <p className={classes.hint}>{t("settings.description")}</p>
      </div>
      {prefs.isPending && <SkeletonList rows={2} />}
      {prefs.isError && <p role="alert">{t("settings.error")}</p>}
      {current !== undefined && (
        <div className={classes.weeklyForm}>
          <Switch
            label={t("settings.enabled")}
            checked={current.enabled}
            onChange={(event) => save.mutate({ ...current, enabled: event.currentTarget.checked })}
          />
          <NativeSelect
            label={t("settings.weekday")}
            value={String(current.weekday)}
            disabled={!current.enabled}
            data={DAYS.map((day) => ({ value: day, label: t(`settings.days.${day}`) }))}
            onChange={(event) =>
              save.mutate({ ...current, weekday: Number(event.currentTarget.value) })
            }
          />
          <TextInput
            label={t("settings.time")}
            type="time"
            value={shownTime}
            disabled={!current.enabled}
            error={invalid ? t("settings.invalid") : null}
            onChange={(event) => setTime(event.currentTarget.value)}
            onBlur={() => {
              if (time !== null && TIME.test(time) && time !== current.time) {
                save.mutate({ ...current, time });
              }
              setTime(null);
            }}
          />
          {save.isError && (
            <p role="alert" className={classes.hint}>
              {t("settings.error")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
