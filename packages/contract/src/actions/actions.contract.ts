// «Отменить» и «Да/Нет» (P5, AGT-05, AGT-07, NOTIF-05, ARCHITECTURE §5): сайт шлёт сюда undoToken из ответа действия и
// id ожидающего решения из уведомления или карточки; бот и чат зовут те же функции фасадом. Владельца во входе нет —
// чужой токен или решение неотличимы от несуществующих (NOT_FOUND).
import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "../errors.ts";

/** Токен отмены действия (id записи журнала). */
export const UndoToken = z.uuid();
/** Id ожидающего решения «Да/Нет». */
export const DecisionId = z.uuid();

export const DecisionStatus = z.enum(["pending", "yes", "no"]);
export const DecisionAnswer = z.enum(["yes", "no"]);

/** Что изменится — ключ словаря и параметры: текст пишет сайт или бот. */
export const DecisionSummary = z.strictObject({
  key: z.string().regex(/^[a-z]+(\.[a-zA-Z0-9-]+)*$/),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
});

export const Decision = z.strictObject({
  id: DecisionId,
  status: DecisionStatus,
  summary: DecisionSummary,
  createdAt: z.iso.datetime(),
});
export type Decision = z.infer<typeof Decision>;

export const actionsContract = {
  /** «Отменить»: отменено сейчас или уже было; объект правили позже — CONFLICT. */
  undo: oc
    .route({ method: "POST", path: "/actions/undo" })
    .input(z.strictObject({ token: UndoToken }))
    .output(z.strictObject({ status: z.enum(["undone", "already-undone"]) }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND", "CONFLICT")),
  /** Ожидающее решение: вопрос и состояние (карточка, уведомление). */
  decision: oc
    .route({ method: "GET", path: "/actions/decision" })
    .input(z.strictObject({ id: DecisionId }))
    .output(Decision)
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND")),
  /**
   * «Да» / «Нет»: итог — состояние решения; повторный ответ ничего не меняет. undoToken — «Отменить» сразу после «Да»
   * (удаление операций, TXN-03); у действия без отмены и у повтора — null.
   */
  answer: oc
    .route({ method: "POST", path: "/actions/answer" })
    .input(z.strictObject({ id: DecisionId, answer: DecisionAnswer }))
    .output(z.strictObject({ status: DecisionAnswer, undoToken: UndoToken.nullable() }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND")),
};
