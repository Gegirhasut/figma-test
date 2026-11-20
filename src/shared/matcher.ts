// Dictionary interpretation of a phrase — no network.
//
// Scenario 2 («кошелёк, монета»): every meaningful word names a library
// object → the phrase is fully understood locally.
// Scenario 1 fallback («копим на отпуск» without an LLM): meaning tags pick
// the objects that fit best.
//
// Russian word forms are handled by a light suffix stemmer plus tolerant
// comparison (prefix and one-letter edit for longer stems, which also covers
// fleeting vowels: кошелёк / кошелька).

import { CATALOG, type CatalogEntry, type ObjectId } from './catalog';
import type { ObjectRequest } from './types';

const STOP = new Set(
  'и или а но на в во с со к ко по за из изо для от до о об обо у не ни мы я вы ты он она оно они это эта этот эти как что чтобы наш наша наше наши мой моя моё мое мои твой свой своя свои все всё еще ещё уже очень будет быть есть то же ли бы без при про через над под перед между плюс также тоже вот где когда там тут сам сама сами нам нас вам вас им их его ее её and the a an of with for to in on'.split(' '),
);

const NUMERALS: Record<string, number> = {
  один: 1, одна: 1, одну: 1, одно: 1,
  два: 2, две: 2, пара: 2, пару: 2,
  три: 3, четыре: 4, пять: 5,
  несколько: 3, много: 4,
};
/** Most copies one word can ask for («пять монет», «12 монет» → 5). */
const MAX_COUNT = 5;

const BACKGROUND_WORDS = [
  'фон', 'фоне', 'фоном', 'фоновый', 'фоновая', 'фоновое', 'фоновые', 'фоновым', 'фоновой', 'фоновую', 'фоновыми', 'фоновых',
  'сзади', 'позади', 'заднем', 'background', 'behind',
];

const SUFFIXES = [
  'иями', 'ями', 'ами', 'иях', 'ией', 'ого', 'его', 'ему', 'ому', 'ыми', 'ими', 'ешь', 'ете', 'ите', 'ться', 'тся',
  'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ый', 'ий', 'ой', 'ей', 'ем', 'им', 'ом', 'ах', 'ях', 'ам', 'ям', 'ов', 'ев',
  'ию', 'ья', 'ье', 'ьи', 'ью', 'ия', 'ии', 'ть', 'ет', 'ут', 'ют', 'ат', 'ят', 'ую', 'юю',
  'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь', 'й',
];

export function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
}

