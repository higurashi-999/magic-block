/* state.test.js - 対戦ステートマシンのテスト（Node, 追加依存なし） */
'use strict';
const assert = require('node:assert');
const State = require('../js/state.js');
const Logic = require('../js/logic.js');
const Pieces = require('../js/pieces.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

/* 決定的乱数（mulberry32） */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

/* 現在の手番でピース pieceId の合法手を探して置く（なければ最初の合法手） */
function placeOne(state, pieceId) {
  const moves = State.legalMovesForTurn(state);
  assert.ok(moves.length > 0, '合法手があること');
  const m = moves.find(mv => mv.pieceId === pieceId) || moves[0];
  return applyOk(state, { type: 'place', pieceId: m.pieceId, variantIndex: m.variantIndex, origin: m.origin });
}

/* 全色の初手を 'one' で置き終えた state を返す */
function afterOpening(config) {
  let s = State.createGame(config);
  for (let i = 0; i < 4; i++) s = placeOne(s, 'one');
  assert.strictEqual(s.phase, 'playing');
  return s;
}

/* 現在の手番プレイヤーの手札を差し替える（元 state を直接編集してよい場面用） */
function setHand(state, playerId, cards) {
  state.decks[playerId].hand = cards.slice();
  // カードステップ判定は startTurn 時点で決まるため、現在の手番なら turn.step も合わせる
  const info = State.getTurnInfo(state);
  if (info.controllerId === playerId && info.step !== 'card' && cards.length > 0 && !info.cardSealed) {
    state.turn.step = 'card';
  }
  return state;
}

// ---------- ゲーム作成 ----------

test('ゲーム作成：相棒から色が決まり、初手は青の番', () => {
  const s = State.createGame({ mode: 'normal', players: players4() });
  assert.strictEqual(s.phase, 'opening');
  assert.deepStrictEqual(State.playerById(s, 'p1').colors, ['blue']);
  assert.deepStrictEqual(State.playerById(s, 'p3').colors, ['red']);
  assert.strictEqual(s.freeColor, null);
  const info = State.getTurnInfo(s);
  assert.strictEqual(info.color, 'blue');
  assert.strictEqual(info.controllerId, 'p1');
  assert.strictEqual(Object.keys(s.hands).length, 4);
  assert.strictEqual(s.hands.blue.length, 21);
});

test('ゲーム作成：2人戦ペア検証（ライオン=赤は青とペア）', () => {
  const s2 = State.createGame({
    mode: 'normal',
    players: [
      { id: 'a', partnerId: 'lion' },   // 赤 → [blue, red]
      { id: 'b', partnerId: 'badger' }  // 黄 → [yellow, green]
    ]
  });
  assert.deepStrictEqual(State.playerById(s2, 'a').colors, ['blue', 'red']);
  assert.deepStrictEqual(State.playerById(s2, 'b').colors, ['yellow', 'green']);
  assert.strictEqual(s2.freeColor, null);
  const s3 = State.createGame({
    mode: 'normal',
    players: [
      { id: 'a', partnerId: 'eagle' },
      { id: 'b', partnerId: 'badger' },
      { id: 'c', partnerId: 'lion' }
    ]
  });
  assert.strictEqual(s3.freeColor, 'green');
});

test('applyMove は元の state を変更しない', () => {
  const s = State.createGame({ mode: 'normal', players: players4() });
  const snapshot = JSON.stringify(s);
  const moves = State.legalMovesForTurn(s);
  const m = moves[0];
  State.applyMove(s, { type: 'place', pieceId: m.pieceId, variantIndex: m.variantIndex, origin: m.origin });
  assert.strictEqual(JSON.stringify(s), snapshot);
});

// ---------- 通常モード ----------

test('通常モード：初手ラウンドを終えると playing になり青の番に戻る', () => {
  const s = afterOpening({ mode: 'normal', players: players4() });
  const info = State.getTurnInfo(s);
  assert.strictEqual(info.color, 'blue');
  Logic.TURN_ORDER.forEach(c => assert.strictEqual(s.openingDone[c], true));
});

test('通常モード：置けるのにパスはできない', () => {
  const s = afterOpening({ mode: 'normal', players: players4() });
  const r = State.applyMove(s, { type: 'pass' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'has-legal-moves');
});

test('通常モード：全員パスまで進めると終了し結果が出る（不変条件つき）', () => {
  let s = State.createGame({ mode: 'normal', players: players4() });
  let guard = 0;
  while (s.phase !== 'finished' && guard++ < 500) {
    const moves = State.legalMovesForTurn(s);
    if (moves.length > 0) {
      const m = moves[0];
      s = applyOk(s, { type: 'place', pieceId: m.pieceId, variantIndex: m.variantIndex, origin: m.origin });
    } else {
      s = applyOk(s, { type: 'pass' });
    }
  }
  assert.strictEqual(s.phase, 'finished');
  assert.ok(s.results);
  Logic.TURN_ORDER.forEach(color => {
    let onBoard = 0;
    s.board.forEach(row => row.forEach(cell => { if (cell === color) onBoard++; }));
    const remaining = Logic.remainingSquares(s.hands[color]);
    assert.strictEqual(onBoard + remaining, 89, color + ' のマス数保存');
    const info = s.results.perColor[color];
    assert.strictEqual(info.remainingSquares, remaining);
  });
  // 勝者はスコア最大のプレイヤー
  const scores = s.results.scores;
  const max = Math.max(...Object.values(scores));
  s.results.winners.forEach(id => assert.strictEqual(scores[id], max));
});

// ---------- 魔法使いモード：準備 ----------

test('魔法使い：デッキは14枚で内訳が SPEC 通り', () => {
  const deck = State.buildDeck(makeRng(42));
  assert.strictEqual(deck.length, 14);
  const counts = {};
  deck.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
  Object.keys(State.CARD_DEFS).forEach(t => {
    assert.strictEqual(counts[t] || 0, State.CARD_DEFS[t].count, t);
  });
});

test('魔法使い：初手後に各プレイヤーが2枚引く', () => {
  const s = afterOpening({ mode: 'wizard', players: players4(), rng: makeRng(7) });
  s.players.forEach(p => {
    assert.strictEqual(s.decks[p.id].hand.length, 2, p.id + ' の手札');
    assert.strictEqual(s.decks[p.id].draw.length, 12, p.id + ' の山札');
  });
  const info = State.getTurnInfo(s);
  assert.strictEqual(info.step, 'card'); // 青の手番はカードステップから
});

test('魔法使い：2人戦は28枚混合デッキで手札共用・スコアは max 方式', () => {
  const s = State.createGame({
    mode: 'wizard',
    players: [
      { id: 'a', partnerId: 'lion' },
      { id: 'b', partnerId: 'badger' }
    ],
    rng: makeRng(3)
  });
  assert.strictEqual(s.decks.a.draw.length, 28);
  assert.strictEqual(s.decks.b.draw.length, 28);
  // スコア：担当2色のうち残りマスが多い方で判定
  s.hands.blue = ['five-i', 'three-line'];       // 8
  s.hands.red = ['five-i', 'five-l', 'five-p', 'three-corner', 'two']; // 20
  s.hands.yellow = ['five-t', 'five-u', 'four-t', 'three-line'];       // 17
  s.hands.green = ['five-v', 'five-w', 'four-l', 'one'];               // 15
  const res = State.computeResults(s);
  assert.strictEqual(res.scores.a, 20);
  assert.strictEqual(res.scores.b, 17);
  assert.deepStrictEqual(res.winners, ['b']);
});

// ---------- 魔法使いモード：カード効果 ----------

test('ツインキャスト：1手番に2個置ける（2個目は1個目と角接続）', () => {
  let s = afterOpening({ mode: 'wizard', players: players4(), rng: makeRng(11) });
  const info = State.getTurnInfo(s); // blue / p1
  s = setHand(s, 'p1', ['twin', 'sleep']);
  s.hands.blue = ['two', 'one', 'three-line'];
  s = applyOk(s, { type: 'playCard', cardIndex: 0 });
  let moves = State.legalMovesForTurn(s);
  const m1 = moves.find(mv => mv.pieceId === 'two');
  s = applyOk(s, { type: 'place', pieceId: m1.pieceId, variantIndex: m1.variantIndex, origin: m1.origin });
  // まだ青の番で、2個目の候補は1個目と角でつながるものだけ
  assert.strictEqual(State.getTurnInfo(s).color, 'blue');
  moves = State.legalMovesForTurn(s);
  assert.ok(moves.length > 0);
  moves.forEach(mv => {
    const touches = mv.cells.some(c => m1.cells.some(f => Math.abs(c[0] - f[0]) === 1 && Math.abs(c[1] - f[1]) === 1));
    assert.ok(touches, '2個目は1個目と角でつながる');
  });
  const m2 = moves[0];
  s = applyOk(s, { type: 'place', pieceId: m2.pieceId, variantIndex: m2.variantIndex, origin: m2.origin });
  assert.strictEqual(State.getTurnInfo(s).color, 'yellow'); // 手番が進む
});

test('ぴたっとボンド：自色との辺接配置ができる', () => {
  let s = afterOpening({ mode: 'wizard', players: players4(), rng: makeRng(12) });
  s = setHand(s, 'p1', ['bond']);
  s.hands.blue = ['two'];
  s = applyOk(s, { type: 'playCard', cardIndex: 0 });
  // 青の初手ピース 'one' の位置を特定し、その真横にドミノを置く
  const placed = s.placedPieces.blue[0].cells[0];
  const origin = [placed[0] + 1, placed[1]];
  const variants = Pieces.variantsOf('two');
  let done = false;
  for (let v = 0; v < variants.length && !done; v++) {
    const r = State.applyMove(s, { type: 'place', pieceId: 'two', variantIndex: v, origin });
    if (r.ok) { s = r.state; done = true; }
  }
  assert.ok(done, '辺接配置が成功すること');
});

test('すやすやパウダー：次のプレイヤーはカードを使えない', () => {
  let s = afterOpening({ mode: 'wizard', players: players4(), rng: makeRng(13) });
  s = setHand(s, 'p1', ['sleep']);
  s = applyOk(s, { type: 'playCard', cardIndex: 0 });
  s = placeOne(s);
  const info = State.getTurnInfo(s);
  assert.strictEqual(info.color, 'yellow');
  assert.strictEqual(info.cardSealed, true);
  assert.strictEqual(info.step, 'place'); // カードステップを飛ばす
  const r = State.applyMove(s, { type: 'playCard', cardIndex: 0 });
  assert.strictEqual(r.ok, false);
});

test('ミニマイズ：次のプレイヤーは一番小さいピースしか置けない', () => {
  let s = afterOpening({ mode: 'wizard', players: players4(), rng: makeRng(14) });
  s = setHand(s, 'p1', ['minimize']);
  s = applyOk(s, { type: 'playCard', cardIndex: 0 });
  s = placeOne(s);
  const info = State.getTurnInfo(s);
  assert.strictEqual(info.color, 'yellow');
  assert.strictEqual(info.forcedSmallest, true);
  s.hands.yellow = ['five-i', 'two'];
  const moves = State.legalMovesForTurn(s);
  assert.ok(moves.length > 0);
  assert.ok(moves.every(mv => mv.pieceId === 'two'), '最小ピースのみ合法');
  s.decks.p2.hand = []; s.turn.step = 'place'; // 黄がカードを出し終えた状態にする
  const bad = State.applyMove(s, { type: 'place', pieceId: 'five-i', variantIndex: 0, origin: [0, 0] });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.reason, 'forced-smallest');
});

test('チョイススペル：次のプレイヤーのピースを指定できる', () => {
  let s = afterOpening({ mode: 'wizard', players: players4(), rng: makeRng(15) });
  s = setHand(s, 'p1', ['choice']);
  s.hands.yellow = ['five-i', 'two', 'one'];
  s = applyOk(s, { type: 'playCard', cardIndex: 0, target: { pieceId: 'five-i' } });
  s = placeOne(s);
  const info = State.getTurnInfo(s);
  assert.strictEqual(info.color, 'yellow');
  assert.strictEqual(info.forcedPieceId, 'five-i');
  const moves = State.legalMovesForTurn(s);
  assert.ok(moves.every(mv => mv.pieceId === 'five-i'));
  s.decks.p2.hand = []; s.turn.step = 'place'; // 黄がカードを出し終えた状態にする
  const bad = State.applyMove(s, { type: 'place', pieceId: 'two', variantIndex: 0, origin: [0, 0] });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.reason, 'forced-piece');
});

