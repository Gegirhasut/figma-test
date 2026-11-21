// First-visit helpers: example chips and the one-time hint after the first result.

import { CHIP_SETS, type DemoExample } from './demo-examples';

export interface Chip {
  phrase: string;
  /** Fixed objects, scheme and format; without it the phrase is a plain object list (dictionary, no network). */
  example?: DemoExample;
}

/** Example chips: fixed object sets, so a chip never spends the AI limit. */
export const CHIPS: Chip[] = CHIP_SETS.map((example) => ({ phrase: example.phrase, example }));

/** Plain object lists offered after the AI limit, a timeout or a lost connection — they always work. */
export const LIST_CHIPS: Chip[] = [{ phrase: 'кошелёк, монета' }, { phrase: 'книга, лампа и ручка' }, { phrase: 'наушники и телефон' }];

export const FIRST_RESULT_HINT = 'Объекты на холсте можно двигать, а новые — перетаскивать снизу';

// A new key: the reworded hint is shown once more to browsers that saw the old one.
const HINT_KEY = 'skl_hint2_seen';

/** True only the first time in this browser; storage errors (private mode) count as «seen». */
export function takeFirstHint(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage): boolean {
  try {
    if (!storage || storage.getItem(HINT_KEY)) return false;
    storage.setItem(HINT_KEY, '1');
    return true;
  } catch {
    return false;
  }
}
