/* logic.test.js - 配置判定・合法手・終了判定・スコア計算のテスト（Node, 追加依存なし） */
'use strict';
const assert = require('node:assert');
const Logic = require('../js/logic.js');
const Pieces = require('../js/pieces.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

/* テスト用：盤面に直接セルを書き込む（配置済みピースの再現） */
function setCells(board, color, cells) {
  const b = Logic.cloneBoard(board);
  cells.forEach(([x, y]) => { b[y][x] = color; });
  return b;
}

/* バリエーションを原点に置いた絶対座標を返すショートカット */
function cellsAt(pieceId, variantIndex, ox, oy) {
  return Logic.placementCells(pieceId, variantIndex, [ox, oy]);
}

// ---------- 盤面基礎 ----------

test('盤面は20x20で全て null', () => {
  const board = Logic.createBoard();
  assert.strictEqual(board.length, 20);
  board.forEach(row => {
    assert.strictEqual(row.length, 20);
    row.forEach(cell => assert.strictEqual(cell, null));
  });
  assert.strictEqual(Logic.BOARD_SIZE, 20);
  assert.deepStrictEqual(Logic.TURN_ORDER, ['blue', 'yellow', 'red', 'green']);
});

// ---------- 初手の隅ルール ----------

test('初手：隅を完全に覆う配置はOK', () => {
  const board = Logic.createBoard();
  // 左上隅 (0,0) を含む横3マス
  assert.strictEqual(Logic.canPlace(board, 'red', cellsAt('three-line', 0, 0, 0), { firstMove: true }), true);
  // 右下隅 (19,19) を含む1マス
  assert.strictEqual(Logic.canPlace(board, 'blue', [[19, 19]], { firstMove: true }), true);
});

test('初手：隅を覆わない配置はNG（理由 first-must-cover-corner）', () => {
  const board = Logic.createBoard();
  const result = Logic.validatePlacement(board, 'red', cellsAt('three-line', 0, 1, 0), { firstMove: true });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'first-must-cover-corner');
});

test('初手判定は盤面から自動判定される（自色が盤上にあれば初手扱いしない）', () => {
  let board = Logic.createBoard();
  board = setCells(board, 'red', [[0, 0]]);
  // 隅を覆わないが、赤の2手目として角接する配置は firstMove 未指定でもOKになる
  const cells = [[1, 1]];
  assert.strictEqual(Logic.canPlace(board, 'red', cells), true);
});

test('盤外配置はNG（理由 out-of-bounds）', () => {
  const board = Logic.createBoard();
  const result = Logic.validatePlacement(board, 'red', cellsAt('three-line', 0, 18, 0), { firstMove: true });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'out-of-bounds');
});

test('占有済みマスへの配置はNG（理由 occupied）', () => {
  let board = Logic.createBoard();
  board = setCells(board, 'blue', [[0, 0], [1, 0]]);
  const result = Logic.validatePlacement(board, 'red', cellsAt('three-line', 0, 0, 0), { firstMove: true });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'occupied');
});

// ---------- 2手目以降の角接・辺接ルール ----------

test('2手目：自色と角で接する配置はOK', () => {
  let board = Logic.createBoard();
  board = setCells(board, 'red', [[5, 5]]);
  assert.strictEqual(Logic.canPlace(board, 'red', [[6, 6]]), true); // 角接のみ
  assert.strictEqual(Logic.canPlace(board, 'red', [[4, 4]]), true); // 角接のみ
});

test('2手目：自色と辺で接する配置はNG（理由 edge-contact）', () => {
  let board = Logic.createBoard();
  board = setCells(board, 'red', [[5, 5]]);
  const result = Logic.validatePlacement(board, 'red', [[6, 5]]); // 辺接のみ
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'edge-contact');
  // 角接も辺接もする配置も辺接が優先してNG
  const result2 = Logic.validatePlacement(board, 'red', [[5, 6], [6, 6]]);
  assert.strictEqual(result2.ok, false);
  assert.strictEqual(result2.reason, 'edge-contact');
});

test('2手目：自色と全く接しない配置はNG（理由 no-corner-contact）', () => {
  let board = Logic.createBoard();
  board = setCells(board, 'red', [[5, 5]]);
  const result = Logic.validatePlacement(board, 'red', [[10, 10]]);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'no-corner-contact');
});

test('2手目：他色との辺接はOK（制限は自色のみ）', () => {
  let board = Logic.createBoard();
  board = setCells(board, 'red', [[5, 5]]);
  board = setCells(board, 'blue', [[7, 5], [7, 6]]);
  // 赤の単マス (6,6): 赤 (5,5) と角接、青 (7,5)(7,6) と辺接 → OK
  assert.strictEqual(Logic.canPlace(board, 'red', [[6, 6]]), true);
});

test('ぴたっとボンド（allowEdge）時は自色との辺接配置がOK', () => {
  let board = Logic.createBoard();
  board = setCells(board, 'red', [[5, 5]]);
  assert.strictEqual(Logic.canPlace(board, 'red', [[6, 5]], { allowEdge: false }), false);
  assert.strictEqual(Logic.canPlace(board, 'red', [[6, 5]], { allowEdge: true }), true);
});

