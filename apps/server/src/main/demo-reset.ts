// `make demo-reset` (DEMO-03): пересоздать данные демо-пользователя из терминала — тот же `recreate`, что у кнопки в админке.
// Корень композиции роли api без слушателей: очередь запускает точка входа (`startJobs`), чтобы события записи (пересчёт регулярных
// платежей, календаря, вычетов) встали в очередь — их обработает worker (`make dev` или `make up`); модели не вызываются.
import type { GenerateReport } from "../modules/demo/application/generate.ts";
import type { DemoFacade } from "../modules/demo/index.ts";
import type { Composition } from "./compose.ts";

export async function recreateDemoData(app: Composition): Promise<GenerateReport> {
  const demo = app.modules.find((module) => module.id === "demo")?.facade as DemoFacade | undefined;
  if (demo === undefined) throw new Error("В корне композиции нет модуля demo.");
  return demo.recreate();
}
