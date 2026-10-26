// Вид файла домохозяйства (PRIV-05, RCPT-11, STMT-10): архив «Мои данные», фото чека, выписка.
export const FILE_KINDS = ["data-export", "receipt-photo", "statement"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