export function tokenize(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

export function stem(word: string): string {
  const w = word.toLowerCase().replace(/ё/g, 'е');
  if (w.length <= 3) return w;
  for (const s of SUFFIXES) {
    if (w.endsWith(s) && w.length - s.length >= 3) return w.slice(0, -s.length);
  }
  return w;
}

function lev1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Genitive plural with a zero ending («пять монет», «папок», «ручек»): the bare
 * word is the stem of the other form, possibly with a fleeting о/е before the
 * last consonant (папок → папк, ручек → ручк). The stemmer would cut «монет»
 * down to «мон» as if it were a verb ending.
 */
function zeroEnding(word: string, other: string): boolean {
  if (word.length < 4) return false;
  const s = stem(other);
  if (s === other || s.length < 4) return false;
  const w = word.replace(/ё/g, 'е');
  return w === s || w.replace(/[ое]([кнл])$/, '$1') === s;
}

/** Do two words look like forms of the same lemma? */
export function sameWord(a: string, b: string): boolean {
  const sa = stem(a), sb = stem(b);
  if (sa === sb) return true;
  if (zeroEnding(a, b) || zeroEnding(b, a)) return true;
  const [short, long] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  if (short.length >= 3 && long.length - short.length <= 1 && long.startsWith(short)) return true;
  if (short.length >= 5 && lev1(sa, sb)) return true;
  return false;
}

interface Lexeme {
  id: ObjectId;
  words: string[];
  kind: 'name' | 'tag';
}

const LEXICON: Lexeme[] = CATALOG.flatMap((c: CatalogEntry) => [
  ...c.synonyms.map((s) => ({ id: c.id, words: tokenize(s), kind: 'name' as const })),
  ...c.tags.map((t) => ({ id: c.id, words: tokenize(t), kind: 'tag' as const })),
]);

function matchAt(tokens: string[], pos: number, lx: Lexeme): boolean {
  if (pos + lx.words.length > tokens.length) return false;
  return lx.words.every((w, k) => sameWord(tokens[pos + k], w));
}

export interface DictionaryResult {
  /** 'objects' — the phrase is just a list of library objects (scenario 2). */
  mode: 'objects' | 'phrase';
  objects: ObjectRequest[];
  /** Words recognised as object names. */
  named: string[];
  /** Meaningful words that are not object names. */
  unmatched: string[];
}

const MAX_OBJECTS = 8;
const MAX_MAIN = 4;

const CONJUNCTIONS = new Set(['и', 'или', 'а', 'да', 'плюс', 'and', 'or']);
const NAMES = LEXICON.filter((l) => l.kind === 'name');

function isNamed(tokens: string[], pos: number): boolean {
  return NAMES.some((l) => matchAt(tokens, pos, l));
}

/** Splits the phrase into clauses (by punctuation) and returns the tokens with their clause number. */
function clauseTokens(text: string): { tokens: string[]; clause: number[] } {
  const tokens: string[] = [];
  const clause: number[] = [];
  text.split(/[,;.!?:\n()]+/).forEach((part, c) => {
    for (const t of tokenize(part)) {
      tokens.push(t);
      clause.push(c);
    }
  });
  return { tokens, clause };
}

/**
 * Finds explicit object names in the phrase.
 *
 * Background markers («на фоне», «фоном», «фоновый», «сзади», «на заднем плане»):
 *  • followed by objects in the same clause — those objects and every later one
 *    are background: «кошелёк на фоне книги и лампы», «фоном книга», «на фоне книги, лампы»;
 *  • nothing follows in the clause — the object right before the marker is
 *    background: «наушники, телефон, книга на фоне», «книга фоном, телефон».
 */
export function matchObjects(text: string): DictionaryResult {
  const { tokens, clause } = clauseTokens(text);
  const objects: ObjectRequest[] = [];
  const named: string[] = [];
  const unmatched: string[] = [];
  /** Objects pushed for the last named word (several with a count). */
  let last: { from: number; to: number; clause: number } | null = null;
  let count = 1;
  let background = false;
  /** Last clause the current «на фоне» covers. */
  let bgClause = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'плане' && tokens[i - 1] === 'заднем') continue;
    if (background && clause[i] > bgClause) background = false;
    if (BACKGROUND_WORDS.includes(t)) {
      // Does an object name follow the marker directly («на фоне книги», «фоном старая книга»)?
      // A conjunction or the end of the clause means the marker refers back.
      let follows = false;
      for (let k = i + 1; k < tokens.length && clause[k] === clause[i] && k - i <= 3 && !CONJUNCTIONS.has(tokens[k]); k++) {
        if (isNamed(tokens, k)) {
          follows = true;
          break;
        }
      }
      if (!follows && last && last.clause === clause[i]) {
        // «книга на фоне», «книга фоном, телефон»: the marker refers back.
        for (let n = last.from; n < last.to; n++) objects[n] = { ...objects[n], role: 'background' };
      } else {
        // «на фоне книги и лампы»: everything named later in this clause; a lone
        // «на фоне:» at the start of a clause also covers the next clause.
        background = true;
        bgClause = follows || (last && last.clause === clause[i]) ? clause[i] : clause[i] + 1;
      }
      continue;
    }
    if (/^\d+$/.test(t)) {
      // Digits behave like numerals («5 монет» = «пять монет»), clamped to the largest numeral.
      count = Math.min(MAX_COUNT, Math.max(1, parseInt(t, 10)));
      continue;
    }
    if (NUMERALS[t]) {
      count = NUMERALS[t];
      continue;
    }
    if (STOP.has(t)) continue;
    const lx = NAMES.find((l) => matchAt(tokens, i, l));
    if (lx) {
      const from = objects.length;
      for (let k = 0; k < count && objects.length < MAX_OBJECTS; k++) objects.push({ id: lx.id, role: background ? 'background' : 'main' });
      last = { from, to: objects.length, clause: clause[i] };
      named.push(tokens.slice(i, i + lx.words.length).join(' '));
      i += lx.words.length - 1;
      count = 1;
    } else {
      unmatched.push(t);
    }
  }
  return {
    mode: objects.length > 0 && unmatched.length === 0 ? 'objects' : 'phrase',
    objects: assignRoles(objects),
    named,
    unmatched,
  };
}

