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
  /** «Откуда эта цифра?» (EXPL-01, Main--why-panel): панель с сохранённым расчётом числа. */
  explanation: {
    title: "Откуда эта цифра?",
    period: "Период: {{from}} — {{to}}",
    calc: "Расчёт",
    basis: "Основания",
    refs: {
      transaction: "Операция",
      fragmentVersion: "Норма закона",
      fxRate: "Курс НБРБ",
    },
    note: "Все суммы посчитаны программой по вашим операциям, а не нейросетью.",
    error: "Расчёт не загрузился. Закройте панель и откройте её ещё раз.",
  },
  /** Ожидающее решение «Да/Нет» (AGT-07, NOTIF-05). */
  decision: {
    title: "Подтвердите действие",
    yes: "Да, выполнить",
    no: "Нет",
    answeredYes: "Готово: действие выполнено.",
    answeredNo: "Хорошо, ничего не меняем.",
  },
  /** «Отменить» (P5): итог отмены. */
  undo: {
    done: "Отменено.",
  },
  /** Код восстановления (AUTH-05): показ один раз — первый запуск, вход с кодом, настройки. */
  recoveryCode: {
    label: "Код восстановления",
    copy: "Скопировать",
    copied: "Скопировано",
  },
} as const;
