// Builds data/kandas/<kanda>.json + data/manifest.json from a Ramayana_Book
// checkout. Dependency-free; run with: npm run build-index
//
//   RAMAYANA_BOOK_DIR=/path/to/Ramayana_Book npm run build-index
//
// Defaults to the sibling checkout used in this workspace.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoDir =
  process.env.RAMAYANA_BOOK_DIR ??
  path.resolve(here, '..', '..', 'ramayana-modernization', 'repo');
const outDir = path.resolve(here, '..', 'data', 'kandas');
mkdirSync(outDir, { recursive: true });

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const chapterNum = (f) => parseInt(f.match(/^chapter(\d+)\.json$/)[1], 10);

const enRoot = path.join(repoDir, 'translations', 'en');
const kandaDirs = readdirSync(enRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const manifest = { kandas: [], totalVerses: 0 };

for (const kanda of kandaDirs) {
  // Sanskrit slokas: san/<kanda>/chapter<N>.json -> { <key>: { sanskrit_name, chapters: [...] } }
  const slokasByChapter = new Map();
  let sanskritName = kanda;
  const sanDir = path.join(repoDir, 'san', kanda);
  if (existsSync(sanDir)) {
    for (const f of readdirSync(sanDir)) {
      const m = f.match(/^chapter(\d+)\.json$/);
      if (!m) continue;
      const top = readJson(path.join(sanDir, f));
      const book = top[Object.keys(top)[0]];
      if (book.sanskrit_name) sanskritName = book.sanskrit_name;
      for (const ch of book.chapters ?? []) {
        slokasByChapter.set(ch.chapter_number, ch.slokas ?? []);
      }
    }
  }

  const chapters = {};
  const manifestChapters = [];
  const files = readdirSync(path.join(enRoot, kanda))
    .filter((f) => /^chapter\d+\.json$/.test(f))
    .sort((a, b) => chapterNum(a) - chapterNum(b));

  for (const f of files) {
    const en = readJson(path.join(enRoot, kanda, f));
    const chapter = en.chapter;
    const verseNums = new Set(Object.keys(en.verses ?? {}));
    const others = {};
    for (const lang of ['hi', 'te']) {
      const p = path.join(repoDir, 'translations', lang, kanda, f);
      if (existsSync(p)) {
        others[lang] = readJson(p).verses ?? {};
        for (const k of Object.keys(others[lang])) verseNums.add(k);
      }
    }
    const slokas = slokasByChapter.get(chapter) ?? [];
    const sorted = [...verseNums].sort((a, b) => Number(a) - Number(b));
    const verses = {};
    for (const v of sorted) {
      const entry = {};
      const sloka = slokas[Number(v) - 1];
      if (sloka) entry.sa = sloka;
      if (en.verses?.[v]) entry.en = en.verses[v];
      if (others.hi?.[v]) entry.hi = others.hi[v];
      if (others.te?.[v]) entry.te = others.te[v];
      verses[v] = entry;
    }
    chapters[String(chapter)] = { verses };
    manifestChapters.push({ chapter, verses: sorted.length });
    manifest.totalVerses += sorted.length;
  }

  writeFileSync(
    path.join(outDir, `${kanda}.json`),
    JSON.stringify({ kanda, sanskritName, chapters }),
  );
  manifest.kandas.push({ kanda, sanskritName, chapters: manifestChapters });
  console.log(`${kanda}: ${manifestChapters.length} chapters`);
}

writeFileSync(path.join(outDir, '..', 'manifest.json'), JSON.stringify(manifest));
console.log(`total verses indexed: ${manifest.totalVerses}`);
