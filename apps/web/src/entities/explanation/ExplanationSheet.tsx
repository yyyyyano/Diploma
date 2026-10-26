// Панель «Откуда эта цифра?» (EXPL-01): по traceId числа загружает сохранённый расчёт (explain.get) и показывает его —
// справа на компьютере, шторкой снизу на телефоне. Открывает её WhyButton рядом с числом.
import { Explanation } from "@kosht/contract";
import type { TraceId } from "@kosht/kernel";
import { useMediaQuery } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { Sheet, SkeletonText } from "../../ui/index.ts";
import { ExplanationView } from "./ExplanationView.tsx";

export interface ExplanationSheetProps {
  readonly traceId: TraceId;
  readonly opened: boolean;
  readonly onClose: () => void;
}

/** Телефон: шторка снизу (design/DESIGN.md §4 .sheet). */
const PHONE = "(max-width: 760px)";

export function ExplanationSheet({ traceId, opened, onClose }: ExplanationSheetProps) {
  const { t } = useTranslation("common");
  const phone = useMediaQuery(PHONE) ?? false;
  const explanation = useQuery({
    ...orpc.explain.get.queryOptions({ input: { id: traceId } }),
    enabled: opened,
  });
  return (
    <Sheet
      opened={opened}
      onClose={onClose}
      title={t("explanation.title")}
      position={phone ? "bottom" : "right"}
    >
      {explanation.isPending && <SkeletonText lines={4} />}
      {explanation.isError && <p role="alert">{t("explanation.error")}</p>}
      {explanation.data !== undefined && (
        // Ответ JSON: дерево трассы проверяется схемой контракта и получает свой тип (TraceNode).
        <ExplanationView explanation={Explanation.parse(explanation.data)} />
      )}
    </Sheet>
  );
}
