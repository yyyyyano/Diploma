// Адрес экрана «Чеки и документы»: `import` — открытый импорт выписки (STMT-10: из карточки операции открывают импорт,
// из которого она пришла). Неверное значение отбрасывается (`catch`): адрес, набранный руками, не ломает экран.
import { z } from "zod";

export const DocumentsSearch = z.object({
  import: z.uuid().optional().catch(undefined),
});
export type DocumentsSearch = z.infer<typeof DocumentsSearch>;
