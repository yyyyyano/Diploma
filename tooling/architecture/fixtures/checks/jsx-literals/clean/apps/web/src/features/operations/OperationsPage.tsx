// Комментарий «Операции» — не текст интерфейса.
export function OperationsPage({ t, total }: Props) {
  return (
    <Stack gap="md" className="page" data-testid="operations">
      <Title order={2}>{t("operations:title")}</Title>
      <Text>{t("operations:found", { count: total })} — {total} %</Text>
      <TextInput label={t("operations:search")} placeholder={t("operations:searchHint")} />
      <img alt="" src="/logo.svg" />
      <span aria-hidden="true">·</span>
      <span>&nbsp;/&nbsp;(1)</span>
    </Stack>
  );
}
