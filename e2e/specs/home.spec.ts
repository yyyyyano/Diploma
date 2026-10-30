// «Главная» (DASH-01…04, EXPL-01, DES-16): новый пользователь → «первые шаги» вместо пустых графиков → операция → цифры,
// кольцо и динамика, ⓘ открывает расчёт, клик по категории ведёт в «Операции» с периодом и категорией; смена месяца.
// axe 0 нарушений WCAG 2.2 AA и нет горизонтальной прокрутки при 1440 и 390: «первые шаги» и главная с данными.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { shownSettled } from "./support/settled.ts";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

async function animationsSettled(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
}

async function accessibleAtBothWidths(page: Page) {
  const problems: unknown[] = [];
  for (const size of VIEWPORTS) {
    await page.setViewportSize(size);
    await animationsSettled(page);
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
    if (overflow > 0) {
      // Кто вылезает за край — в сообщение: так находят причину, не гадая.
      const culprits = await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 6)
          .map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`),
      );
      problems.push({ width: size.width, overflow, culprits });
    }
  }
  await page.setViewportSize(VIEWPORTS[0]);
  return problems;
}

test("«Главная»: первые шаги, операция → цифры и ⓘ, категория → операции, смена месяца; axe 0 при 1440 и 390", async ({
  page,
}) => {
  const email = `home-${String(Date.now())}@example.test`;
  const password = "кошт2026главная";
  await page.goto("/register");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByLabel("Повторите пароль").fill(password);
  await page.getByRole("checkbox", { name: /согласен/ }).check();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Пропустить анкету" }).click();
  await expect(page).toHaveURL(/\/home$/);

  // DASH-04: пусто — первые шаги, а не пустые графики.
  const welcome = page.getByRole("heading", { name: "Добро пожаловать в Кошт" });
  await expect(welcome).toBeVisible();
  await expect(page.getByRole("link", { name: "Загрузить выписку или чек" })).toBeVisible();
  await shownSettled(welcome);
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // Операция сегодняшнего месяца: «Продукты» 25,00 BYN расходом.
  await page.goto("/operations");
  await page.getByRole("button", { name: "Добавить операцию" }).first().click();
  const form = page.getByRole("dialog", { name: "Новая операция" });
  await expect(form).toBeVisible();
  await form.getByLabel("Сумма, BYN").fill("25,00");
  await form.getByLabel("Контрагент").fill("Евроопт");
  await form.getByPlaceholder("Выберите категорию").click();
  await page.getByRole("option", { name: "Кафе, рестораны и доставка" }).click();
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Евроопт").first()).toBeVisible();

  // DASH-02: на главной — расходы периода, кольцо и динамика; у числа есть ⓘ.
  await page.goto("/home");
  const kpis = page.getByRole("region", { name: "Сводка за период" });
  await expect(kpis).toContainText(/25,00\sBYN/);
  const donut = page.getByRole("region", { name: "Траты по категориям" });
  await expect(donut).toBeVisible();
  await expect(page.getByRole("figure", { name: "Доходы и расходы по месяцам" })).toBeVisible();
  await shownSettled(donut);
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // EXPL-01: ⓘ открывает расчёт расходов с операцией-основанием.
  await page.getByRole("button", { name: "Откуда эта цифра: расходы за период" }).click();
  const why = page.getByRole("dialog", { name: "Откуда эта цифра?" });
  await expect(why).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(why).toHaveCount(0);

  // DASH-03: категория → «Операции» за период с этой категорией.
  await donut
    .getByRole("button", { name: /^Показать операции: / })
    .first()
    .click();
  await expect(page).toHaveURL(/\/operations\?.*category=system%3A/);
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-01/);

  // DASH-01: смена месяца — период в адресе, цифры за прошлый месяц нулевые.
  await page.goto("/home");
  await page.getByRole("button", { name: "Предыдущий месяц" }).click();
  await expect(page).toHaveURL(/\/home\?.*from=\d{4}-\d{2}-01/);
});
