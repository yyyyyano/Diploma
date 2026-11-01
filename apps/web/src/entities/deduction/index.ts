// Публичный вход сущности «расчёт вычета» (TAX-06, TAX-20, CHAT-04): результат калькулятора — карточка в чате и блок на экране
// вычетов; найденные вычеты — карточка экрана и янтарная карточка главной.
export {
  DeductionResultView,
  useDeductionTexts,
  type DeductionResultViewProps,
} from "./DeductionResultView.tsx";
export { FoundBanner, FoundCard, useFoundChange, useMarkShown } from "./found.tsx";
