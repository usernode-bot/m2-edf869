/* Importing a map (#28): each format's parser, the fit into M2's limits, and
 * the doc buildDoc builds. Run with `npm test` (node --test). */
'use strict';
const test = require('node:test');
const assert = require('assert');
const M = require('../public/js/map-model');
const I = require('../public/js/map-import');
const { exampleDoc } = require('../public/js/example-map');

// A doc's shape as texts in reading order, to compare an import with its source.
function shape(doc) {
  function under(id) {
    return M.childrenOf(doc, id).map((n) => ({ text: n.text, children: under(n.id) }));
  }
  return { root: M.node(doc, 'root').text, children: under('root') };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Hand-written exports of a doc, in the shapes Markdown, OPML and an M2 file
// take (export itself, #27, is not in the app yet).
function toMarkdown(doc) {
  const lines = ['# ' + M.node(doc, 'root').text];
  const bullets = (id, pad) => {
    M.childrenOf(doc, id).forEach((n) => {
      lines.push(pad + '- ' + n.text);
      bullets(n.id, pad + '  ');
    });
  };
  M.childrenOf(doc, 'root').forEach((main) => {
    lines.push('## ' + main.text);
    bullets(main.id, '');
  });
  return lines.join('\n') + '\n';
}

function toOpml(doc) {
  const outline = (id) => {
    const kids = M.childrenOf(doc, id);
    return '<outline text="' + esc(M.node(doc, id).text) + '">' +
      kids.map((n) => outline(n.id)).join('') + '</outline>';
  };
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<opml version="2.0"><head><title>Example</title></head><body>' +
    outline('root') + '</body></opml>';
}

test('Markdown, OPML and an M2 file round-trip the example map', () => {
  const original = exampleDoc();
  const want = shape(original);

  const md = I.read(toMarkdown(original), 'Example.md');
  assert.ifError(md.error);
  assert.deepStrictEqual(shape(md.doc), want);

  const op = I.read(toOpml(original), 'Example.opml');
  assert.ifError(op.error);
  assert.deepStrictEqual(shape(op.doc), want);

  const m2 = I.read(JSON.stringify(original), 'Example.json');
  assert.ifError(m2.error);
  assert.deepStrictEqual(m2.doc, original);

  // The wrapped shapes an M2 file can take are read too.
  assert.deepStrictEqual(I.read(JSON.stringify({ doc: original }), 'a.json').doc, original);
  assert.deepStrictEqual(I.read(JSON.stringify({ map: { doc: original } }), 'a.json').doc, original);
});

test('a FreeMind sample with a note and an arrow imports', () => {
  const mm = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<map version="1.0.1">' +
    '<node TEXT="Root" ID="r">' +
    '<node TEXT="First" ID="n1">' +
    '<node TEXT="Second" ID="n2">' +
    '<richcontent TYPE="NOTE"><html><body><p>a note</p></body></html></richcontent>' +
    '<arrowlink DESTINATION="n3" MIDDLE_LABEL="see also"/>' +
    '</node></node>' +
    '<node TEXT="Other" ID="n3"/>' +
    '</node></map>';
  const r = I.read(mm, 'Sample.mm');
  assert.ifError(r.error);
  assert.strictEqual(r.doc.nodes.length, 4);
  const second = r.doc.nodes.filter((n) => n.text === 'Second')[0];
  assert.strictEqual(M.depth(r.doc, second.id), 2); // root, First, Second: 3 levels
  assert.strictEqual(r.levels, 2);
  assert.strictEqual(r.lost.notes, 1);
  assert.strictEqual(r.doc.links.length, 1);
  const byText = {};
  r.doc.nodes.forEach((n) => { byText[n.text] = n.id; });
  const link = r.doc.links[0];
  assert.deepStrictEqual([link.from, link.to].sort(), [byText.Second, byText.Other].sort());
  assert.strictEqual(link.text, 'see also');
  assert.strictEqual(M.validate(r.doc), null);
});

test('plain text nesting is found from tabs, 2 spaces or 4 spaces', () => {
  const shapes = [
    'Root\n\tA\n\t\tA1\n\tB',
    'Root\n  A\n    A1\n  B',
    'Root\n    A\n        A1\n    B',
  ].map((text) => shape(I.read(text, 'Outline.txt').doc));
  shapes.forEach((s) => assert.deepStrictEqual(s, shapes[0]));
  assert.deepStrictEqual(shapes[0], {
    root: 'Root',
    children: [
      { text: 'A', children: [{ text: 'A1', children: [] }] },
      { text: 'B', children: [] },
    ],
  });

  // Several outer lines: the file's name is the centre and they are mains.
  const many = I.read('A\nB\n  B1', 'Outline.txt');
  assert.strictEqual(shape(many.doc).root, 'Outline');
  assert.deepStrictEqual(shape(many.doc).children.map((c) => c.text), ['A', 'B']);
});

test('Markdown details: tasks, links, notes and a name with no heading', () => {
  const md = '# Plan\n## Work\n- [x] Ship it\n- [ ] Draft [the memo](https://example.com)\n' +
    'A paragraph under the bullet.\n';
  const r = I.read(md, 'Plan.md');
  assert.ifError(r.error);
  assert.strictEqual(M.node(r.doc, 'root').text, 'Plan');
  const work = M.childrenOf(r.doc, 'root')[0];
  assert.strictEqual(work.text, 'Work');
  assert.deepStrictEqual(M.childrenOf(r.doc, work.id).map((n) => n.text), ['Ship it', 'Draft the memo']);
  assert.strictEqual(r.lost.tasks, 2);
  assert.strictEqual(r.lost.webLinks, 1);
  assert.strictEqual(r.lost.notes, 1);

  const named = I.read('## A\n- one', 'Notes.md');
  assert.strictEqual(M.node(named.doc, 'root').text, 'Notes');
});

test('a malformed file never makes a map', () => {
  const cases = [
    ['<opml><body><outline text="x"></body></opml>', 'bad.opml'],
    ['<foo/>', 'bad.mm'],
    ['{oops', 'bad.json'],
    [JSON.stringify({
      v: 1,
      nodes: [
        { id: 'root', parent: null, text: 'Root', x: 0, y: 0 },
        { id: 'a', parent: 'b', text: 'A', x: 10, y: 0 },
        { id: 'b', parent: 'a', text: 'B', x: 20, y: 0 },
      ],
    }), 'cycle.json'],
    ['abc\u0000def', 'binary.txt'],
    ['', 'empty.txt'],
    ['   \n\n', 'blank.md'],
  ];
  cases.forEach(([text, name]) => {
    const r = I.read(text, name);
    assert.ok(r.error, name + ' should give an error');
    assert.strictEqual(r.doc, undefined, name + ' should create nothing');
  });
  assert.strictEqual(I.read('', 'x.md').error, I.ERR_EMPTY);
  assert.strictEqual(I.read('{oops', 'x.json').error, I.ERR_DAMAGED_M2);
});

test('the XML reader never expands a custom entity and decodes the standard ones', () => {
  const text = '<?xml version="1.0"?>\n' +
    '<!DOCTYPE opml [ <!ENTITY xxe "boom"> ]>\n' +
    '<opml version="2.0"><body><outline text="A &amp; B &#65; &xxe;"/></body></opml>';
  const r = I.read(text, 'safe.opml');
  assert.ifError(r.error);
  const root = M.node(r.doc, 'root');
  assert.strictEqual(root.text, 'A & B A &xxe;');
});

test('limits: shortening, the ten levels and the model\'s node limit', () => {
  const long = 'x'.repeat(130);
  const r = I.read('Root\n  ' + long, 'Long.txt');
  assert.ifError(r.error);
  const idea = M.childrenOf(r.doc, 'root')[0];
  assert.strictEqual(idea.text.length, M.MAX_TEXT);
  assert.ok(idea.text.endsWith('…'));
  assert.strictEqual(r.shortened, 1);

  const longRoot = I.read('# ' + 'y'.repeat(90), 'Long.md');
  assert.strictEqual(M.node(longRoot.doc, 'root').text.length, M.MAX_ROOT_TEXT);
  assert.ok(M.node(longRoot.doc, 'root').text.endsWith('…'));
  assert.ok(I.summaryLines(longRoot).some((l) => /central idea was shortened/.test(l)));

  // A 14-level chain: everything past level 10 moves up under its level-9 idea.
  const chain = ['Root'];
  for (let d = 1; d <= 14; d++) chain.push('  '.repeat(d) + 'L' + d);
  const deep = I.read(chain.join('\n'), 'Deep.txt');
  assert.ifError(deep.error);
  assert.strictEqual(deep.flattened, 4);
  const deepest = Math.max(...deep.doc.nodes.map((n) => M.depth(deep.doc, n.id)));
  assert.strictEqual(deepest, M.MAX_DEPTH);

  // More ideas than the model can hold, so the tail is cut and the summary
  // says how much came in. The cap is M.MAX_NODES, which a big-map change
  // raised from 500 to 2000; the sample is a tree, because tidy layout keeps
  // a tree inside the model's coordinate bounds at this size (one flat column
  // of 2000 ideas would not fit them).
  const many = ['Root'];
  for (let i = 0; i < 110; i++) {
    many.push('  Main ' + i);
    for (let j = 0; j < 18; j++) many.push('    Child ' + i + '.' + j);
  }
  const total = many.length;
  const big = I.read(many.join('\n'), 'Big.txt');
  assert.ifError(big.error);
  assert.strictEqual(big.doc.nodes.length, M.MAX_NODES);
  assert.strictEqual(big.total, total);
  assert.ok(I.summaryLines(big).includes('Imported the first ' + M.MAX_NODES + ' ideas of ' + total + '.'));
});

test('a built doc is a valid, tidy map with colours in order', () => {
  const r = I.read(toMarkdown(exampleDoc()), 'Example.md');
  assert.strictEqual(M.validate(r.doc), null);
  assert.deepStrictEqual(r.doc.layout, { auto: true });
  assert.strictEqual(r.doc.nodes[0].id, 'root');
  M.childrenOf(r.doc, 'root').forEach((n, i) => assert.strictEqual(n.color, i % M.COLORS));
  assert.strictEqual(M.overlaps(r.doc), null);
  // The summary names the file and its size.
  assert.strictEqual(I.summaryLines(r)[0],
    'Example.md: ' + r.ideaCount + ' ideas, ' + r.levels + ' levels deep. Import?');
});
