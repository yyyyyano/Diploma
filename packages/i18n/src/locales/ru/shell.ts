// Каркас сайта (DES-15, design/screens/Main.dc.html, MobileHome.dc.html): меню, нижняя панель телефона, экраны
// ошибки и «нет такой страницы». Пункты меню — по id разделов из staticData.nav маршрутов.
export const shell = {
  brand: "Кошт",
  homeLink: "Кошт — на главную",
  sideLabel: "Основное меню",
  navLabel: "Разделы",
  bottomLabel: "Нижнее меню",
  more: "Ещё",
  moreLabel: "Ещё разделы",
  moreTitle: "Все разделы",
  logout: "Выйти",
  groups: {
    money: "Деньги",
    law: "Право и выгода",
    profile: "Профиль",
  },
  nav: {
    dashboard: "Главная",
    assistant: "Ассистент",
    operations: "Операции",
    documents: "Чеки и документы",
    accounts: "Счета",
    recurring: "Регулярные платежи",
    budget: "Лимиты и цели",
    calendar: "Календарь",
    deductions: "Налоговые вычеты",
    afford: "Крупная покупка",
    laws: "База законов",
    memory: "Что ассистент знает",
    settings: "Настройки",
    admin: "Администрирование",
  },
  error: {
    title: "Что-то пошло не так",
    description:
      "Страница не открылась из-за ошибки программы. Ваши данные целы — попробуйте ещё раз.",
    retry: "Попробовать ещё раз",
  },
  notFound: {
    title: "Такой страницы нет",
    description: "Проверьте адрес или выберите раздел в меню.",
  },
} as const;
