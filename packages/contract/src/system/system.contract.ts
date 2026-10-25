// Процедура «жив ли сервер» для сайта и тестов (ARCHITECTURE §9). Проба контейнера — HTTP `/healthz` платформы
// (T-059); эта процедура её не заменяет. Доступ — publicProc: ставит сервер (T-059), в контракте доступа нет.
import { oc } from "@orpc/contract";
import { z } from "zod";

export const systemContract = {
  health: oc
    .route({ method: "GET", path: "/system/health" })
    .output(z.strictObject({ status: z.literal("ok") })),
};
