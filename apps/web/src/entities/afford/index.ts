// Публичный вход сущности «сценарии покупки» (AFF-03…08, CHAT-04): результат сценариев и безопасного платежа — карточка в чате,
// блоки экрана «Могу ли я позволить покупку?»; словарь регистрируется при первом показе (`useAffordTexts`).
export { AffordResultView, type AffordResultViewProps } from "./AffordResultView.tsx";
export { formatRate, SafeLoanView, type SafeLoanViewProps } from "./SafeLoanView.tsx";
export { useAffordTexts } from "./texts.ts";
