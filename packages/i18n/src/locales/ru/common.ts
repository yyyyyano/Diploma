// Общие тексты (NFR-19). Множественные числа — суффиксы i18next для русского: `_one` (1, 21, 101), `_few` (2–4, 22),
// `_many` (0, 5–20, 25, 111) и `_other` — дроби («1,5 операции»).
export const common = {
  count: {
    operations_one: "{{count, number}} операция",
    operations_few: "{{count, number}} операции",
    operations_many: "{{count, number}} операций",
    operations_other: "{{count, number}} операции",
  },
  /** Подписи дня относительно сегодня (formatRelativeDay); дальше недели — дата «21.10.2026». */
  relativeDay: {
    today: "сегодня",
    yesterday: "вчера",
    tomorrow: "завтра",
    dayAfterTomorrow: "послезавтра",
    inDays: "через {{count}} дн.",
    daysAgo: "{{count}} дн. назад",
  },
} as const;
