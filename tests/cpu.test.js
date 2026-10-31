/* cpu.test.js - CPU思考のテスト（Node, 追加依存なし） */
'use strict';
const assert = require('node:assert');
const State = require('../js/state.js');
const Cpu = require('../js/cpu.js');
const Logic = require('../js/logic.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cpuPlayers(n, level) {
  const partners = ['eagle', 'badger', 'lion', 'snake'];
  const ids = ['p1', 'p2', 'p3', 'p4'];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: ids[i], name: 'CPU' + (i + 1), type: 'cpu', cpuLevel: level, partnerId: partners[i] });
  }
  return out;
}

/* CPU 同士で1ゲーム最後まで進行させる。各手が合法であることも検証する */
function playCpuGame(config, level, seed) {
  const rng = makeRng(seed);
  let s = State.createGame(Object.assign({}, config, { rng: makeRng(seed + 1000) }));
  let guard = 0;
  while (s.phase !== 'finished') {
    assert.ok(guard++ < 3000, 'ゲームが終了すること（手数ガード）');
    const mv = Cpu.chooseMove(s, level, rng);
    assert.ok(mv, 'CPU が手を返すこと');
    const r = State.applyMove(s, mv);
    assert.strictEqual(r.ok, true, 'CPU の手が合法: ' + JSON.stringify(mv) + ' -> ' + r.reason);
    s = r.state;
  }
  assert.ok(s.results, '結果が算出されること');
  // 全色で「盤上マス＋残りマス＝89」の不変条件
  Logic.TURN_ORDER.forEach(color => {
    let onBoard = 0;
    s.board.forEach(row => row.forEach(cell => { if (cell === color) onBoard++; }));
    assert.strictEqual(onBoard + Logic.remainingSquares(s.hands[color]), 89, color);
  });
  return s;
}

test('CPU：通常モード4人・各レベルで最後まで進行できる', () => {
  [1, 2, 3].forEach(level => {
    playCpuGame({ mode: 'normal', players: cpuPlayers(4, level) }, level, 100 + level);
  });
});

test('CPU：通常モード2人・3人でも最後まで進行できる', () => {
  playCpuGame({ mode: 'normal', players: cpuPlayers(2, 2) }, 2, 202);
  playCpuGame({ mode: 'normal', players: cpuPlayers(3, 3) }, 3, 203);
});

test('CPU：魔法使いモード4人・各レベルで最後まで進行できる（カード使用含む）', () => {
  [1, 2, 3].forEach(level => {
    const s = playCpuGame({ mode: 'wizard', players: cpuPlayers(4, level) }, level, 300 + level);
    const discarded = s.players.reduce((sum, p) => sum + s.decks[p.id].discard.length, 0);
    assert.ok(discarded > 0, 'カードが実際に使われていること');
  });
});

test('CPU：魔法使いモード2人・3人でも最後まで進行できる', () => {
  playCpuGame({ mode: 'wizard', players: cpuPlayers(2, 2) }, 2, 402);
  playCpuGame({ mode: 'wizard', players: cpuPlayers(3, 1) }, 1, 403);
});

test('CPU：合法手がある局面では pass を返さない（よわい以外）', () => {
  const rng = makeRng(55);
  let s = State.createGame({ mode: 'normal', players: cpuPlayers(4, 3), rng: makeRng(56) });
  // 初手局面では合法手があるので place が返る
  [1, 2, 3].forEach(level => {
    const mv = Cpu.chooseMove(s, level, rng);
    assert.strictEqual(mv.type, 'place');
    const pieceIds = State.usablePieces(s, 'blue');
    assert.ok(pieceIds.indexOf(mv.pieceId) >= 0, '手元にあるピースを置く');
  });
});

test('CPU：置けない局面では pass を返す', () => {
  let s = State.createGame({ mode: 'normal', players: cpuPlayers(4, 2), rng: makeRng(57) });
  s.hands.blue = []; // 手元なし＝置けない
  const mv = Cpu.chooseMove(s, 2, makeRng(58));
  assert.strictEqual(mv.type, 'pass');
});

console.log('cpu.test.js: ' + passed + ' tests passed');
