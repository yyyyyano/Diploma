// Значок категории (DES-14, design/DESIGN.md §1): белый значок Lucide в квадрате постоянного цвета категории — цвет из
// таблицы ui/theme/category-colors.ts, значок — по ключу. Без подписи — украшение рядом с названием (aria-hidden);
// с подписью (label) — изображение с именем для экранного диктора.
import {
  Baby,
  Briefcase,
  Bus,
  CarTaxiFront,
  CircleEllipsis,
  Fuel,
  Gift,
  GraduationCap,
  HandCoins,
  HandHeart,
  KeyRound,
  Landmark,
  Laptop,
  Lightbulb,
  PawPrint,
  Percent,
  PiggyBank,
  Pill,
  Plane,
  Receipt,
  Repeat,
  Shirt,
  ShoppingCart,
  Smartphone,
  Sofa,
  Sparkles,
  SprayCan,
  Ticket,
  Undo2,
  Utensils,
  Wallet,
  Wifi,
  Wine,
  type LucideIcon,
} from "lucide-react";
import { CATEGORY_COLORS, type CategoryColorKey } from "../theme/category-colors.ts";
import { cx } from "../cx.ts";
import classes from "./CategoryIcon.module.css";

/** Ключ значка → компонент Lucide (тот же список, что CATEGORY_ICON_KEYS в @kosht/contract). */
export const CATEGORY_ICONS = {
  "shopping-cart": ShoppingCart,
  utensils: Utensils,
  wine: Wine,
  "spray-can": SprayCan,
  sparkles: Sparkles,
  pill: Pill,
  shirt: Shirt,
  smartphone: Smartphone,
  sofa: Sofa,
  lightbulb: Lightbulb,
  "key-round": KeyRound,
  wifi: Wifi,
  repeat: Repeat,
  bus: Bus,
  "car-taxi-front": CarTaxiFront,
  fuel: Fuel,
  "graduation-cap": GraduationCap,
  baby: Baby,
  "paw-print": PawPrint,
  ticket: Ticket,
  plane: Plane,
  gift: Gift,
  landmark: Landmark,
  receipt: Receipt,
  percent: Percent,
  "circle-ellipsis": CircleEllipsis,
  briefcase: Briefcase,
  laptop: Laptop,
  "hand-coins": HandCoins,
  "piggy-bank": PiggyBank,
  "undo-2": Undo2,
  "hand-heart": HandHeart,
  wallet: Wallet,
} as const satisfies Record<string, LucideIcon>;

export type CategoryIconName = keyof typeof CATEGORY_ICONS;

export interface CategoryIconProps {
  readonly icon: CategoryIconName;
  readonly color: CategoryColorKey;
  /** Подпись для экранного диктора; нет — значок декоративный (название рядом). */
  readonly label?: string;
  readonly size?: "sm" | "md";
}

export function CategoryIcon({ icon, color, label, size = "md" }: CategoryIconProps) {
  const Icon = CATEGORY_ICONS[icon];
  return (
    <span
      className={cx(classes.icon, classes[size])}
      style={{ backgroundColor: CATEGORY_COLORS[color] }}
      {...(label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
      data-color={color}
    >
      <Icon size={size === "sm" ? 14 : 18} strokeWidth={1.8} aria-hidden />
    </span>
  );
}
