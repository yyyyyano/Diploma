// Части каркаса сайта (DES-15): представление; пункты меню, пользователя и переходы подставляет app/shell.
export { AppFrame, type AppFrameProps } from "./AppFrame.tsx";
export { BottomNav, type BottomNavProps } from "./BottomNav.tsx";
export { initials, SideNav, type SideNavProps } from "./SideNav.tsx";
export type { NavigateHandler, ShellNavGroup, ShellNavItem, ShellUser } from "./types.ts";
