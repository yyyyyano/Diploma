// Имена обработчиков действий модуля в реестрах корня композиции (`<модуль>.<действие>`, ARCHITECTURE §5): «Отменить»
// (undo) и «Да» (confirm). Отдельный файл — чтобы сценарии не зависели друг от друга ради константы.
export const RESTORE_HANDLER = "transactions.restore";
export const DELETE_HANDLER = "transactions.delete";
export const CATEGORY_HANDLER = "transactions.bulk-category";
export const TRANSFER_HANDLER = "transactions.bulk-transfer";
export const APPLY_RULE_HANDLER = "transactions.apply-rule";
/** TXN-10: «Отменить» связь (и «Это разные покупки») — чек возвращается к операции «без пары». */
export const UNMERGE_HANDLER = "transactions.unmerge";
/** TXN-11: «Отменить» разрыв связи — чек и операция выписки снова одна операция. */
export const REMERGE_HANDLER = "transactions.remerge";
/** TXN-10: «Да» на вопрос «одна покупка?» — слить чек и платёж. */
export const MATCH_HANDLER = "transactions.match";
