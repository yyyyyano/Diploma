// Подтверждение адреса (AUTH-03): страница по ссылке из письма сама шлёт POST identity.verifyEmail один раз (GET ссылки
// ничего не меняет — предпросмотр письма не гасит её). Состояния: идёт проверка, адрес подтверждён, ссылка
// использована или устарела (LINK_INVALID — текст из словаря errors), в адресе нет кода.
import { Button } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { AuthLayout } from "./AuthLayout.tsx";
import layout from "./AuthLayout.module.css";
import type { VerifyEmailSearch } from "./model/verify-search.ts";

export function VerifyEmailPage({ search }: { readonly search: VerifyEmailSearch }) {
  const { t } = useTranslation(["auth", "errors"]);
  const verify = useMutation(orpc.identity.verifyEmail.mutationOptions());
  const sent = useRef(false);
  const { token } = search;
  const { mutate } = verify;

  useEffect(() => {
    // Ссылка одноразовая: повторный эффект (StrictMode, повторная отрисовка) не должен гасить её второй раз.
    if (token === undefined || sent.current) return;
    sent.current = true;
    mutate({ token });
  }, [token, mutate]);

  let body;
  if (token === undefined) {
    body = (
      <p className={layout.error} role="alert">
        <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
        {t("auth:verify.noToken")}
      </p>
    );
  } else if (verify.isSuccess) {
    body = (
      <output className={layout.ok}>
        <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
        <span>
          <strong>{t("auth:verify.done")}.</strong> {t("auth:verify.doneText")}
        </span>
      </output>
    );
  } else if (verify.isError) {
    body = (
      <p className={layout.error} role="alert">
        <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
        <span>
          <strong>{t("auth:verify.failed")}.</strong>{" "}
          {t(`errors:${errorCodeOf(verify.error)}`, errorParamsOf(verify.error))}
        </span>
      </p>
    );
  } else {
    body = (
      <output className={layout.subtitle} aria-busy="true">
        {t("auth:verify.checking")}
      </output>
    );
  }

  return (
    <AuthLayout>
      <div className={layout.card}>
        <div className={layout.heading}>
          <h1 className={layout.title}>{t("auth:verify.title")}</h1>
        </div>
        {body}
        {(token === undefined || verify.isSuccess || verify.isError) && (
          <Button component={Link} to="/" size="md" fullWidth>
            {t("auth:verify.toApp")}
          </Button>
        )}
      </div>
    </AuthLayout>
  );
}
