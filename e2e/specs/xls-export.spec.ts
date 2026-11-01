// «Выгрузка в Excel» (XLS-01, XLS-04): свой пользователь → «Операции» без данных (кнопка выключена) → ввод операции → «Выгрузить в Excel» →
// браузер скачивает книгу .xlsx (сигнатура zip, имя с периодом); то же с главной. Содержимое листов и формул — int-тест
// `main/xls-export.int.test.ts` и КП XLS в модуле (HyperFormula); здесь — цепочка «кнопка → сервер → файл» в настоящем браузере.
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("«Выгрузить в Excel»: кнопка выключена без данных, затем скачивает книгу .xlsx", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const email = `xls-${String(Date.now())}@example.test`;
  const password = "кошт2026выгрузка";
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

  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "Операций пока нет" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Выгрузить в Excel" })).toBeDisabled();

  await page.getByRole("button", { name: "Добавить операцию" }).first().click();
  const form = page.getByRole("dialog", { name: "Новая операция" });
  await form.getByLabel("Сумма, BYN").fill("6,50");
  await form.getByLabel("Контрагент").fill("Кофейня «Зерно»");
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Найдено: 1 операция")).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Выгрузить в Excel" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^kosht-\d{4}-\d{2}-01_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const path = await download.path();
  const bytes = await readFile(path);
  // .xlsx — zip-архив: сигнатура «PK», в нём листы; пустой или текстовый ответ ошибки сюда не попадёт.
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  expect(bytes.byteLength).toBeGreaterThan(2000);

  // XLS-01: с главной — тот же файл за период главной.
  await page.goto("/home");
  const [fromHome] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Выгрузить в Excel" }).click(),
  ]);
  expect(fromHome.suggestedFilename()).toMatch(/^kosht-\d{4}-\d{2}-01_\d{4}-\d{2}-\d{2}\.xlsx$/);
});
