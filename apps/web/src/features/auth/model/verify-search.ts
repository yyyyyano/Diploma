// Адрес страницы подтверждения: token — код из письма; нет или не той формы — страница так и скажет.
import { LinkToken } from "@kosht/contract";
import { z } from "zod";

export const VerifyEmailSearch = z.object({
  token: LinkToken.optional().catch(undefined),
});
export type VerifyEmailSearch = z.infer<typeof VerifyEmailSearch>;
