// Ошибка экрана (DES-16, design/DESIGN.md §5): что случилось и что сделать — «Данные целы, попробуйте ещё раз».
// Граница ошибок роутера (defaultErrorComponent): падение одной страницы не роняет каркас и меню.
import { Button } from "@mantine/core";
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { CircleAlert, SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../ui/index.ts";
import classes from "./screens.module.css";

export function ErrorScreen({ reset }: ErrorComponentProps) {
  const { t } = useTranslation("shell");
  const router = useRouter();
  return (
    <div className={classes.screen}>
      <EmptyState
        icon={CircleAlert}
        tone="error"
        headingLevel={1}
        title={t("error.title")}
        description={t("error.description")}
        actions={
          <Button
            onClick={() => {
              reset();
              void router.invalidate();
            }}
          >
            {t("error.retry")}
          </Button>
        }
      />
    </div>
  );
}

export function NotFoundScreen() {
  const { t } = useTranslation("shell");
  return (
    <div className={classes.screen}>
      <EmptyState
        icon={SearchX}
        headingLevel={1}
        title={t("notFound.title")}
        description={t("notFound.description")}
      />
    </div>
  );
}
