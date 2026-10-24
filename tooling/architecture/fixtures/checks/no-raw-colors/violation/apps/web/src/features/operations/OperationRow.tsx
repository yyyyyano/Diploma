export function OperationRow({ t }: Props) {
  return (
    <Group p={13} gap="12px" style={{ padding: 13, borderRadius: "6px", color: "#11564D" }}>
      <Text c="rgb(17, 86, 77)">{t("operations:row.title")}</Text>
      <Badge color={`hsl(170 67% 20%)`} radius={4} />
      <Box style={{ background: "#fff8", marginTop: -8 }} />
    </Group>
  );
}
