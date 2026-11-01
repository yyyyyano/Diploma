// Значок типа события (CAL-01, design/screens/Calendar.dc.html — легенда): налог, кредит, регулярный платёж, доход, гарантия, страховка,
// своё событие. Цвет плашки — по `data-type` в CSS (токены темы).
import type { CalendarType } from "@kosht/contract";
import {
  Banknote,
  Bell,
  Landmark,
  Percent,
  Repeat,
  Shield,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export const EVENT_ICONS: Readonly<Record<CalendarType, LucideIcon>> = {
  tax: Percent,
  credit: Landmark,
  recurring: Repeat,
  income: Banknote,
  warranty: ShieldCheck,
  insurance: Shield,
  own: Bell,
};
