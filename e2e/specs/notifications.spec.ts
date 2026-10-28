// Колокольчик уведомлений и их настройки (NOTIF-01, NOTIF-04): свой пользователь → колокольчик в каркасе, список
// открывается; вкладка «Уведомления» в настройках — переключатель сохраняется и переживает перезагрузку. axe 0
// нарушений WCAG 2.2 AA и нет горизонтальной прокрутки при 1440 и 390 с открытым списком и на /settings?tab=notifications.
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

test("колокольчик со списком и настройки уведомлений; axe 0 на 1440 и 390", async ({ page }) => {
  const email = `bell-${String(Date.now())}@example.test`;
  const password = "кошт2026колокольчик";
  await page.goto("/register");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByLabel("Повторите пароль").fill(password);
  await page.getByRole("checkbox", { name: /согласен/ }).check();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  // NOTIF-01: колокольчик в каркасе; список открывается.
  for (const size of VIEWPORTS) {
    await page.setViewportSize(size);
    await page.getByRole("button", { name: /^Уведомления/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Уведомления" })).toBeVisible();
    await expect(page.getByText(/Уведомлений пока нет/)).toBeVisible();
    // Список появляется с переходом прозрачности: axe посреди перехода видит бледный текст (под нагрузкой
    // параллельных сценариев переход дольше) — ждём конца переходов, а после — закрытия списка.
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== "running"),
    );
    const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(result.violations.map((v) => ({ width: size.width, id: v.id }))).toEqual([]);
    // Список закрывается тем же колокольчиком (Escape его сейчас не закрывает — см. итог T-016).
    await page.getByRole("button", { name: /^Уведомления/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Уведомления" })).toBeHidden();
  }
  await page.setViewportSize(VIEWPORTS[0]);

  // NOTIF-04: настройки по видам — переключатель сохраняется сразу.
  await page.getByRole("button", { name: /^Уведомления/ }).click();
  await page.getByRole("link", { name: "Настроить уведомления" }).click();
  await expect(page).toHaveURL(/\/settings\?tab=notifications$/);
  const limitWeb = page.getByRole("switch", { name: "Лимит: 80% и 100% — На сайте" });
  await expect(limitWeb).toBeChecked();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await limitWeb.click();
  await expect(limitWeb).not.toBeChecked();
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Лимит: 80% и 100% — На сайте" }),
  ).not.toBeChecked();
});
