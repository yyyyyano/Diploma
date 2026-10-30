// Гость или вошедший: «База законов» открыта всем (LEGAL-11), но гость видит страницу без меню и со ссылками «Войти» и
// «Регистрация». Спрашиваем сессию через кэш (один запрос на всех) — как каркас.
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { sessionQuery } from "../../../lib/session.ts";

export function useViewer() {
  const { session } = useRouter().options.context;
  const query = useQuery(sessionQuery(session));
  // Гость в кэше — null (useQuery не хранит undefined): наружу — undefined.
  return { user: query.data ?? undefined, pending: query.isPending };
}
