// Runs both LLM providers over the same Russian phrases and writes a
// comparison table: chosen objects, latency, tokens and estimated cost.
//
//   npm run compare-llm            (needs ANTHROPIC_API_KEY and/or DEEPSEEK_API_KEY in .env)
//
// Output: build/llm-compare.md and build/llm-compare.json. Prices per 1M tokens
// can be overridden with ANTHROPIC_PRICE_IN/OUT and DEEPSEEK_PRICE_IN/OUT.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpretByTags } from '../src/shared/matcher';
import { anthropicProvider, deepseekProvider, type Provider, type ProviderResult } from '../src/server/llm/providers';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));

const PHRASES = [
  'копим на отпуск',
  'финансовая грамотность для подростков',
  'как не забыть о дедлайне',
  'идея для стартапа',
  'учимся по вечерам',
  'подкаст о психологии',
  'кэшбэк за покупки',
  'электронный документооборот',
  'подпишите договор онлайн',
  'командная работа',
  'подарок маме на 8 марта',
  'музыка для концентрации',
  'мобильный банк',
  'налоговый вычет',
  'читаем книги вместе',
  'решаем сложную задачу',
  'инвестиции для начинающих',
  'уютный рабочий вечер',
  'весенняя распродажа',
  'онлайн-курс по рисованию',
];

const providers: Provider[] = [anthropicProvider(process.env), deepseekProvider(process.env)].filter((p) => p.configured());
if (!providers.length) {
  console.error('Нет ключей: заполните ANTHROPIC_API_KEY и/или DEEPSEEK_API_KEY в .env');
  process.exit(1);
}

type Row = { phrase: string; dictionary: string; results: Record<string, ProviderResult | { error: string }> };
const rows: Row[] = [];
const fmt = (r: ProviderResult) => r.objects.map((o) => (o.role === 'background' ? `(${o.id})` : o.id)).join(', ');

for (const phrase of PHRASES) {
  const row: Row = { phrase, dictionary: interpretByTags(phrase).objects.map((o) => o.id).join(', '), results: {} };
  for (const p of providers) {
    try {
      row.results[p.name] = await p.interpret(phrase);
    } catch (e) {
      row.results[p.name] = { error: (e as Error).message };
    }
    const r = row.results[p.name];
    console.log(`${p.name.padEnd(9)} ${phrase.padEnd(40)} ${'error' in r ? 'ERROR ' + r.error : `${fmt(r)}  ${r.latencyMs} ms`}`);
  }
  rows.push(row);
}

const names = providers.map((p) => p.name);
const lines: string[] = [];
lines.push(`# Сравнение LLM-провайдеров`, '', `Дата: ${new Date().toISOString()}`, '');
lines.push(`Модели: ${providers.map((p) => `${p.name} — ${p.model}`).join('; ')}. В скобках — фоновые объекты.`, '');
lines.push(`| Фраза | Словарь | ${names.map((n) => `${n}: объекты | мс | токены in/out | $`).join(' | ')} |`);
lines.push(`|---|---|${names.map(() => '---|---|---|---').join('|')}|`);
for (const r of rows) {
  const cells = names.map((n) => {
    const x = r.results[n];
    if ('error' in x) return `ошибка: ${x.error} | | | `;
    return `${fmt(x)} | ${x.latencyMs} | ${x.inputTokens}/${x.outputTokens} | ${x.costUsd.toFixed(6)}`;
  });
  lines.push(`| ${r.phrase} | ${r.dictionary} | ${cells.join(' | ')} |`);
}
lines.push('');
for (const n of names) {
  const ok = rows.map((r) => r.results[n]).filter((x): x is ProviderResult => !('error' in x));
  const lat = ok.map((x) => x.latencyMs).sort((a, b) => a - b);
  const median = lat.length ? lat[Math.floor(lat.length / 2)] : 0;
  const cost = ok.reduce((s, x) => s + x.costUsd, 0);
  lines.push(`- **${n}**: успешно ${ok.length}/${rows.length}, медиана ${median} мс, стоимость всех запросов $${cost.toFixed(5)} (≈ $${((cost / Math.max(1, ok.length)) * 1000).toFixed(3)} за 1000 фраз)`);
}

mkdirSync(join(ROOT, 'build'), { recursive: true });
writeFileSync(join(ROOT, 'build/llm-compare.md'), lines.join('\n') + '\n');
writeFileSync(join(ROOT, 'build/llm-compare.json'), JSON.stringify(rows, null, 2));
console.log('\nТаблица: build/llm-compare.md');
