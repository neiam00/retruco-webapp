export function formatRoomCode(value: string): string {
  const characters = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  return characters.length > 4 ? `${characters.slice(0, 4)}-${characters.slice(4)}` : characters;
}

export function formatRoomCodeInput(input: HTMLInputElement): string {
  const caret = formatRoomCode(
    input.value.slice(0, input.selectionStart ?? input.value.length),
  ).length;
  input.value = formatRoomCode(input.value);
  input.setSelectionRange(caret, caret);
  return input.value;
}
