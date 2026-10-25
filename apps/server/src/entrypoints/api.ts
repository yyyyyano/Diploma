// Точка входа api (ARCHITECTURE §3): процедуры oRPC под /api, статика собранного сайта, слушатели local и lan.
// Вся жизнь процесса — в run.ts.
import { runProcess } from "./run.ts";

await runProcess("api");
