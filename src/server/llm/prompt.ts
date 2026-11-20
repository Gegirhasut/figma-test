// One prompt and one output contract for every provider: the model only picks
// library ids and roles. It never sees or returns geometry.

import { CATALOG, OBJECT_IDS, isObjectId } from '../../shared/catalog';
import { assignRoles } from '../../shared/matcher';
import type { ObjectRequest } from '../../shared/types';

export const SYSTEM_PROMPT = [
  'Ты подбираешь объекты для плоской изометрической иллюстрации к фразе пользователя (метафора, заголовок или список предметов).',
  'Можно использовать ТОЛЬКО объекты из библиотеки ниже, по их id. Новых объектов не бывает.',
  'Роль main — главный цветной объект, background — монохромный фоновый объект за главными.',
  'Если пользователь сам пишет, что объект «на фоне» («книга на фоне», «на фоне книги», «фоном книга»), у этого объекта роль background.',
  'Обычно нужно 1–3 главных объекта и 0–2 фоновых; всего не больше 5. Выбирай то, что лучше всего передаёт смысл фразы.',
  'Ответь только JSON вида {"objects":[{"id":"wallet","role":"main"}]} — без координат, размеров, цветов и пояснений.',
  '',
  'Библиотека:',
  ...CATALOG.map((c) => `- ${c.id}: ${c.nameRu} (${c.synonyms.slice(0, 3).join(', ')}); смыслы: ${c.tags.slice(0, 12).join(', ')}`),
].join('\n');

export function userPrompt(phrase: string): string {
  return `Фраза: «${phrase}»`;
}

/** JSON Schema of the answer (structured output for Anthropic, documentation for others). */
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    objects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: OBJECT_IDS },
          role: { type: 'string', enum: ['main', 'background'] },
        },
        required: ['id', 'role'],
        additionalProperties: false,
      },
    },
  },
  required: ['objects'],
  additionalProperties: false,
} as const;

export class InvalidAnswerError extends Error {}

/** Validates a model answer against the library; throws if nothing usable is left. */
export function parseAnswer(text: string): ObjectRequest[] {
  let data: unknown;
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    data = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch {
    throw new InvalidAnswerError('answer is not JSON');
  }
  const list = (data as { objects?: unknown })?.objects;
  if (!Array.isArray(list)) throw new InvalidAnswerError('no objects array');
  const objects: ObjectRequest[] = [];
  for (const o of list) {
    const id = (o as { id?: unknown })?.id;
    const role = (o as { role?: unknown })?.role;
    if (!isObjectId(id)) continue;
    objects.push({ id, role: role === 'background' ? 'background' : 'main' });
    if (objects.length >= 5) break;
  }
  if (!objects.length) throw new InvalidAnswerError('no known objects in answer');
  if (!objects.some((o) => o.role === 'main')) objects[0] = { ...objects[0], role: 'main' };
  return assignRoles(objects);
}
