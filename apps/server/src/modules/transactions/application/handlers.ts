// Имена обработчиков действий модуля в реестрах корня композиции (`<модуль>.<действие>`, ARCHITECTURE §5): «Отменить»
// (undo) и «Да» (confirm). Отдельный файл — чтобы сценарии не зависели друг от друга ради константы.
export const RESTORE_HANDLER = "transactions.restore";
export const DELETE_HANDLER = "transactions.delete";
export const CATEGORY_HANDLER = "transactions.bulk-category";
export const TRANSFER_HANDLER = "transactions.bulk-transfer";
export const APPLY_RULE_HANDLER = "transactions.apply-rule";
