import { applyExplicitBackground, interpretByTags, matchObjects } from '../shared/matcher';
import type { ObjectRequest } from '../shared/types';

export type InterpretSource = 'dictionary' | 'anthropic' | 'deepseek' | 'offline';

export interface Interpretation {
  objects: ObjectRequest[];
  source: InterpretSource;
  /** Short, quiet explanation for the user (or empty). */
  note: string;
  /** What went wrong, if anything, so the UI can offer the next step. */
  problem?: 'limit' | 'timeout' | 'offline' | 'busy';
  /** AI quota after this request (unknown when the server was not asked). */
  aiLeft?: number;
  aiLimit?: number;
}

export interface ServerAnswer {
  objects: ObjectRequest[];
  source: 'dictionary' | 'anthropic' | 'deepseek';
  limited?: boolean;
  aiUnavailable?: boolean;
  timedOut?: boolean;
  aiLeft: number;
  aiLimit?: number;
  /** Epoch ms when the next AI request becomes available (only when aiLeft is 0). */
  aiResetAt?: number;
  /** The server's own explanation («Совпадений в словаре нет — …», «AI не ответил вовремя — …»). */
  note?: string;
}

/** The client gives up on the server after this and answers from the dictionary. */
export const CLIENT_TIMEOUT_MS = 15_000;

/** «в 14:05» today, «завтра в 09:30» tomorrow. */
export function formatResetTime(at: number, now = Date.now()): string {
  const d = new Date(at);
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const today = new Date(now);
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay ? `в ${hm}` : `завтра в ${hm}`;
}

/** The note shown above the canvas for a server answer. */
export function answerNote(a: ServerAnswer, now = Date.now()): string {
  const back = a.aiResetAt ? ` AI-запросы вернутся ${formatResetTime(a.aiResetAt, now)}.` : '';
  if (a.limited) return `Лимит AI-запросов на сутки исчерпан — эту фразу разобрали по словарю.${back} Перечисление объектов работает без ограничений — например:`;
  if (a.timedOut) return 'AI не ответил вовремя — собрали по словарю. Попробуйте ещё раз или перечислите объекты.';
  if (a.source === 'dictionary') return a.note || 'Фразу разобрали по словарю';
  if (a.aiLeft === 0) return `Это был последний AI-запрос на сутки; дальше фразы разбираются по словарю.${back}`;
  // The quota left is shown discreetly next to the input, not as a message.
  return '';
}

/**
 * Scenario 2 (a list of object names) is resolved locally without any request.
 * Everything else goes to the server, which asks an LLM (within the limit) and
 * falls back to the dictionary; if the server is unreachable or too slow the
 * dictionary runs here.
 */
export async function interpretPhrase(phrase: string, timeoutMs = CLIENT_TIMEOUT_MS): Promise<Interpretation> {
  const local = matchObjects(phrase);
  if (local.mode === 'objects') return { objects: local.objects, source: 'dictionary', note: '' };
  const offline = (note: string, problem: Interpretation['problem']): Interpretation => ({ objects: interpretByTags(phrase).objects, source: 'offline', note, problem });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/interpret', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phrase }),
      credentials: 'same-origin',
      signal: ctrl.signal,
    });
    if (res.status === 429) return offline('Слишком много запросов подряд — собрали по словарю. Подождите минуту и попробуйте снова.', 'busy');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const a = (await res.json()) as ServerAnswer;
    const problem = a.limited ? 'limit' : a.timedOut ? 'timeout' : undefined;
    return { objects: applyExplicitBackground(phrase, a.objects), source: a.source, note: answerNote(a), problem, aiLeft: a.aiLeft, aiLimit: a.aiLimit };
  } catch {
    if (ctrl.signal.aborted) return offline('Сервер не ответил вовремя — собрали по словарю. Попробуйте ещё раз чуть позже.', 'timeout');
    return offline('Сервер недоступен — собрали по словарю. Проверьте интернет и попробуйте ещё раз.', 'offline');
  } finally {
    clearTimeout(timer);
  }
}

export interface AiStatus {
  aiLeft: number;
  aiLimit: number;
  aiConfigured: boolean;
}

/** Quota for this browser; null when the server cannot be asked. */
export async function fetchAiStatus(): Promise<AiStatus | null> {
  try {
    const res = await fetch('/api/status', { credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.json()) as AiStatus;
  } catch {
    return null;
  }
}
