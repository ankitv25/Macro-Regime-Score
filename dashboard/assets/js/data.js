// Fetch + cache the JSON files under data/. Every dashboard page loads its
// data exclusively through this module - there is no other data source.

const cache = new Map();

export async function loadJSON(filename) {
  if (cache.has(filename)) return cache.get(filename);
  const res = await fetch(`data/${filename}`);
  if (!res.ok) throw new Error(`Failed to load data/${filename}: ${res.status}`);
  const json = await res.json();
  cache.set(filename, json);
  return json;
}
