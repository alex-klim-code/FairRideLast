import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const source = await fs.readFile(new URL('../src/services/destination-history.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { DESTINATION_HISTORY_KEY, parseDestinationHistory, rememberDestination, readDestinationHistory, saveDestinationHistory, sameDestination } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const point = (name = 'Wawel') => ({ name, lat: 50.054, lng: 19.936 });
const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
};

test('selected destinations survive reload with only names and coordinates', () => {
  const storage = memoryStorage();
  const selected = { ...point(), stopId: 'demo-stop', id: 'provider-id', label: 'Provider label', query: 'private query' };
  saveDestinationHistory(storage, rememberDestination([], selected));
  const afterReload = readDestinationHistory(storage);
  assert.deepEqual(afterReload, [point()]);
  assert.deepEqual(JSON.parse(storage.getItem(DESTINATION_HISTORY_KEY)), [point()]);
});

test('history is bounded, newest first, and repeat selections move to the front', () => {
  let entries = [];
  for (let i = 0; i < 7; i++) entries = rememberDestination(entries, point(`Place ${i}`));
  assert.deepEqual(entries.map(entry => entry.name), ['Place 6', 'Place 5', 'Place 4', 'Place 3', 'Place 2']);
  entries = rememberDestination(entries, point('Place 4'));
  assert.deepEqual(entries.map(entry => entry.name), ['Place 4', 'Place 6', 'Place 5', 'Place 3', 'Place 2']);
});

test('single deletion and clearing persist without touching unrelated storage', () => {
  const storage = memoryStorage();
  storage.setItem('other-setting', 'keep');
  const entries = [point('Wawel'), point('Rynek')];
  saveDestinationHistory(storage, entries.filter(entry => !sameDestination(entry, point('Wawel'))));
  assert.deepEqual(readDestinationHistory(storage), [point('Rynek')]);
  saveDestinationHistory(storage, []);
  assert.equal(storage.getItem(DESTINATION_HISTORY_KEY), null);
  assert.deepEqual(readDestinationHistory(storage), []);
  assert.equal(storage.getItem('other-setting'), 'keep');
});

test('invalid coordinates and entries are rejected and extras stripped', () => {
  assert.deepEqual(parseDestinationHistory(JSON.stringify([
    null, { ...point(), lat: 91 }, { ...point(), lng: -181 }, { ...point(), name: '' },
    { ...point(), lat: '50.054' }, { ...point(), secret: 'discard' }, point(),
  ])), [point()]);
  assert.deepEqual(rememberDestination([], { ...point(), lat: NaN }), []);
  assert.throws(() => parseDestinationHistory('{broken'));
  assert.throws(() => parseDestinationHistory('{}'));
});

test('storage failures are not silently treated as successful persistence', () => {
  const storage = {
    getItem() { throw new Error('Storage blocked'); },
    setItem() { throw new Error('Storage full'); },
    removeItem() { throw new Error('Storage blocked'); },
  };
  assert.throws(() => readDestinationHistory(storage), /blocked/);
  assert.throws(() => saveDestinationHistory(storage, [point()]), /full/);
  assert.throws(() => saveDestinationHistory(storage, []), /blocked/);
});

test('reusing persisted coordinates does not query the provider', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected provider request'); };
  try {
    const storage = memoryStorage();
    saveDestinationHistory(storage, [point()]);
    const selected = readDestinationHistory(storage)[0];
    assert.deepEqual(selected, point());
    saveDestinationHistory(storage, rememberDestination(readDestinationHistory(storage), selected));
    assert.deepEqual(readDestinationHistory(storage), [point()]);
  } finally { globalThis.fetch = originalFetch; }
});