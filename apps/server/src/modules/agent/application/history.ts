// История диалога для модели (AGT-08, ARCHITECTURE §8.2): последние N сообщений, и всё — текстом. Карточки и данные
// ответов (правовой ответ, итог «Да», график) превращаются в понятный модели текст, чтобы «а в августе?» не теряло нить;
// вызовы инструментов прошлых ответов не уходят провайдеру: они могли быть из другого набора, раздували бы запрос
// (лимит токенов в минуту), а сути хватает текста ответа. Исключения — вопрос `ask_user` и ожидающее подтверждение:
// без них модель не знает, на что отвечает человек. Вопрос пользователя получает блок контекста в конце.
import { LawAnswerData } from "@kosht/contract";
import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai";
import { ASK_USER, AskInput } from "./ask-user.ts";

type Part = UIMessage["parts"][number];

const TOOL_PREFIX = "tool-";

/** Имя инструмента у части вызова: `tool-delete_transaction` → `delete_transaction`. */
export function toolNameOf(part: Part): string | undefined {
  return part.type.startsWith(TOOL_PREFIX) ? part.type.slice(TOOL_PREFIX.length) : undefined;
}

/** Ожидающее решение из результата destructive-инструмента: `{ ok: true, pending: { decisionId, count } }`. */
export function pendingOf(part: Part): { decisionId: string; count: number } | undefined {
  const output = (part as { output?: unknown }).output;
  if (typeof output !== "object" || output === null) return undefined;
  const pending = (output as { ok?: unknown; pending?: unknown }).pending;
  if (typeof pending !== "object" || pending === null) return undefined;
  const { decisionId, count } = pending as { decisionId?: unknown; count?: unknown };
  return typeof decisionId === "string" && typeof count === "number"
    ? { decisionId, count }
    : undefined;
}

function lawAnswerText(data: unknown): string {
  const parsed = LawAnswerData.safeParse(data);
  if (!parsed.success) return "";
  const { parts, citations } = parsed.data;
  return parts
    .map((part) => {
      if (part.type === "text") return part.text;
      const citation = citations[part.n - 1];
      const label = citation === undefined ? "" : (citation.label ?? citation.actTitle);
      return label === "" ? "" : `[${label}]`;
    })
    .join("");
}

function partText(part: Part): string | undefined {
  if (part.type === "text") return part.text;
  if (part.type === "data-law-answer") return lawAnswerText((part as { data?: unknown }).data);
  if (part.type === "data-action-result") {
    const status = (part as { data?: { status?: unknown } }).data?.status;
    return status === "yes"
      ? "(The user confirmed the pending action; it was done.)"
      : "(The user declined the pending action; nothing changed.)";
  }
  if (part.type === "data-attachment") {
    const data = (part as { data?: { kind?: unknown; id?: unknown } }).data;
    return typeof data?.kind === "string" && typeof data.id === "string"
      ? `(The user attached a ${data.kind}, id ${data.id}; it is processed by the app, details are in the tools.)`
      : undefined;
  }
  if (part.type === "data-chart") {
    const title = (part as { data?: { title?: unknown } }).data?.title;
    return typeof title === "string" ? `(A chart was shown: ${title}.)` : undefined;
  }
  const tool = toolNameOf(part);
  if (tool === ASK_USER) {
    const input = AskInput.safeParse((part as { input?: unknown }).input);
    return input.success ? `(You asked the user: ${input.data.question})` : undefined;
  }
  const pending = pendingOf(part);
  if (tool !== undefined && pending !== undefined) {
    return `(Waiting for the user's yes/no: ${tool}, ${String(pending.count)} item(s).)`;
  }
  return undefined;
}

function textMessage(message: UIMessage, extra?: string): UIMessage | undefined {
  const pieces = message.parts.map(partText).filter((text): text is string => text !== undefined);
  const text = [...pieces, ...(extra === undefined ? [] : [extra])].join("\n\n").trim();
  if (text === "") return undefined;
  return { id: message.id, role: message.role, parts: [{ type: "text", text }] };
}

/**
 * UI-сообщения диалога → сообщения модели. `window` — сколько последних сообщений берём; вопрос пользователя (последнее
 * сообщение) обязателен и получает `contextBlock`.
 */
export async function modelHistory(
  messages: readonly UIMessage[],
  options: { readonly window: number; readonly contextBlock: string },
): Promise<ModelMessage[]> {
  const last = messages.at(-1);
  if (last?.role !== "user")
    throw new RangeError("Последнее сообщение диалога — вопрос пользователя.");
  const earlier = messages.slice(0, -1).slice(-(options.window - 1));
  const converted = earlier
    .map((message) => textMessage(message))
    .filter((message): message is UIMessage => message !== undefined);
  while (converted[0]?.role === "assistant") converted.shift();
  const question = textMessage(last, options.contextBlock) ?? {
    id: last.id,
    role: "user" as const,
    parts: [{ type: "text" as const, text: options.contextBlock }],
  };
  return convertToModelMessages([...converted, question]);
}
