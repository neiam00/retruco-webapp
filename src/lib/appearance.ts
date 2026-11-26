export interface Appearance {
  base: number;
  hair: number;
  hat: number;
  glasses: number;
  skin: number;
  shirt: number;
}

export const appearanceFields = [
  { key: 'base', label: 'Modelo', options: ['Modelo 1', 'Modelo 2', 'Modelo 3', 'Modelo 4'] },
  {
    key: 'hair',
    label: 'Peinado',
    options: ['Sin cabello', 'Corto', 'Ondulado', 'Con raya', 'Rizado'],
  },
  { key: 'hat', label: 'Sombrero', options: ['Sin sombrero', 'Gorra', 'Boina', 'De ala'] },
  { key: 'glasses', label: 'Gafas', options: ['Sin gafas', 'De sol', 'Redondas'] },
  {
    key: 'skin',
    label: 'Tono de piel',
    options: ['Claro', 'Cálido', 'Canela', 'Cobre', 'Moreno', 'Oscuro'],
  },
  {
    key: 'shirt',
    label: 'Camisa',
    options: ['Crema', 'Teja', 'Verde', 'Pizarra', 'Mostaza', 'Azul noche', 'Malva', 'Arena'],
  },
] as const;

export function defaultAppearance(seat = 0): Appearance {
  const base = ((seat % 4) + 4) % 4;
  return { base, hair: base + 1, skin: base + 1, shirt: base, hat: 0, glasses: 0 };
}
