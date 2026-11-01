// Карточка результата `export_excel` (XLS-01, AGT-03, CHAT-04): «Файл Excel за период» и ссылка «Скачать». Данные — как их вернул
// инструмент (период и число операций посчитал сервер, P1); ссылка ведёт на тот же сервер, файл собирается при открытии.
import { XlsExportLink } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import { Button } from "@mantine/core";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import classes from "./cards.module.css";
import { Unavailable } from "./Unavailable.tsx";

export function ExcelCard({ output }: { readonly output: unknown }) {
  const { t } = useTranslation("assistant");
  const parsed = XlsExportLink.safeParse(output);
  if (!parsed.success) return <Unavailable />;
  const { from, to, operations, url } = parsed.data;
  return (
    <div className={classes.card}>
      <p className={classes.title}>
        {t("cards.excel.title", { from: formatDate(from), to: formatDate(to) })}
      </p>
      <p className={classes.small}>{t("cards.excel.operations", { count: operations })}</p>
      <div className={classes.buttons}>
        <Button
          component="a"
          size="xs"
          href={url}
          download
          leftSection={<Download size={16} aria-hidden />}
        >
          {t("cards.excel.download")}
        </Button>
      </div>
    </div>
  );
}
