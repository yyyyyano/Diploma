// Витрина дизайн-системы /dev/gallery (ADR-0013 — вместо Storybook): каждый компонент ui/ во всех состояниях и
// части каркаса как демо без входа — по ней make e2e прогоняет axe при 1440 и 390 px. Только разработка и сборка
// --mode e2e (vite.config.ts). Тексты — демонстрационные литералы: витрина не продукт, словарь им не нужен.
import { Button } from "@mantine/core";
import { Money as M } from "@kosht/kernel";
import {
  ArrowLeftRight,
  Bot,
  CalendarDays,
  Camera,
  CircleAlert,
  CircleCheck,
  Coins,
  LayoutGrid,
  MessageCircle,
  Receipt,
  Repeat,
  Scale,
  Scale3d,
  ShoppingBag,
  SlidersHorizontal,
  Target,
  TriangleAlert,
  Wallet,
  Shield,
  Brain,
  Sparkles,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  ConfirmDialog,
  EmptyState,
  Formula,
  Logo,
  Money,
  PageHeader,
  Sheet,
  SkeletonCard,
  SkeletonList,
  SkeletonText,
  StatCard,
  StatusBadge,
  UndoToast,
  WhyButton,
} from "../../ui/index.ts";
import { BottomNav, SideNav, type ShellNavGroup, type ShellNavItem } from "../../ui/shell/index.ts";
import classes from "./GalleryPage.module.css";

const byn = (minor: number) => M.of(minor, "BYN");

function item(
  key: string,
  label: string,
  icon: ShellNavItem["icon"],
  active = false,
): ShellNavItem {
  return { key, label, href: `#${key}`, icon, active };
}

/** Меню DES-15 целиком — как у администратора со всеми готовыми разделами. */
const DEMO_NAV: ShellNavGroup[] = [
  {
    key: "main",
    items: [
      item("dashboard", "Главная", LayoutGrid, true),
      item("assistant", "Ассистент", MessageCircle),
    ],
  },
  {
    key: "money",
    label: "Деньги",
    items: [
      item("operations", "Операции", ArrowLeftRight),
      item("documents", "Чеки и документы", Receipt),
      item("accounts", "Счета", Wallet),
      item("recurring", "Регулярные платежи", Repeat),
      item("budget", "Лимиты и цели", Target),
      item("calendar", "Календарь", CalendarDays),
    ],
  },
  {
    key: "law",
    label: "Право и выгода",
    items: [
      item("deductions", "Налоговые вычеты", Coins),
      item("afford", "Крупная покупка", ShoppingBag),
      item("laws", "База законов", Scale),
    ],
  },
  {
    key: "profile",
    label: "Профиль",
    items: [
      item("memory", "Что ассистент знает", Brain),
      item("settings", "Настройки", SlidersHorizontal),
      item("admin", "Администрирование", Shield),
    ],
  },
];

