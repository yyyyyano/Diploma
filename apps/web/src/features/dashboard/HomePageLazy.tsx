// Главная, подгружаемая отдельным чанком: маршрут импортирует схему адреса из этого же входа, и без `lazy` вся страница
// (диаграммы, карточки, взнос) уехала бы в первую загрузку сайта — бюджет `bundle-size.mjs` (CONSTRAINTS).
import { lazy, Suspense } from "react";
import type { HomeSearch } from "./model/search.ts";

const Page = lazy(() => import("./HomePage.tsx").then((module) => ({ default: module.HomePage })));

export function HomePage({ search }: { readonly search: HomeSearch }) {
  return (
    <Suspense fallback={null}>
      <Page search={search} />
    </Suspense>
  );
}
