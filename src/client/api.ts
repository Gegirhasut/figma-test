import { interpretByTags, matchObjects } from '../shared/matcher';
import type { ObjectRequest } from '../shared/types';

export type InterpretSource = 'dictionary' | 'anthropic' | 'deepseek' | 'offline';

export interface Interpretation {
  objects: ObjectRequest[];
  source: InterpretSource;
  /** Short, quiet explanation for the user (or empty). */
  note: string;
}

interface ServerAnswer {
  objects: ObjectRequest[];
  source: 'dictionary' | 'anthropic' | 'deepseek';
  limited?: boolean;
  aiUnavailable?: boolean;
  aiLeft: number;
}

/**
 * Scenario 2 (a list of object names) is resolved locally without any request.
 * Everything else goes to the server, which asks an LLM (within the limit) and
 * falls back to the dictionary; if the server is unreachable the dictionary
 * runs here.
 */
export async function interpretPhrase(phrase: string): Promise<Interpretation> {
  const local = matchObjects(phrase);
  if (local.mode === 'objects') return { objects: local.objects, source: 'dictionary', note: '' };
  try {
    const res = await fetch('/api/interpret', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phrase }),
      credentials: 'same-origin',
    });
    if (res.status === 429) {
      const d = interpretByTags(phrase);
      return { objects: d.objects, source: 'offline', note: 'Слишком много запросов подряд — собрали по словарю' };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const a = (await res.json()) as ServerAnswer;
    let note = '';
    if (a.limited) note = 'Лимит AI-запросов исчерпан — эту фразу разобрали по словарю. Перечисление объектов работает без ограничений.';
    else if (a.source === 'dictionary') note = 'Фразу разобрали по словарю';
    else if (a.aiLeft === 0) note = 'Это был последний AI-запрос; дальше фразы разбираются по словарю';
    return { objects: a.objects, source: a.source, note };
  } catch {
    const d = interpretByTags(phrase);
    return { objects: d.objects, source: 'offline', note: 'Сервер недоступен — собрали по словарю' };
  }
}
