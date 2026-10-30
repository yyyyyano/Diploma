// Дизайн-система «Пуща и янтарь» (ADR-0014, паспорт — ui/CLAUDE.md): только представление, без запросов.
export {
  CATEGORY_ICONS,
  CategoryIcon,
  type CategoryIconName,
  type CategoryIconProps,
} from "./components/CategoryIcon.tsx";
export { ColumnChart, type Column, type ColumnChartProps } from "./components/ColumnChart.tsx";
export { ConfirmDialog, type ConfirmDialogProps } from "./components/ConfirmDialog.tsx";
export { DonutChart, type DonutChartProps, type DonutSegment } from "./components/DonutChart.tsx";
export { EmptyState, type EmptyStateProps } from "./components/EmptyState.tsx";
export { Formula, type FormulaProps, type FormulaRow } from "./components/Formula.tsx";
export {
  LimitBar,
  limitLevel,
  type LimitBarProps,
  type LimitLevel,
} from "./components/LimitBar.tsx";
export { LawQuote, type LawQuoteProps } from "./components/LawQuote.tsx";
export { LawRefChip, type LawRefChipProps } from "./components/LawRefChip.tsx";
export { Logo, type LogoProps } from "./components/Logo.tsx";
export { Money, type MoneyKind, type MoneyProps } from "./components/Money.tsx";
export { PageHeader, type PageHeaderProps } from "./components/PageHeader.tsx";
export { Sheet, type SheetProps } from "./components/Sheet.tsx";
export {
  Loading,
  Skeleton,
  SkeletonCard,
  SkeletonList,
  SkeletonText,
} from "./components/Skeletons.tsx";
export { Steps, type StepItem, type StepState, type StepsProps } from "./components/Steps.tsx";
export { StatCard, type StatCardProps } from "./components/StatCard.tsx";
export { StatusBadge, type StatusBadgeProps, type StatusTone } from "./components/StatusBadge.tsx";
export { UNDO_TOAST_MS, UndoToast, type UndoToastProps } from "./components/UndoToast.tsx";
export { WhyButton, type WhyButtonProps } from "./components/WhyButton.tsx";
export { CATEGORY_COLORS, type CategoryColorKey } from "./theme/category-colors.ts";
