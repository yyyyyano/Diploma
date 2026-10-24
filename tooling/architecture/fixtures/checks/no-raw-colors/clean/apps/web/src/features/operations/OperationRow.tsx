// Цвет — токеном, а не #11564D; отступы — шкалой темы.
export function OperationRow({ t }: Props) {
  const anchor = "#bad-anchor";
  return (
    <Group p="md" gap="sm" style={{ padding: 0, margin: "0 auto", zIndex: 10, lineHeight: 1.4 }}>
      <a href="#main">{t("common:skip")}</a>
      <Text c="var(--ink)" fw={600}>{t("operations:row.title", { anchor })}</Text>
    </Group>
  );
}
