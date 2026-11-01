// Чек-лист документов в чате (`get_checklist`, LEGAL-12, CHAT-04): из результата инструмента берётся только id шаблона —
// состояние и тексты приходят процедурой, галочки сохраняются за этим сообщением (subject `message`). Сам виджет — в
// `entities/checklist`: он же показан на экране «Налоговые вычеты».
import { ChecklistId } from "@kosht/contract";
import { z } from "zod";
import { Checklist } from "../../../entities/checklist/index.ts";

const Output = z.object({ id: ChecklistId });
const UUID = z.uuid();

export function ChecklistCard({
  output,
  messageId,
}: {
  readonly output: unknown;
  readonly messageId: string;
}) {
  const parsed = Output.safeParse(output);
  if (!parsed.success) return null;
  // Сообщение без своего id (локальное, до ответа сервера) делит «общее» состояние шаблона.
  const subject = UUID.safeParse(messageId).success
    ? ({ kind: "message", id: messageId } as const)
    : ({ kind: "general" } as const);
  return <Checklist id={parsed.data.id} subject={subject} />;
}
