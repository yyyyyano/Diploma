// Постоянные цвета категорий (DES-14, design/DESIGN.md §1): точка, иконка в квадрате с белым значком, сегмент
// диаграммы. Ключ — машинный id категории (справочник категорий — T-020); «Остальное» — свёрнутый хвост диаграммы.
export const CATEGORY_COLORS = {
  groceries: "#1F6F63",
  utilities: "#C98A1B",
  cafes: "#B5655A",
  car: "#7A5C8E",
  kids: "#6E9E5B",
  taxi: "#8C6D3F",
  loans: "#4A6FA5",
  education: "#3E7CA6",
  telecom: "#5B8C85",
  subscriptions: "#9C5A86",
  health: "#C0574A",
  clothes: "#8A7F5A",
  leisure: "#5E7FA0",
  household: "#6F8F8A",
  beauty: "#A0668C",
  salary: "#146C43",
  other: "#AEB7B3",
} as const;

export type CategoryColorKey = keyof typeof CATEGORY_COLORS;