test('2色担当でも色は別扱い：自分の別色との辺接はOK、角接はその色基準', () => {
  let board = Logic.createBoard();
  board = setCells(board, 'red', [[5, 5]]);
  board = setCells(board, 'blue', [[5, 7]]);
  // 青を置く番：青 (5,7) と角接し、赤 (5,5) とは辺接でもよい位置 (6,6)
  assert.strictEqual(Logic.canPlace(board, 'blue', [[6, 6]]), true);
  // 赤基準では (6,6) は赤 (5,5) と角接のみ → こちらでもOKになるが、
  // 赤と辺接し赤と角接しない (6,5) は赤ではNG・青でも（青と接しないため）NG
  assert.strictEqual(Logic.canPlace(board, 'red', [[6, 5]]), false);
  assert.strictEqual(Logic.canPlace(board, 'blue', [[6, 5]]), false);
});

test('tryPlace は新しい盤面を返し、元の盤面を変更しない', () => {
  const board = Logic.createBoard();
  const result = Logic.tryPlace(board, 'green', [[19, 0]], { firstMove: true });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.board[0][19], 'green');
  assert.strictEqual(board[0][19], null);
  const ng = Logic.tryPlace(board, 'green', [[5, 5]], { firstMove: true });
  assert.strictEqual(ng.ok, false);
  assert.strictEqual(ng.reason, 'first-must-cover-corner');
});

// ---------- 合法手列挙 ----------

test('合法手列挙：空盤面・初手・単マスピースは4隅の4手のみ', () => {
  const board = Logic.createBoard();
  const moves = Logic.legalMoves(board, 'red', ['one'], { firstMove: true });
  assert.strictEqual(moves.length, 4);
  const corners = moves.map(m => m.cells[0].join(',')).sort();
  assert.deepStrictEqual(corners, ['0,0', '0,19', '19,0', '19,19']);
});

test('合法手列挙：空盤面・初手・ドミノは各隅2通りで8手', () => {
  const board = Logic.createBoard();
  const moves = Logic.legalMoves(board, 'red', ['two'], { firstMove: true });
  assert.strictEqual(moves.length, 8);
  moves.forEach(m => assert.strictEqual(m.pieceId, 'two'));
});

test('合法手列挙：列挙された手はすべて実際に配置可能', () => {
  let board = Logic.createBoard();
  board = setCells(board, 'red', [[5, 5], [6, 5]]);
  board = setCells(board, 'blue', [[10, 10]]);
  const allIds = Pieces.PIECES.map(p => p.id);
  const moves = Logic.legalMoves(board, 'red', allIds, { limit: 50 });
  assert.ok(moves.length > 0);
  moves.forEach(m => {
    assert.strictEqual(Logic.canPlace(board, 'red', m.cells), true, m.pieceId);
    assert.strictEqual(m.cells.length, Pieces.getPiece(m.pieceId).size);
  });
});

test('hasLegalMove / shouldPass の基本動作', () => {
  const board = Logic.createBoard();
  assert.strictEqual(Logic.hasLegalMove(board, 'red', ['one'], { firstMove: true }), true);
  assert.strictEqual(Logic.shouldPass(board, 'red', [], {}), true); // 手元なしはパス
  assert.strictEqual(Logic.shouldPass(board, 'red', ['one'], { firstMove: true }), false);
});

// ---------- パス / 終了判定 ----------

test('終了判定：角接マスが塞がれた単マスは置けず、他に手がなければゲーム終了', () => {
  let board = Logic.createBoard();
  board = setCells(board, 'red', [[5, 5]]);
  board = setCells(board, 'blue', [[4, 4], [6, 4], [4, 6], [6, 6]]); // 赤の角接候補を全て占有
  assert.strictEqual(Logic.hasLegalMove(board, 'red', ['one']), false);
  assert.strictEqual(Logic.shouldPass(board, 'red', ['one']), true);
  assert.strictEqual(Logic.isGameOver(board, { red: ['one'] }), true);
});

test('終了判定：いずれかの色に合法手が残っていれば終了しない', () => {
  let board = Logic.createBoard();
  board = setCells(board, 'red', [[5, 5]]);
  board = setCells(board, 'blue', [[4, 4], [6, 4], [4, 6], [6, 6]]);
  // 緑はまだ初手を置ける
  assert.strictEqual(Logic.isGameOver(board, { red: ['one'], green: ['one'] }), false);
});

test('終了判定：手元が空の色は置けないものとして扱う', () => {
  const board = Logic.createBoard();
  assert.strictEqual(Logic.isGameOver(board, { red: [], blue: [] }), true);
  assert.strictEqual(Logic.isGameOver(board, {}), true);
});

// ---------- 残りマス集計 ----------

test('remainingSquares は手元ピースのマス総数を返す', () => {
  assert.strictEqual(Logic.remainingSquares(['one', 'five-x']), 6);
  assert.strictEqual(Logic.remainingSquares(Pieces.PIECES.map(p => p.id)), 89);
  assert.strictEqual(Logic.remainingSquares([]), 0);
});

