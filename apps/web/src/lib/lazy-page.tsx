// Страница отдельным чанком. Маршрут берёт схему адреса из публичного входа экрана, а `validateSearch` и `loader`
// по документации TanStack Router остаются в главном бандле: если вход реэкспортирует саму страницу, она (вместе с
// диаграммами, формами, Mantine) уезжает в первую загрузку сайта — бюджет `bundle-size.mjs` (CONSTRAINTS). Поэтому
// вход экрана реэкспортирует страницу через `lazyPage(() => import("./X.tsx"), "X")`: чанк страницы грузится при первом
// показе маршрута.
import { type ComponentType, lazy, type ReactElement, Suspense } from "react";

/** Свойства страницы — те же, что у настоящей. */
type PropsOf<Page> = Page extends ComponentType<infer Props> ? Props : never;

/** Ленивая страница: пока чанк грузится — пусто (скелетоны рисует сама страница). */
export function lazyPage<Module, Name extends keyof Module>(
  load: () => Promise<Module>,
  name: Name,
): (props: PropsOf<Module[Name]>) => ReactElement {
  const Page = lazy(() =>
    load().then((module) => ({ default: module[name] as ComponentType<object> })),
  );
  return function LazyPage(props: PropsOf<Module[Name]>) {
    return (
      <Suspense fallback={null}>
        <Page {...(props as object)} />
      </Suspense>
    );
  };
}
