/* placeui.test.js - 配置操作ヘルパー（js/placeui.js）のテスト（Node, 追加依存なし） */
'use strict';
const assert = require('node:assert');
const Pieces = require('../js/pieces.js');
const Logic = require('../js/logic.js');
const State = require('../js/state.js');
const PlaceUi = require('../js/placeui.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

function players4() {
  return [
    { id: 'p1', name: 'P1', type: 'human', characterId: 'sora', partnerId: 'eagle' },
    { id: 'p2', name: 'P2', type: 'human', characterId: 'ren', partnerId: 'badger' },
    { id: 'p3', name: 'P3', type: 'human', characterId: 'hikari', partnerId: 'lion' },
    { id: 'p4', name: 'P4', type: 'human', characterId: 'yukino', partnerId: 'snake' }
  ];
}

function applyOk(state, move) {
  const r = State.applyMove(state, move);
  assert.strictEqual(r.ok, true, JSON.stringify(move) + ' -> ' + r.reason);
  return r.state;
}

/* 全色の初手を 'one' で置き終えた state（青は (0,0) に配置される） */
function afterOpening() {
  let s = State.createGame({ mode: 'normal', players: players4(), startColor: 'blue' });
  for (let i = 0; i < 4; i++) {
    const moves = State.legalMovesForTurn(s);
    const m = moves.find(mv => mv.pieceId === 'one') || moves[0];
    s = applyOk(s, { type: 'place', pieceId: m.pieceId, variantIndex: m.variantIndex, origin: m.origin });
  }
  assert.strictEqual(s.phase, 'playing');
  assert.strictEqual(s.board[0][0], 'blue');
  return s;
}

/* ---------- isAnchorCell ---------- */

test('isAnchorCell：角接マスだけがアンカー（辺接・占有マスは不可、ボンド時は辺接も可）', () => {
  let board = Logic.createBoard();
  board = Logic.applyPlacement(board, 'blue', [[5, 5]]);
  assert.strictEqual(PlaceUi.isAnchorCell(board, 'blue', 6, 6, {}), true);  // 角で接する
  assert.strictEqual(PlaceUi.isAnchorCell(board, 'blue', 4, 4, {}), true);
  assert.strictEqual(PlaceUi.isAnchorCell(board, 'blue', 5, 6, {}), false); // 辺で接するだけ
  assert.strictEqual(PlaceUi.isAnchorCell(board, 'blue', 5, 6, { allowEdge: true }), true);
  assert.strictEqual(PlaceUi.isAnchorCell(board, 'blue', 5, 5, {}), false); // 占有済み
  assert.strictEqual(PlaceUi.isAnchorCell(board, 'blue', 8, 8, {}), false); // 離れている
});

test('isAnchorCell：初手は四隅だけがアンカー', () => {
  const board = Logic.createBoard();
  assert.strictEqual(PlaceUi.isAnchorCell(board, 'blue', 0, 0, { opening: true }), true);
  assert.strictEqual(PlaceUi.isAnchorCell(board, 'blue', 19, 19, { opening: true }), true);
  assert.strictEqual(PlaceUi.isAnchorCell(board, 'blue', 1, 1, { opening: true }), false);
});

/* ---------- buildAnchorMap ---------- */

test('アンカー（初手）：ハイライトは四隅だけに出る', () => {
  const s = State.createGame({ mode: 'normal', players: players4() });
  const moves = State.legalMovesForTurn(s);
  const anchors = PlaceUi.buildAnchorMap(moves, s.board, 'blue', { pieceId: 'one', opening: true });
  assert.deepStrictEqual(Object.keys(anchors).sort(), ['0,0', '0,19', '19,0', '19,19']);
  Object.keys(anchors).forEach(k => assert.strictEqual(anchors[k].length, 1));
  // 大きいピースでもアンカーは四隅の範囲内だけ
  const anchorsBig = PlaceUi.buildAnchorMap(moves, s.board, 'blue', { pieceId: 'five-v', opening: true });
  Object.keys(anchorsBig).forEach(k => {
    assert.ok(['0,0', '0,19', '19,0', '19,19'].indexOf(k) >= 0, '四隅以外にハイライトしない: ' + k);
  });
});

test('アンカー（通常手番）：自分の色に角で接するマスだけがハイライトされる', () => {
  const s = afterOpening(); // 青は (0,0) のみ → 角で接する空きマスは (1,1) だけ
  const moves = State.legalMovesForTurn(s);
  const anchors = PlaceUi.buildAnchorMap(moves, s.board, 'blue', { pieceId: 'two' });
  assert.deepStrictEqual(Object.keys(anchors), ['1,1']);
  // 辺で接する (0,1) や (1,0) はハイライトしない（旧来の origin 表示との違い）
  assert.strictEqual(anchors['0,1'], undefined);
  assert.strictEqual(anchors['1,0'], undefined);
  assert.ok(anchors['1,1'].length >= 2, 'ドミノは (1,1) を覆う候補が複数ある');
  anchors['1,1'].forEach(m => {
    assert.ok(m.cells.some(c => c[0] === 1 && c[1] === 1), '候補はアンカーを覆う');
  });
});

test('アンカー：全ての合法手は最低1つのアンカーから到達できる', () => {
  const s = afterOpening();
  const moves = State.legalMovesForTurn(s);
  const anchors = PlaceUi.buildAnchorMap(moves, s.board, 'blue', {});
  const reachable = {};
  Object.keys(anchors).forEach(k => anchors[k].forEach(m => { reachable[m.pieceId + '|' + m.variantIndex + '|' + m.origin] = true; }));
  moves.forEach(m => {
    assert.ok(reachable[m.pieceId + '|' + m.variantIndex + '|' + m.origin],
      '到達できない合法手がある: ' + JSON.stringify(m));
  });
});

test('アンカー（ぴたっとボンド）：辺接マスもアンカーになり、辺接続だけの配置に到達できる', () => {
  let board = Logic.createBoard();
  board = Logic.applyPlacement(board, 'blue', [[5, 5]]);
  const moves = Logic.legalMoves(board, 'blue', ['two'], { allowEdge: true });
  const withBond = PlaceUi.buildAnchorMap(moves, board, 'blue', { allowEdge: true });
  const withoutBond = PlaceUi.buildAnchorMap(moves, board, 'blue', { allowEdge: false });
  // (5,4) は (5,5) と辺で接するだけのマス。ボンド時のみアンカーになる
  assert.ok(withBond['5,4'] && withBond['5,4'].length > 0);
  assert.strictEqual(withoutBond['5,4'], undefined);
});

/* ---------- placeablePieceIds ---------- */

test('placeablePieceIds：合法手に登場するピースだけが置ける', () => {
  const set = PlaceUi.placeablePieceIds([
    { pieceId: 'a' }, { pieceId: 'b' }, { pieceId: 'a' }
  ]);
  assert.deepStrictEqual(Object.keys(set).sort(), ['a', 'b']);

  const s = afterOpening(); // 青は 'one' を使用済み
  const moves = State.legalMovesForTurn(s);
  const placeable = PlaceUi.placeablePieceIds(moves);
  assert.strictEqual(placeable['one'], undefined, '使用済みピースは含まれない');
  assert.strictEqual(placeable['five-x'], true, '序盤は大きなピースも置ける');
  assert.strictEqual(placeable['two'], true);
});

/* ---------- pickTap ---------- */

test('pickTap：候補が1つのアンカーは、2回目のタップで確定する（ダブルタップ確定）', () => {
  const s = State.createGame({ mode: 'normal', players: players4() });
  const moves = State.legalMovesForTurn(s);
  const anchors = PlaceUi.buildAnchorMap(moves, s.board, 'blue', { pieceId: 'one', opening: true });
  const first = PlaceUi.pickTap({ anchors: anchors, activeAnchor: null, candIdx: 0, tentative: null, x: 0, y: 0 });
  assert.strictEqual(first.action, 'select');
  const second = PlaceUi.pickTap({
    anchors: anchors, activeAnchor: first.anchor, candIdx: first.candIdx,
    tentative: first.move, x: 0, y: 0
  });
  assert.strictEqual(second.action, 'confirm');
  assert.ok(PlaceUi.sameMove(second.move, first.move));
});

test('pickTap：候補が複数のアンカーは、連続タップで候補を順に切り替える（誤確定しない）', () => {
  const s = afterOpening();
  const moves = State.legalMovesForTurn(s);
  const anchors = PlaceUi.buildAnchorMap(moves, s.board, 'blue', { pieceId: 'two' });
  const cands = anchors['1,1'];
  assert.strictEqual(cands.length, 2);
  let pick = PlaceUi.pickTap({ anchors: anchors, activeAnchor: null, candIdx: 0, tentative: null, x: 1, y: 1 });
  assert.strictEqual(pick.action, 'select');
  assert.strictEqual(pick.candIdx, 0);
  pick = PlaceUi.pickTap({ anchors: anchors, activeAnchor: pick.anchor, candIdx: pick.candIdx, tentative: pick.move, x: 1, y: 1 });
  assert.strictEqual(pick.action, 'select', '候補が複数あるときは切り替え優先で確定しない');
  assert.strictEqual(pick.candIdx, 1);
  assert.ok(!PlaceUi.sameMove(pick.move, cands[0]));
  // 末尾の次は先頭へ循環し、それも確定にはならない
  pick = PlaceUi.pickTap({ anchors: anchors, activeAnchor: pick.anchor, candIdx: pick.candIdx, tentative: pick.move, x: 1, y: 1 });
  assert.strictEqual(pick.action, 'select');
  assert.strictEqual(pick.candIdx, 0);
});

test('pickTap：希望バリエーション（回転・反転で選んだ向き）が最初に表示される', () => {
  const s = afterOpening();
  const moves = State.legalMovesForTurn(s);
  const anchors = PlaceUi.buildAnchorMap(moves, s.board, 'blue', { pieceId: 'two' });
  const cands = anchors['1,1'];
  const preferred = cands[cands.length - 1].variantIndex;
  assert.notStrictEqual(preferred, cands[0].variantIndex);
  const pick = PlaceUi.pickTap({
    anchors: anchors, activeAnchor: null, candIdx: 0, tentative: null,
    preferredVariantIndex: preferred, x: 1, y: 1
  });
  assert.strictEqual(pick.action, 'select');
  assert.strictEqual(pick.move.variantIndex, preferred);
  assert.strictEqual(cands[pick.candIdx], pick.move);
});

test('pickTap：仮置き（ゴースト）のマスをタップすると確定する', () => {
  const s = afterOpening();
  const moves = State.legalMovesForTurn(s);
  const anchors = PlaceUi.buildAnchorMap(moves, s.board, 'blue', { pieceId: 'two' });
  const first = PlaceUi.pickTap({ anchors: anchors, activeAnchor: null, candIdx: 0, tentative: null, x: 1, y: 1 });
  assert.strictEqual(first.action, 'select');
  // 仮置きのセルのうちアンカーでないセルを探してタップする
  const ghostCell = first.move.cells.find(c => !anchors[c[0] + ',' + c[1]]);
  assert.ok(ghostCell, 'アンカーでないゴーストセルがある');
  const pick = PlaceUi.pickTap({
    anchors: anchors, activeAnchor: first.anchor, candIdx: first.candIdx,
    tentative: first.move, x: ghostCell[0], y: ghostCell[1]
  });
  assert.strictEqual(pick.action, 'confirm');
  assert.ok(PlaceUi.sameMove(pick.move, first.move));
});

test('pickTap：仮置きが覆う別のアンカーをタップしても、同一配置なら確定する', () => {
  const move = {
    pieceId: 'four-z', variantIndex: 0, origin: [1, 1],
    cells: [[1, 1], [2, 1], [2, 2], [3, 2]]
  };
  const anchors = { '1,1': [move], '2,2': [move] };
  const pick = PlaceUi.pickTap({
    anchors: anchors, activeAnchor: '1,1', candIdx: 0, tentative: move, x: 2, y: 2
  });
  assert.strictEqual(pick.action, 'confirm');
});

test('pickTap：関係ないマスのタップでは何もしない', () => {
  const s = afterOpening();
  const moves = State.legalMovesForTurn(s);
  const anchors = PlaceUi.buildAnchorMap(moves, s.board, 'blue', { pieceId: 'two' });
  const pick = PlaceUi.pickTap({ anchors: anchors, activeAnchor: null, candIdx: 0, tentative: null, x: 10, y: 10 });
  assert.strictEqual(pick, null);
});

console.log('placeui.test.js: ' + passed + ' tests passed');
