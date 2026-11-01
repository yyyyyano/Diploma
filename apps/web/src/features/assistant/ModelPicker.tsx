// Выбор модели ответа (LLM-10, PRIV-02): «Авто (рекомендуется)» или модель из списка, разрешённого администратором.
// Без облачного согласия сервер отдаёт только локальные модели; выбор хранится у пользователя (не в браузере).
// Если выбранная недоступна, ответит следующая в цепочке — пометку «Модель X недоступна, ответила Y» рисует сообщение.
import { NativeSelect } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import classes from "./ModelPicker.module.css";

const AUTO = "";

export function ModelPicker() {
  const { t } = useTranslation("assistant");
  const queryClient = useQueryClient();
  const models = useQuery(orpc.llm.models.queryOptions());
  const choose = useMutation({
    ...orpc.llm.setPreferredModel.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.llm.key() }),
  });
  // Список недоступен или пуст — выбирать нечего: «Авто» и есть единственный вариант, лишний элемент не нужен.
  if (!models.isSuccess || models.data.items.length === 0) return null;
  return (
    <div className={classes.picker}>
      <NativeSelect
        size="sm"
        aria-label={t("model.label")}
        value={models.data.selected ?? AUTO}
        disabled={choose.isPending}
        error={choose.isError ? t("model.saveError") : undefined}
        data={[
          { value: AUTO, label: t("model.auto") },
          ...models.data.items.map((item) => ({
            value: item.id,
            label: t(item.cloud ? "model.cloud" : "model.local", { model: item.model }),
          })),
        ]}
        onChange={(event) =>
          choose.mutate({
            modelId: event.currentTarget.value === AUTO ? null : event.currentTarget.value,
          })
        }
      />
    </div>
  );
}
