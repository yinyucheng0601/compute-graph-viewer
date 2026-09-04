import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import katex from 'katex';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const renderingSource = appSource.slice(appSource.indexOf('function escapeHtml'), appSource.indexOf('function shuffle'));
const context = vm.createContext({ document: { querySelector() {} } });
vm.runInContext(renderingSource, context);
const renderInline = vm.runInContext('inline', context);
const renderMarkdown = vm.runInContext('renderMarkdown', context);

test('protects formulas and inline code from markdown emphasis parsing', () => {
  const html = renderInline('公式 \\(a*b*c\\) 与 `cost $5`');
  assert.match(html, /\\\(a\*b\*c\\\)/);
  assert.match(html, /<code>cost \$5<\/code>/);
  assert.doesNotMatch(html, /<em>/);
});

test('keeps multiline display formulas in one renderable element', () => {
  const html = renderMarkdown('公式如下：\n\n$$\na * b = c\n$$');
  assert.match(html, /<div class="math-block">\$\$\na \* b = c\n\$\$<\/div>/);
  assert.doesNotMatch(html, /<em>/);
});

test('all current knowledge-base formulas are accepted by KaTeX', async () => {
  const data = JSON.parse(await readFile(new URL('../public/cards.json', import.meta.url), 'utf8'));
  const formulas = data.cards.flatMap(card => [...card.body.matchAll(/\\\((.+?)\\\)/g)].map(match => match[1]));
  assert.ok(formulas.length > 0);
  for (const formula of formulas) {
    const html = katex.renderToString(formula, { throwOnError: false, strict: 'ignore' });
    assert.doesNotMatch(html, /katex-error/, formula);
  }
});