const DEMO_ITEMS = DEMO_NAV.flatMap((group) => group.items);
/** Нижняя панель телефона по DES-15: Главная · Операции · (Чек) · Ассистент. */
const PHONE_TABS = ["dashboard", "operations", "assistant"];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={classes.section} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={classes.sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function State({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={classes.state}>
      <span className={classes.stateLabel}>{label}</span>
      {children}
    </div>
  );
}

export function GalleryPage() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirm, setConfirm] = useState<"primary" | "danger" | undefined>();
  const [toastOpen, setToastOpen] = useState(false);
  const [lastAction, setLastAction] = useState("—");

  return (
    <main className={classes.page}>
      <PageHeader
        title="Витрина дизайн-системы"
        subtitle="«Пуща и янтарь»: компоненты ui/ во всех состояниях"
        actions={
          <Button leftSection={<Camera size={18} aria-hidden />} onClick={() => setToastOpen(true)}>
            Показать уведомление
          </Button>
        }
      />
      <div className={classes.body}>
        <Section id="money" title="Money — суммы (DES-17)">
          <div className={classes.row}>
            <State label="без смысла">
              <Money value={byn(123_456)} />
            </State>
            <State label="доход">
              <Money value={byn(97_240)} kind="income" />
            </State>
            <State label="расход">
              <Money value={byn(3290)} kind="expense" />
            </State>
            <State label="перевод">
              <Money value={byn(10_000)} kind="transfer" />
            </State>
            <State label="отрицательная, USD">
              <Money value={M.of(-84_000, "USD")} />
            </State>
            <State label="крупное число">
              <Money value={byn(498_964)} size="kpi" />
            </State>
          </div>
          <table className={classes.table}>
            <caption className={classes.caption}>
              Табличные цифры (tabular) — суммы стоят ровно
            </caption>
            <thead>
              <tr>
                <th scope="col">Операция</th>
                <th scope="col">Сумма</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Зарплата</td>
                <td>
                  <Money value={byn(144_000)} kind="income" tabular />
                </td>
              </tr>
              <tr>
                <td>Интернет и ТВ</td>
                <td>
                  <Money value={byn(3290)} kind="expense" tabular />
                </td>
              </tr>
              <tr>
                <td>Перевод на накопительный</td>
                <td>
                  <Money value={byn(111_111)} kind="transfer" tabular />
                </td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section id="why" title="WhyButton и Formula — «Откуда эта цифра?»">
          <div className={classes.row}>
            <State label="кнопка ⓘ">
              <span className={classes.inline}>
                Свободный остаток{" "}
                <WhyButton subject="Свободный остаток" onClick={() => setSheetOpen(true)} />
              </span>
            </State>
          </div>
          <Formula
            rows={[
              {
                id: "income",
                label: "Средний доход за 3 месяца",
                value: <Money value={byn(240_000)} />,
              },
              {
                id: "obligations",
                label: "Обязательные платежи",
                value: <Money value={byn(67_777)} />,
              },
            ]}
            total={{
              id: "free",
              label: "Свободный остаток",
              value: <Money value={byn(172_223)} />,
            }}
          />
        </Section>

        <Section id="badges" title="StatusBadge — статусы (всегда с иконкой)">
          <div className={classes.row}>
            <StatusBadge tone="ok" icon={CircleCheck}>
              Сумма сходится 100%
            </StatusBadge>
            <StatusBadge tone="warn" icon={TriangleAlert}>
              Требует проверки
            </StatusBadge>
            <StatusBadge tone="danger" icon={CircleAlert}>
              Превышен на 12,40
            </StatusBadge>
            <StatusBadge tone="law" icon={Scale3d}>
              ст. 210 НК
            </StatusBadge>
            <StatusBadge tone="amber" icon={Sparkles}>
              Можно вернуть
            </StatusBadge>
            <StatusBadge tone="neutral" icon={Bot}>
              Предположение
            </StatusBadge>
            <StatusBadge tone="brand" icon={Wallet}>
              Счёт · 5530
            </StatusBadge>
          </div>
        </Section>

        <Section id="logo" title="Logo — знак и название">
          <div className={classes.row}>
            <Logo />
            <span className={classes.darkSwatch}>
              <Logo on="dark" />
            </span>
          </div>
        </Section>

        <Section id="stat" title="StatCard — показатели (DES-13)">
          <div className={classes.grid}>
            <StatCard
              title="На счетах"
              value={<Money value={byn(498_964)} size="kpi" />}
              hint="5 счетов · на 21.10"
              why={<WhyButton subject="На счетах" onClick={() => setSheetOpen(true)} />}
            />
            <StatCard
              title="Доходы за месяц"
              value={<Money value={byn(97_240)} kind="income" size="kpi" />}
              hint="Ожидается ещё 1 440,00"
            />
            <StatCard
              title="Свободный остаток"
              tone="free"
              value={<Money value={byn(172_223)} size="kpi" />}
              hint="Остаётся после обязательных платежей"
              why={<WhyButton subject="Свободный остаток" onClick={() => setSheetOpen(true)} />}
            />
            <StatCard
              title="Можно вернуть"
              tone="benefit"
              value={<Money value={byn(26_000)} size="kpi" />}
              hint="Социальный вычет на обучение"
            />
          </div>
        </Section>

        <Section id="states" title="Состояния экрана (DES-16)">
          <div className={classes.grid}>
            <State label="загрузка: карточка">
              <SkeletonCard />
            </State>
            <State label="загрузка: список">
              <SkeletonList rows={3} />
            </State>
            <State label="загрузка: текст">
              <SkeletonText lines={3} />
            </State>
          </div>
          <div className={classes.grid}>
            <EmptyState
              icon={Receipt}
              headingLevel={3}
              title="Чеков пока нет"
              description="Сфотографируйте чек — Кошт разберёт позиции и сверит сумму."
              actions={<Button>Сканировать чек</Button>}
            />
            <EmptyState
              icon={CircleAlert}
              tone="error"
              headingLevel={3}
              title="Выписка не загрузилась"
              description="Файл не похож на выписку банка. Данные целы — попробуйте другой файл."
              actions={<Button variant="default">Выбрать файл</Button>}
            />
          </div>
        </Section>

        <Section id="overlays" title="Панели и подтверждения (P5)">
          <div className={classes.row}>
            <Button onClick={() => setSheetOpen(true)}>Открыть панель</Button>
            <Button variant="default" onClick={() => setConfirm("primary")}>
              Подтверждение
            </Button>
            <Button variant="default" onClick={() => setConfirm("danger")}>
              Подтверждение удаления
            </Button>
            <Button variant="default" onClick={() => setToastOpen(true)}>
              Уведомление с отменой
            </Button>
          </div>
          <p className={classes.note}>Последнее действие: {lastAction}</p>
        </Section>

        <Section id="shell" title="Каркас — меню (DES-15)">
          <div className={classes.shellDemo}>
            <SideNav
              groups={DEMO_NAV}
              homeHref="#dashboard"
              user={{ name: "Ирина Ковальчук", email: "демо-пользователь" }}
              onLogout={() => setLastAction("Выход")}
            />
          </div>
        </Section>

        <Section id="phone" title="Каркас — нижняя панель телефона">
          <div className={classes.phoneDemo}>
            <BottomNav
              embedded
              tabs={PHONE_TABS.flatMap((key) => DEMO_ITEMS.filter((nav) => nav.key === key))}
              more={DEMO_ITEMS.filter((nav) => !PHONE_TABS.includes(nav.key))}
              center={
                <a className={classes.scan} href="#documents" aria-label="Сканировать чек">
                  <span className={classes.scanIcon} aria-hidden>
                    <Camera size={24} strokeWidth={1.8} />
                  </span>
                  Чек
                </a>
              }
            />
          </div>
        </Section>
      </div>

      <Sheet opened={sheetOpen} onClose={() => setSheetOpen(false)} title="Свободный остаток">
        <Formula
          rows={[
            { id: "income", label: "Средний доход", value: <Money value={byn(240_000)} /> },
            {
              id: "obligations",
              label: "Обязательные платежи",
              value: <Money value={byn(67_777)} />,
            },
          ]}
          total={{ id: "free", label: "Свободный остаток", value: <Money value={byn(172_223)} /> }}
        />
        <p className={classes.note}>
          Все суммы посчитаны программой по вашим операциям, а не нейросетью.
        </p>
      </Sheet>
      <ConfirmDialog
        opened={confirm !== undefined}
        title={confirm === "danger" ? "Удалить 3 операции?" : "Перенести 13 операций?"}
        confirmLabel={confirm === "danger" ? "Да, удалить 3" : "Да, перенести 13"}
        tone={confirm ?? "primary"}
        onConfirm={() => {
          setLastAction(confirm === "danger" ? "Удалено 3" : "Перенесено 13");
          setConfirm(undefined);
        }}
        onCancel={() => setConfirm(undefined)}
      >
        <ul className={classes.list}>
          <li>Категория «Такси» → «Транспорт»</li>
          <li>Отменить можно в истории изменений</li>
        </ul>
      </ConfirmDialog>
      <UndoToast
        opened={toastOpen}
        message="Записал в «Такси»"
        onUndo={() => setLastAction("Отменено")}
        onClose={() => setToastOpen(false)}
      />
    </main>
  );
}
