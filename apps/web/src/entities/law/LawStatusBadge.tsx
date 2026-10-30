// Состояние акта словами и значком (LEGAL-05, LEGAL-06, LAW-32, LAW-34): действует, есть принятые изменения, только карточка,
// утратил силу. Цвет всегда с иконкой и подписью (NFR-20).
import type { LawStatus } from "@kosht/contract";
import { CircleAlert, CircleCheck, Clock3, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge, type StatusTone } from "../../ui/index.ts";

const VIEW = {
  active: { tone: "ok", icon: CircleCheck },
  "has-changes": { tone: "law", icon: Clock3 },
  "card-only": { tone: "neutral", icon: FileText },
  repealed: { tone: "danger", icon: CircleAlert },
} as const satisfies Record<LawStatus, { tone: StatusTone; icon: typeof CircleCheck }>;

export function LawStatusBadge({ status }: { readonly status: LawStatus }) {
  const { t } = useTranslation("laws");
  const view = VIEW[status];
  return (
    <StatusBadge tone={view.tone} icon={view.icon}>
      {t(`status.${status}`)}
    </StatusBadge>
  );
}