test('ピースロック：指定ピースが使用不可になり、残りマスには数えられる', () => {
  let s = afterOpening({ mode: 'wizard', players: players4(), rng: makeRng(16) });
  s = setHand(s, 'p1', ['lock']);
  const before = Logic.remainingSquares(s.hands.yellow);
  s = applyOk(s, { type: 'playCard', cardIndex: 0, target: { pieceId: 'five-x' } });
  assert.ok(State.usablePieces(s, 'yellow').indexOf('five-x') < 0, '使用不可になる');
  assert.ok(s.hands.yellow.indexOf('five-x') >= 0, '手元には残る');
  assert.strictEqual(Logic.remainingSquares(s.hands.yellow), before, '残りマスに数えられる');
});

test('リコール：配置済みピースを手元に戻せる', () => {
  let s = afterOpening({ mode: 'wizard', players: players4(), rng: makeRng(17) });
  s = setHand(s, 'p1', ['recall']);
  const cell = s.placedPieces.blue[0].cells[0];
  const handBefore = s.hands.blue.length;
  s = applyOk(s, { type: 'playCard', cardIndex: 0, target: { pieceIndex: 0 } });
  assert.strictEqual(s.hands.blue.length, handBefore + 1);
  assert.ok(s.hands.blue.indexOf('one') >= 0);
  assert.strictEqual(s.board[cell[1]][cell[0]], null, '盤面から消える');
  assert.strictEqual(s.placedPieces.blue.length, 0);
});

