// Конец перехода появления перед axe. Mantine начинает переход не в момент монтирования, а кадром позже: проверка
// «нет идущих анимаций» сразу после появления элемента проходит до начала перехода, и axe видит полупрозрачный текст
// (color-contrast) — под нагрузкой это окно шире. Поэтому ждём состояния: элемент со всеми предками непрозрачен и
// ни одна конечная анимация не идёт. Бесконечные (мерцание скелетонов) не кончаются — их не ждём.
import type { Locator } from "@playwright/test";

export async function shownSettled(target: Locator): Promise<void> {
  const handle = await target.elementHandle();
  await target.page().waitForFunction((element) => {
    let opacity = 1;
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity);
    }
    const idle = document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== "running" ||
          animation.effect?.getComputedTiming().iterations === Infinity,
      );
    return opacity === 1 && idle;
  }, handle);
}
