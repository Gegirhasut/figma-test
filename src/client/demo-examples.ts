// Fixed phrase sets for the home page: the demo and the example chips. The
// objects are decided in advance, so these never call the AI endpoint and never
// spend the visitor's AI limit, and each phrase honestly matches its objects.
// Every set was checked by eye under the depth rules
// (`npm run checks -- --demo` renders them to build/checks/).

import type { Format, ObjectRequest } from '../shared/types';

export interface DemoExample {
  phrase: string;
  objects: ObjectRequest[];
  scheme: 'lilac' | 'peach' | 'teal';
  format: Format;
  variant: number;
}

export const FIXED_SETS: DemoExample[] = [
  {
    phrase: 'Вечер с книгой',
    objects: [
      { id: 'book', role: 'main' },
      { id: 'lamp', role: 'main' },
      { id: 'flower', role: 'background' },
    ],
    scheme: 'lilac',
    format: 'horizontal',
    variant: 2,
  },
  {
    phrase: 'Коплю деньги',
    objects: [
      { id: 'wallet', role: 'main' },
      { id: 'coin', role: 'main' },
    ],
    scheme: 'peach',
    format: 'horizontal',
    variant: 0,
  },
  {
    phrase: 'Слушаю подкаст',
    objects: [
      { id: 'headphones', role: 'main' },
      { id: 'phone', role: 'main' },
    ],
    scheme: 'teal',
    format: 'horizontal',
    variant: 0,
  },
  {
    phrase: 'Готовлюсь к экзамену',
    objects: [
      { id: 'book', role: 'main' },
      { id: 'pen', role: 'main' },
      { id: 'lamp', role: 'background' },
    ],
    scheme: 'lilac',
    format: 'horizontal',
    variant: 2,
  },
  {
    phrase: 'Разбираю документы',
    objects: [
      { id: 'folder', role: 'main' },
      { id: 'pen', role: 'main' },
    ],
    scheme: 'peach',
    format: 'horizontal',
    variant: 0,
  },
];

const normalise = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е').replace(/[.!?…]+$/, '').replace(/\s+/g, ' ');

/** The fixed set for a phrase typed by hand, if it is one of the example phrases (case, «ё» and spaces ignored). */
export function findFixedSet(phrase: string): DemoExample | undefined {
  const key = normalise(phrase);
  return FIXED_SETS.find((s) => normalise(s.phrase) === key);
}

/** The one composition the home page types and assembles on first open. */
export const DEMO_EXAMPLE = FIXED_SETS[0];

/** Example chips under the input (a phone shows only the first two). */
export const CHIP_SETS = FIXED_SETS.slice(0, 3);
