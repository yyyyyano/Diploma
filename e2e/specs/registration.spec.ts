// Регистрация с согласиями → письмо в локальном ящике → подтверждение по ссылке → вход (AUTH-01…03, AUTH-06,
// PRIV-01, PRIV-02, NFR-24). Пользователь свой (email с меткой времени): база стенда общая со сценарием первого
// запуска, ящик — тоже. На /register, /policy, /settings, /mailbox, /verify-email — axe 0 нарушений WCAG 2.2 AA и нет
// горизонтальной прокрутки при 1440 и 390 px.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/** axe и прокрутка при 1440 и 390: нарушения — с размером окна, чтобы было видно, где. */
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

test("регистрация → письмо в ящике → подтверждение → вход; axe 0 на 1440 и 390", async ({
  page,
}) => {
  const email = `reg-${String(Date.now())}@example.test`;
  const password = "кошт2026весна-пароль";
  const own = new URL(test.info().project.use.baseURL ?? "").origin;
  const foreign: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol !== "data:" && url.origin !== own) foreign.push(request.url());
  });

  // PRIV-01: политика открыта гостю.
  await page.goto("/policy");
  await expect(
    page.getByRole("heading", { level: 1, name: "Политика обработки персональных данных" }),
  ).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // AUTH-01, AUTH-02: без согласия на ПД кнопка неактивна.
  await page.goto("/register");
  await expect(page.getByRole("heading", { level: 1, name: "Создайте аккаунт" })).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByLabel("Повторите пароль").fill(password);
  const submit = page.getByRole("button", { name: "Создать аккаунт" });
  await expect(submit).toBeDisabled();
  await page.getByRole("checkbox", { name: /согласен/ }).check();
  await expect(submit).toBeEnabled();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await submit.click();

  // AUTH-03: аккаунт создан, вход уже выполнен — в настройках почта не подтверждена.
  await expect(page.getByRole("heading", { level: 1, name: "Аккаунт создан" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByText("Не подтверждён")).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // AUTH-06: письмо — в локальном ящике (только этот компьютер), ссылка — по адресу локального входа.
  await page.getByRole("link", { name: "Открыть локальный ящик (демо)" }).click();
  await expect(page).toHaveURL(/\/mailbox$/);
  await page.getByRole("button", { name: new RegExp(email) }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Подтвердите адрес электронной почты" }),
  ).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByRole("link", { name: "Подтвердить адрес" }).click();

  await expect(page).toHaveURL(/\/verify-email\?token=/);
  await expect(page.getByText("Адрес подтверждён")).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // Повторный переход по той же ссылке — отказ с понятным сообщением.
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Ссылка уже использована или устарела");

  await page.goto("/settings");
  await expect(page.getByText("Подтверждён", { exact: true })).toBeVisible();

  // Выход — и вход с тем же паролем.
  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  expect(foreign).toEqual([]);
});
