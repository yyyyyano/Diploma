export function OperationsPage({ total }: Props) {
  return (
    <Stack>
      <Title>Операции</Title>
      <Text>{"Найдено"} {total}</Text>
      <TextInput label="Поиск" placeholder={`Например, такси`} />
      <ActionIcon aria-label={"Удалить"} title='Удалить операцию'>
        <TrashIcon />
      </ActionIcon>
      <img alt="Логотип" src="/logo.svg" />
      <Badge>BYN</Badge>
    </Stack>
  );
}