test('ワープゲート：相手のピースを角接続する別の場所へ移動できる', () => {
  let s = afterOpening({ mode: 'wizard', players: players4(), rng: makeRng(18) });
  s = setHand(s, 'p1', ['warp']);
  // 赤の配置済みピース（初手 'one'）を、赤の他のピース…が無いため隅への移動になる。
  // 赤にもう1ピース置いた状態を再現する代わりに、盤面から赤を除いた合法移動先を探す
  const target = s.placedPieces.red[0];
  const board = Logic.cloneBoard(s.board);
  target.cells.forEach(([x, y]) => { board[y][x] = null; });
  const dests = Logic.legalMoves(board, 'red', ['one'], { firstMove: !Logic.colorOnBoard(board, 'red') });
  assert.ok(dests.length > 0);
  const dest = dests.find(d => !(d.cells[0][0] === target.cells[0][0] && d.cells[0][1] === target.cells[0][1])) || dests[0];
  s = applyOk(s, {
    type: 'playCard', cardIndex: 0,
    target: { color: 'red', pieceIndex: 0, variantIndex: dest.variantIndex, origin: dest.origin }
  });
  assert.deepStrictEqual(s.placedPieces.red[0].cells, dest.cells);
  dest.cells.forEach(([x, y]) => assert.strictEqual(s.board[y][x], 'red'));
});

