// SEC-03: имя файла из запроса — только метаданные. Перед сохранением оно очищается: без пути, управляющих символов и
// знаков, запрещённых в именах файлов; длина ограничена с сохранением расширения.
import { describe, expect, it } from "vitest";
import { safeFileName } from "./file-name.ts";

describe("SEC-03: safeFileName", () => {
  it("путь отбрасывается: остаётся только имя", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\ira\\Выписка.pdf")).toBe("Выписка.pdf");
  });

  it("управляющие символы и запрещённые знаки заменяются подчёркиванием, кириллица остаётся", () => {
    expect(safeFileName('чек\u0000 "Евроопт"<1>.jpg')).toBe("чек_ _Евроопт__1_.jpg");
  });

  it("пустое имя или одни точки — «file»", () => {
    expect(safeFileName("   ")).toBe("file");
    expect(safeFileName("..")).toBe("file");
  });

  it("длинное имя укорачивается до 120 символов, расширение сохраняется", () => {
    const name = safeFileName(`${"а".repeat(300)}.xlsx`);
    expect(name).toHaveLength(120);
    expect(name.endsWith(".xlsx")).toBe(true);
  });
});