test('smallestPieceSize は一番小さいピースのマス数を返す（ミニマイズ用）', () => {
  assert.strictEqual(Logic.smallestPieceSize(['five-x', 'three-line', 'two']), 2);
  assert.strictEqual(Logic.smallestPieceSize([]), null);
});

// ---------- スコア計算 ----------

test('アドバンススコア：残りマス×-1', () => {
  assert.strictEqual(Logic.advanceScore({ remainingSquares: 8, piecesRemaining: 2, lastPlacedSize: 5 }), -8);
  assert.strictEqual(Logic.advanceScore({ remainingSquares: 89, piecesRemaining: 21, lastPlacedSize: null }), -89);
});

test('アドバンススコア：全配置で+15、最後が1マスなら+20', () => {
  assert.strictEqual(Logic.advanceScore({ remainingSquares: 0, piecesRemaining: 0, lastPlacedSize: 5 }), 15);
  assert.strictEqual(Logic.advanceScore({ remainingSquares: 0, piecesRemaining: 0, lastPlacedSize: 1 }), 20);
});

test('魔法使いスコア：残りマスをそのまま返す', () => {
  assert.strictEqual(Logic.wizardScore({ remainingSquares: 12 }), 12);
  assert.strictEqual(Logic.wizardScore({ remainingSquares: 0 }), 0);
});

test('finalScores 通常モード4人：最高得点が勝者', () => {
  const perColor = {
    blue: { remainingSquares: 10, piecesRemaining: 3, lastPlacedSize: 3 },
    yellow: { remainingSquares: 4, piecesRemaining: 1, lastPlacedSize: 4 },
    red: { remainingSquares: 0, piecesRemaining: 0, lastPlacedSize: 1 },
    green: { remainingSquares: 20, piecesRemaining: 5, lastPlacedSize: 2 }
  };
  const players = [
    { id: 'p1', colors: ['blue'] },
    { id: 'p2', colors: ['yellow'] },
    { id: 'p3', colors: ['red'] },
    { id: 'p4', colors: ['green'] }
  ];
  const result = Logic.finalScores(players, perColor, 'normal');
  assert.deepStrictEqual(result.scores, { p1: -10, p2: -4, p3: 20, p4: -20 });
  assert.deepStrictEqual(result.winners, ['p3']);
});

test('finalScores 通常モード2人：担当2色の合計で競う', () => {
  const perColor = {
    blue: { remainingSquares: 5, piecesRemaining: 2, lastPlacedSize: 2 },
    red: { remainingSquares: 3, piecesRemaining: 1, lastPlacedSize: 3 },
    yellow: { remainingSquares: 0, piecesRemaining: 0, lastPlacedSize: 4 },
    green: { remainingSquares: 30, piecesRemaining: 8, lastPlacedSize: 5 }
  };
  const players = [
    { id: 'p1', colors: ['blue', 'red'] },
    { id: 'p2', colors: ['yellow', 'green'] }
  ];
  const result = Logic.finalScores(players, perColor, 'normal');
  assert.deepStrictEqual(result.scores, { p1: -8, p2: -15 });
  assert.deepStrictEqual(result.winners, ['p1']);
});

test('finalScores 魔法使いモード2人：残りマスが多い方の色で判定し、少ない方が勝ち', () => {
  const perColor = {
    blue: { remainingSquares: 8, piecesRemaining: 2, lastPlacedSize: 2 },
    red: { remainingSquares: 22, piecesRemaining: 6, lastPlacedSize: 5 },
    yellow: { remainingSquares: 15, piecesRemaining: 4, lastPlacedSize: 3 },
    green: { remainingSquares: 15, piecesRemaining: 4, lastPlacedSize: 3 }
  };
  const players = [
    { id: 'p1', colors: ['blue', 'red'] },
    { id: 'p2', colors: ['yellow', 'green'] }
  ];
  const result = Logic.finalScores(players, perColor, 'wizard');
  assert.deepStrictEqual(result.scores, { p1: 22, p2: 15 });
  assert.deepStrictEqual(result.winners, ['p2']);
});

test('finalScores 魔法使いモード3人：フリーピースの色はスコアから除外される', () => {
  const perColor = {
    blue: { remainingSquares: 9, piecesRemaining: 2, lastPlacedSize: 2 },
    yellow: { remainingSquares: 9, piecesRemaining: 3, lastPlacedSize: 3 },
    red: { remainingSquares: 12, piecesRemaining: 4, lastPlacedSize: 4 }
    // green はフリーピース：perColor に含めない（＝どのプレイヤーにも割り当てない）
  };
  const players = [
    { id: 'p1', colors: ['blue'] },
    { id: 'p2', colors: ['yellow'] },
    { id: 'p3', colors: ['red'] }
  ];
  const result = Logic.finalScores(players, perColor, 'wizard');
  assert.deepStrictEqual(result.scores, { p1: 9, p2: 9, p3: 12 });
  assert.deepStrictEqual(result.winners, ['p1', 'p2']); // 同点は複数勝者
});

console.log('logic.test.js: ' + passed + ' tests passed');