test('魔法使い：置けない手番はパスでき、カードを1枚引いて手番が進む', () => {
  let s = afterOpening({ mode: 'wizard', players: players4(), rng: makeRng(19) });
  // 青の手元ピースを空にし、手札も空にする（配置ステップから始まる）
  s.hands.blue = [];
  s.decks.p1.hand = [];
  s.turn.step = 'place';
  const drawBefore = s.decks.p1.draw.length;
  s = applyOk(s, { type: 'pass' });
  assert.strictEqual(State.getTurnInfo(s).color, 'yellow');
  assert.strictEqual(s.decks.p1.draw.length, drawBefore - 1, 'パス後も1枚引く');
  assert.strictEqual(s.passed.blue, false, '魔法使いモードのパスは脱落ではない');
});

// ---------- 3人戦（フリーピース） ----------

test('魔法使い3人戦：フリー手番はカードを伏せて捨て、操作プレイヤーが交代する', () => {
  let s = State.createGame({
    mode: 'wizard',
    players: [
      { id: 'a', partnerId: 'eagle' },
      { id: 'b', partnerId: 'badger' },
      { id: 'c', partnerId: 'lion' }
    ],
    rng: makeRng(21)
  });
  assert.strictEqual(s.freeColor, 'green');
  for (let i = 0; i < 4; i++) s = placeOne(s, 'one');
  assert.strictEqual(s.phase, 'playing');
  // フリー（緑）の手番まで進める
  let guard = 0;
  const freeControllers = [];
  let prevDiscard = s.decks.free.discard.length;
  while (guard++ < 40) {
    const info = State.getTurnInfo(s);
    if (info.color === 'green') {
      assert.strictEqual(info.isFree, true);
      assert.strictEqual(info.step, 'place', 'フリー手番にカードステップはない');
      assert.ok(s.decks.free.discard.length > prevDiscard, 'カードが伏せて捨てられる');
      prevDiscard = s.decks.free.discard.length;
      freeControllers.push(info.controllerId);
      if (freeControllers.length >= 2) break;
    }
    // カードステップなら最初のカードを出し、置けるなら置く
    if (info.step === 'card') {
      s = applyOk(s, { type: 'playCard', cardIndex: 0 });
    }
    const moves = State.legalMovesForTurn(s);
    if (moves.length > 0) {
      const m = moves[0];
      s = applyOk(s, { type: 'place', pieceId: m.pieceId, variantIndex: m.variantIndex, origin: m.origin });
      // ツインで2個目が残った場合はパスで締める
      if (State.getTurnInfo(s).color === info.color && State.getTurnInfo(s).step === 'place' && s.phase !== 'finished') {
        const r = State.applyMove(s, { type: 'pass' });
        if (r.ok) s = r.state;
      }
    } else {
      s = applyOk(s, { type: 'pass' });
    }
    if (s.phase === 'finished') break;
  }
  assert.strictEqual(freeControllers.length, 2);
  assert.notStrictEqual(freeControllers[0], freeControllers[1], 'フリーの操作者が交代する');
});

test('通常3人戦：フリーピースの色はスコア計算から除外される', () => {
  const s = State.createGame({
    mode: 'normal',
    players: [
      { id: 'a', partnerId: 'eagle' },
      { id: 'b', partnerId: 'badger' },
      { id: 'c', partnerId: 'lion' }
    ]
  });
  s.hands.blue = ['two'];        // -2
  s.hands.yellow = ['three-line']; // -3
  s.hands.red = [];              // 全配置・最後5マスではない想定 → lastPlacedで決まる
  s.lastPlaced.red = 5;
  s.hands.green = ['five-i'];    // フリー：結果に影響しないこと
  const res = State.computeResults(s);
  assert.strictEqual(res.scores.a, -2);
  assert.strictEqual(res.scores.b, -3);
  assert.strictEqual(res.scores.c, 15);
  assert.deepStrictEqual(res.winners, ['c']);
});

console.log('state.test.js: ' + passed + ' tests passed');
