// «Демо-вход → живой дашборд» (DEMO-01…04, AUTH-08, DES-16): на странице входа — «Войти как демо-пользователь» (стенд слушает
// локальный адрес) → без пароля попадаем на главную, и она не пустая: расходы периода, траты по категориям, динамика; «Операции» —
// история на 6 месяцев; «Лимиты и цели» — лимиты и две цели. Первая запись демо идёт в запросе входа (модели не вызываются).
// axe 0 нарушений WCAG 2.2 AA и нет горизонтальной прокрутки при 1440 и 390 на главной с данными демо.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { shownSettled } from "./support/settled.ts";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

async function accessibleAtBothWidths(page: Page) {
  const problems: unknown[] = [];
  for (const size of VIEWPORTS) {
    await page.setViewportSize(size);
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== "running"),
    );
    const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    for (const v of result.violations) {
      problems.push({
        width: size.width,
        id: v.id,
        targets: v.nodes.map((n) => n.target.join(" ")),
      });
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (overflow > 0) problems.push({ width: size.width, overflow });
  }
  await page.setViewportSize(VIEWPORTS[0]);
  return problems;
}

test("демо-вход: без пароля — на главную с живыми данными; операции, лимиты и цели на месте; axe 0 при 1440 и 390", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Войти как демо-пользователь" }).click();
  // Первый вход пишет историю демо (6 месяцев, чеки, лимиты): на медленной машине — десятки секунд.
  await expect(page).toHaveURL(/\/home$/, { timeout: 90_000 });

  // DASH-02: расходы периода, кольцо по категориям и динамика — не пустые «первые шаги».
  await expect(page.getByRole("heading", { name: "Добро пожаловать в Кошт" })).toHaveCount(0);
  const kpis = page.getByRole("region", { name: "Сводка за период" });
  await expect(kpis).toContainText(/\d\s?\d*,\d{2}\sBYN/);
  const donut = page.getByRole("region", { name: "Траты по категориям" });
  await expect(donut).toBeVisible();
  await expect(donut.getByRole("button", { name: /^Показать операции: / })).not.toHaveCount(0);
  await expect(page.getByRole("figure", { name: "Доходы и расходы по месяцам" })).toBeVisible();
  await shownSettled(donut);
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // TXN-02: история операций на 6 месяцев — контрагенты демо в таблице.
  await page.goto("/operations");
  await expect(page.getByText("Евроопт").first()).toBeVisible();

  // BUD-01, BUD-04: лимиты (кафе, такси…) и две цели; «пусто» не показывается.
  await page.goto("/budget");
  await expect(page.getByRole("heading", { name: "Лимитов пока нет" })).toHaveCount(0);
  await expect(page.getByText("Новый ноутбук").first()).toBeVisible();
  await expect(page.getByText("Отпуск летом").first()).toBeVisible();
});
