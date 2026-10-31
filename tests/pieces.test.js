/* pieces.test.js - ピース定義のテスト（Node, 追加依存なし） */
'use strict';
const assert = require('node:assert');
const Pieces = require('../js/pieces.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

test('ピースは21種類ある', () => {
  assert.strictEqual(Pieces.PIECES.length, 21);
  assert.strictEqual(Pieces.PIECE_COUNT, 21);
});

test('ピース id はすべて一意', () => {
  const ids = Pieces.PIECES.map(p => p.id);
  assert.strictEqual(new Set(ids).size, 21);
});

test('マス数ごとの内訳は 1:1, 2:1, 3:2, 4:5, 5:12', () => {
  const counts = {};
  Pieces.PIECES.forEach(p => { counts[p.size] = (counts[p.size] || 0) + 1; });
  assert.deepStrictEqual(counts, { 1: 1, 2: 1, 3: 2, 4: 5, 5: 12 });
});

test('1色の総マス数は89', () => {
  const sum = Pieces.PIECES.reduce((s, p) => s + p.size, 0);
  assert.strictEqual(sum, 89);
  assert.strictEqual(Pieces.TOTAL_SQUARES_PER_COLOR, 89);
});

test('各ピースの size とセル数が一致する', () => {
  Pieces.PIECES.forEach(p => assert.strictEqual(p.cells.length, p.size, p.id));
});

test('全バリエーションが正規化済み（最小x=0, 最小y=0）でセル数を保つ', () => {
  Pieces.PIECES.forEach(p => {
    p.variants.forEach(v => {
      assert.strictEqual(v.length, p.size, p.id);
      assert.strictEqual(Math.min(...v.map(c => c[0])), 0, p.id);
      assert.strictEqual(Math.min(...v.map(c => c[1])), 0, p.id);
    });
  });
});

test('バリエーションに重複がない（キー一意）', () => {
  Pieces.PIECES.forEach(p => {
    const keys = p.variants.map(v => Pieces.cellsKey(v));
    assert.strictEqual(new Set(keys).size, keys.length, p.id);
  });
});

test('代表ピースのバリエーション数（1マス=1, 正方形=1, X型=1, I型5マス=2, ドミノ=2）', () => {
  assert.strictEqual(Pieces.getPiece('one').variants.length, 1);
  assert.strictEqual(Pieces.getPiece('four-square').variants.length, 1);
  assert.strictEqual(Pieces.getPiece('five-x').variants.length, 1);
  assert.strictEqual(Pieces.getPiece('five-i').variants.length, 2);
  assert.strictEqual(Pieces.getPiece('two').variants.length, 2);
});

test('回転した形状は必ずバリエーション集合に含まれる', () => {
  Pieces.PIECES.forEach(p => {
    const keys = new Set(p.variants.map(v => Pieces.cellsKey(v)));
    p.variants.forEach(v => {
      const rotated = Pieces.rotate90(v);
      assert.ok(keys.has(Pieces.cellsKey(rotated)), p.id);
    });
  });
});

test('ペントミノ12種は回転・反転しても互いに一致しない（自由ペントミノ全種が揃っている）', () => {
  const pentominoes = Pieces.PIECES.filter(p => p.size === 5);
  assert.strictEqual(pentominoes.length, 12);
  const canonicals = pentominoes.map(p => Pieces.canonicalKey(p.cells));
  assert.strictEqual(new Set(canonicals).size, 12);
});

test('テトロミノ5種・トリミノ2種も回転・反転で互いに一致しない', () => {
  [4, 3].forEach(size => {
    const group = Pieces.PIECES.filter(p => p.size === size);
    const canonicals = group.map(p => Pieces.canonicalKey(p.cells));
    assert.strictEqual(new Set(canonicals).size, group.length, 'size=' + size);
  });
});

test('getPiece は未知の id に null を返す', () => {
  assert.strictEqual(Pieces.getPiece('no-such-piece'), null);
  assert.deepStrictEqual(Pieces.variantsOf('no-such-piece'), []);
});

console.log('pieces.test.js: ' + passed + ' tests passed');
