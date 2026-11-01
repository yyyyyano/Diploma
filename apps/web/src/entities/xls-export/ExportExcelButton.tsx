// «Выгрузить в Excel» (XLS-01, design/screens/Operations.dc.html): ссылка-кнопка на `GET /api/xls-export` — браузер сам скачивает
// файл с cookie сессии (как «Исходный файл» у импорта); файл собирается на сервере при открытии ссылки. Период — `from`…`to`;
// не задан — сервер берёт текущий месяц. Нет данных — кнопка выключена (настоящая `button`, а не ссылка без перехода).
import { Button } from "@mantine/core";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { API_PREFIX } from "../../lib/api.ts";

export interface ExportExcelButtonProps {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly disabled?: boolean;
}

export function ExportExcelButton({ from, to, disabled = false }: ExportExcelButtonProps) {
  const { t } = useTranslation("common");
  const icon = <Download size={18} aria-hidden />;
  if (disabled) {
    return (
      <Button variant="default" leftSection={icon} disabled>
        {t("exportExcel")}
      </Button>
    );
  }
  const query = new URLSearchParams();
  if (from !== undefined) query.set("from", from);
  if (to !== undefined) query.set("to", to);
  const text = query.toString();
  return (
    <Button
      component="a"
      variant="default"
      leftSection={icon}
      href={`${API_PREFIX}/xls-export${text === "" ? "" : `?${text}`}`}
      download
    >
      {t("exportExcel")}
    </Button>
  );
}
