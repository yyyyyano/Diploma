// Карточка «Могу ли я позволить покупку?» на главной (design/screens/Main.dc.html .dash-aff, AFF-01, DASH-02): сумма и кнопка ведут на
// экран сценариев с этой суммой (`?sum=`). Расчёта здесь нет — три сценария считает сервер на экране покупки (P1).
import { Button, TextInput } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAffordTexts } from "../../entities/afford/index.ts";
import classes from "./AffordPromo.module.css";

export function AffordPromo() {
  useAffordTexts();
  const { t } = useTranslation("afford");
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    // Целое число рублей (пробелы разрядов не мешают) уходит в адрес; иное — экран откроется с пустой суммой.
    const digits = text.replaceAll(/\s/gu, "");
    void navigate({
      to: "/afford",
      search: /^\d{1,7}$/u.test(digits) ? { sum: digits } : {},
    });
  };
  return (
    <section className={classes.promo} aria-labelledby="home-afford">
      <div className={classes.head}>
        <ShoppingBag size={22} strokeWidth={1.8} aria-hidden />
        <h2 className={classes.title} id="home-afford">
          {t("home.title")}
        </h2>
      </div>
      <p className={classes.text}>{t("home.text")}</p>
      <form className={classes.form} onSubmit={submit}>
        <TextInput
          className={classes.field}
          label={t("home.sum")}
          placeholder={t("form.sumPlaceholder")}
          inputMode="decimal"
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          classNames={{ label: classes.label }}
        />
        <Button type="submit" variant="white">
          {t("home.submit")}
        </Button>
      </form>
    </section>
  );
}
