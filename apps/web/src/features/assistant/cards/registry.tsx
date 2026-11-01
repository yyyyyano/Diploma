// Реестр частей ответа (CHAT-04, ARCHITECTURE §10.3): `data-<вид>` и `tool-<имя>` → компонент. Виды данных-частей берутся
// из контракта (`DATA_PARTS`): компилятор не даст добавить вид на сервере без карточки здесь (`satisfies`). Результат
// инструмента показывается карточкой, только если он имеет ожидаемую форму; иначе — ничего (шаг остаётся подписью в ленте),
// а данные-часть не по схеме или неизвестного вида — запасной вид `Unavailable`. Карточки вычета (T-045) и сценариев покупки (T-049) —
// строки `TOOL_CARDS`.
import { type AccountListItem, type DATA_PARTS, ReceiptCard } from "@kosht/contract";
import type { ComponentType, ReactNode } from "react";
import { AccountCard } from "../../../entities/account/index.ts";
import { ReceiptPreview } from "../../../entities/receipt/index.ts";
import { ActionResultCard } from "./ActionResultCard.tsx";
import { AffordCard, SafeLoanCard } from "./AffordCard.tsx";
import { AttachmentCard } from "./AttachmentCard.tsx";
import { ChartCard } from "./ChartCard.tsx";
import { ChecklistCard } from "./ChecklistCard.tsx";
import classes from "./cards.module.css";
import { ConfirmCard } from "./ConfirmCard.tsx";
import { DeductionCard } from "./DeductionCard.tsx";
import { EventCard } from "./EventCard.tsx";
import { LawAnswerView } from "./LawAnswerView.tsx";
import { TransactionResultCard } from "./TransactionResultCard.tsx";

interface DataCardProps {
  readonly data: unknown;
}

/** Карточка на каждый вид данных-части контракта: нового вида без карточки не соберётся. */
export const DATA_CARDS = {
  "data-law-answer": LawAnswerView,
  "data-action-result": ActionResultCard,
  "data-chart": ChartCard,
  "data-attachment": AttachmentCard,
} satisfies Record<keyof typeof DATA_PARTS, ComponentType<DataCardProps>>;

export function isDataCard(type: string): type is keyof typeof DATA_CARDS {
  return Object.hasOwn(DATA_CARDS, type);
}

interface ToolCardProps {
  readonly output: unknown;
  /** id сообщения ответа: состояние галочек чек-листа хранится за ним. */
  readonly messageId: string;
}

/** Результат list_accounts — `{ items: AccountListItem[] }` (карточка из @kosht/contract). */
function Accounts({ output }: ToolCardProps): ReactNode {
  if (typeof output !== "object" || output === null || !("items" in output)) return null;
  const { items } = output;
  if (!Array.isArray(items)) return null;
  return (
    <div className={classes.stack}>
      {(items as AccountListItem[]).map((account) => (
        <AccountCard key={account.id} account={account} />
      ))}
    </div>
  );
}

function Receipt({ output }: ToolCardProps): ReactNode {
  const card = ReceiptCard.safeParse(output);
  return card.success ? <ReceiptPreview card={card.data} /> : null;
}

/** Инструменты, чей результат — карточка; остальным достаточно подписи шага. */
export const TOOL_CARDS: Readonly<Record<string, ComponentType<ToolCardProps>>> = {
  list_accounts: Accounts,
  add_transaction: ({ output }) => <TransactionResultCard output={output} changed={false} />,
  update_transaction: ({ output }) => <TransactionResultCard output={output} changed />,
  get_checklist: ({ output, messageId }) => <ChecklistCard output={output} messageId={messageId} />,
  calculate_deduction: ({ output, messageId }) => (
    <DeductionCard output={output} messageId={messageId} />
  ),
  create_event: ({ output }) => <EventCard output={output} />,
  afford_scenarios: ({ output }) => <AffordCard output={output} />,
  safe_loan_payment: ({ output }) => <SafeLoanCard output={output} />,
  get_receipt: Receipt,
  // Удаляющие и массовые действия — только вопрос «Да/Нет» (AGT-07): результат один и тот же у всех.
  delete_transaction: ({ output }) => <ConfirmCard output={output} />,
  bulk_change_category: ({ output }) => <ConfirmCard output={output} />,
  delete_account: ({ output }) => <ConfirmCard output={output} />,
  delete_limit: ({ output }) => <ConfirmCard output={output} />,
  delete_goal: ({ output }) => <ConfirmCard output={output} />,
};
