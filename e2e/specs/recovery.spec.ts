// Восстановление доступа (AUTH-04, AUTH-06, AUTH-08, КП AUTH): свой пользователь → выход → «Забыли пароль?» → письмо
// в локальном ящике → новый пароль по ссылке → повтор той же ссылки — отказ с понятным сообщением → вход с новым
// паролем. axe 0 нарушений WCAG 2.2 AA и нет горизонтальной прокрутки при 1440 и 390 на /login, /recovery (все три
// вида) и /settings.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

async function accessibleAtBothWidths(page: Page) {
  const problems: unknown[] = [];
  for (const size of VIEWPORTS) {
    await page.setViewportSize(size);
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

test("забыл пароль → письмо в ящике → новый пароль → вход; повтор ссылки — отказ; axe 0", async ({
  page,
}) => {
  const email = `forgot-${String(Date.now())}@example.test`;
  const oldPassword = "старый-пароль-2026";
  const newPassword = "новый-пароль-2026-весна";

  // Свой пользователь: регистрация, затем выход из настроек.
  await page.goto("/register");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(oldPassword);
  await page.getByLabel("Повторите пароль").fill(oldPassword);
  await page.getByRole("checkbox", { name: /согласен/ }).check();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Аккаунт создан" })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 2, name: "Пароль" })).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByRole("button", { name: "Выйти из аккаунта" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // Вход с кодом восстановления — свой вид страницы.
  await page.getByRole("link", { name: "Войти с кодом восстановления" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Вход с кодом восстановления" }),
  ).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // AUTH-04: «Забыли пароль?» → «Проверьте почту».
  await page.goto("/login");
  await page.getByRole("link", { name: "Забыли пароль?" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Восстановление пароля" }),
  ).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByRole("textbox", { name: "Email аккаунта" }).fill(email);
  await page.getByRole("button", { name: "Отправить ссылку" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Проверьте почту" })).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // AUTH-06: письмо сброса — в локальном ящике.
  await page.getByRole("link", { name: "Открыть локальный почтовый ящик (демо)" }).click();
  await page.getByRole("button", { name: new RegExp(`${email}[\\s\\S]*Сброс пароля`) }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Сброс пароля" })).toBeVisible();
  await page.getByRole("link", { name: "Задать новый пароль" }).click();

  // Новый пароль по ссылке.
  await expect(page).toHaveURL(/\/recovery\?token=/);
  await expect(page.getByRole("heading", { level: 1, name: "Задайте новый пароль" })).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByLabel("Новый пароль").fill(newPassword);
  await page.getByLabel("Повторите пароль").fill(newPassword);
  await page.getByRole("button", { name: "Сохранить пароль" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Пароль изменён" })).toBeVisible();

  // КП AUTH: повторное использование ссылки — отказ с понятным сообщением.
  await page.reload();
  await page.getByLabel("Новый пароль").fill("третий-пароль-2026");
  await page.getByLabel("Повторите пароль").fill("третий-пароль-2026");
  await page.getByRole("button", { name: "Сохранить пароль" }).click();
  await expect(page.getByRole("alert")).toContainText("Ссылка уже использована или устарела");

  // Вход с новым паролем; старый не подходит.
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(oldPassword);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByRole("alert")).toContainText("Неверный email или пароль");
  await page.getByLabel("Пароль", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Войти" }).click();
  // AUTH-07: после первого входа — анкета на 1 минуту; её можно пропустить.
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Пропустить анкету" }).click();
  await expect(page).toHaveURL(/\/home$/);
});
