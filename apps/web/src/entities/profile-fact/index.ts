// Сущность «факт профиля» (PROF-05, ARCHITECTURE §10.1): подписи, значение словами и форма факта — для анкеты,
// «Что ассистент знает обо мне» и карточек чата.
export { draftOf, FactEditor, toInput, type FactEditorProps } from "./FactEditor.tsx";
export {
  childrenText,
  factLabel,
  FactValueText,
  factValueNode,
  keyLabel,
  type FactValueTextProps,
} from "./fact-text.tsx";