/** Objects the phrase explicitly puts in the background («книга на фоне», «на фоне книги»). */
export function explicitBackground(text: string): ObjectId[] {
  const objs = matchObjects(text).objects;
  // Only words marked by the user count, not the ones moved back by the four-main limit.
  const marked = new Set<ObjectId>();
  const { tokens } = clauseTokens(text);
  if (!tokens.some((t) => BACKGROUND_WORDS.includes(t))) return [];
  for (const o of objs) if (o.role === 'background') marked.add(o.id);
  // An object also named without a marker stays as the interpreter chose it.
  for (const o of objs) if (o.role === 'main') marked.delete(o.id);
  return [...marked];
}

/**
 * An explicit «на фоне» in the phrase wins over the roles chosen by the LLM
 * or by the meaning dictionary: those objects become background, and are
 * added if the interpreter left them out. At least one main object remains.
 */
export function applyExplicitBackground(text: string, objects: ObjectRequest[]): ObjectRequest[] {
  const bg = explicitBackground(text);
  if (!bg.length) return objects;
  const out = objects.map((o) => (bg.includes(o.id) ? { ...o, role: 'background' as const } : o));
  for (const id of bg) if (!out.some((o) => o.id === id)) out.push({ id, role: 'background' });
  if (!out.some((o) => o.role === 'main')) {
    const k = out.findIndex((o) => !bg.includes(o.id));
    if (k >= 0) out[k] = { ...out[k], role: 'main' };
  }
  return out;
}

/** Keeps at most four main objects; the rest go to the background. */
export function assignRoles(objects: ObjectRequest[]): ObjectRequest[] {
  let mains = 0;
  return objects.map((o) => {
    if (o.role === 'main') {
      mains++;
      if (mains > MAX_MAIN) return { ...o, role: 'background' };
    }
    return o;
  });
}

/**
 * Scenario 1 without an LLM: scores every object by names (weight 3) and
 * meaning tags (weight 1), takes the best two or three as main objects and the
 * next one as a background object.
 */
export function interpretByTags(text: string): { objects: ObjectRequest[]; reason: string } {
  const tokens = tokenize(text);
  const score = new Map<ObjectId, number>();
  const hits = new Map<ObjectId, string[]>();
  for (let i = 0; i < tokens.length; i++) {
    if (STOP.has(tokens[i])) continue;
    for (const lx of LEXICON) {
      if (matchAt(tokens, i, lx)) {
        score.set(lx.id, (score.get(lx.id) ?? 0) + (lx.kind === 'name' ? 3 : 1));
        hits.set(lx.id, [...(hits.get(lx.id) ?? []), tokens.slice(i, i + lx.words.length).join(' ')]);
      }
    }
  }
  const ranked = CATALOG.map((c, order) => ({ id: c.id, s: score.get(c.id) ?? 0, order }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.order - b.order);
  if (!ranked.length) {
    const fallback = fallbackPick(text);
    return { objects: fallback, reason: 'Совпадений в словаре нет — взяли нейтральную пару объектов' };
  }
  const main = ranked.slice(0, Math.min(3, ranked.length)).map((r) => ({ id: r.id, role: 'main' as const }));
  const bg = ranked.slice(3, 4).map((r) => ({ id: r.id, role: 'background' as const }));
  const words = [...new Set(ranked.flatMap((r) => hits.get(r.id) ?? []))];
  return { objects: applyExplicitBackground(text, [...main, ...bg]), reason: `Разобрали по словарю: ${words.join(', ')}` };
}

/** Deterministic neutral choice when nothing in the phrase is known. */
function fallbackPick(text: string): ObjectRequest[] {
  const pairs: ObjectId[][] = [
    ['lamp', 'book'],
    ['phone', 'headphones'],
    ['folder', 'pen'],
    ['flower', 'book'],
    ['puzzle', 'lamp'],
  ];
  let h = 0;
  for (const ch of normalize(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pairs[h % pairs.length].map((id) => ({ id, role: 'main' as const }));
}
