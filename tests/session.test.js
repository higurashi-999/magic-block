/* session.test.js - オンライン対戦プロトコルの統合テスト（Node, 追加依存なし）
 * フェイク Peer の代わりに、インメモリの関数リンクで session 同士を直結する。 */
'use strict';
const assert = require('node:assert');
const Session = require('../js/session.js');
const State = require('../js/state.js');
const Cpu = require('../js/cpu.js');

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
function clone(o) { return JSON.parse(JSON.stringify(o)); }

/* ホスト本人の受信箱 */
function routeLocal(rec, msg) {
  if (msg.t === 'lobby') rec.lobbies.push(msg.lobby);
  else if (msg.t === 'state') rec.states.push(msg);
  else if (msg.t === 'error') rec.errors.push(msg);
  else if (msg.t === 'notice') rec.notices.push(msg);
  else if (msg.t === 'ended') rec.ended = msg;
}

function makeHost(seed) {
  const rec = { lobbies: [], states: [], errors: [], notices: [], ended: null };
  const host = Session.createHostSession({
    code: 'TEST', hostName: 'ホスト', rng: makeRng(seed || 42),
    sendLocal: (msg) => routeLocal(rec, msg)
  });
  rec.host = host;
  return rec;
}

function makeGuest(hostRec, name) {
  const host = hostRec.host;
  const rec = { lobbies: [], states: [], errors: [], notices: [], ended: null, welcome: null };
  let key = null;
  const guest = Session.createGuestSession({
    name: name,
    send: (msg) => host.receive(key, msg),
    onWelcome: (m) => { rec.welcome = m; },
    onLobby: (l) => rec.lobbies.push(l),
    onState: (m) => rec.states.push(m),
    onError: (m) => rec.errors.push(m),
    onNotice: (m) => rec.notices.push(m),
    onEnded: (m) => { rec.ended = m; }
  });
  key = host.attachGuest((msg) => guest.receive(msg));
  rec.guest = guest;
  rec.key = key;
  guest.connect();
  return rec;
}

function lastLobby(rec) { return rec.lobbies[rec.lobbies.length - 1]; }
function lastState(rec) { return rec.states[rec.states.length - 1]; }
function lastError(rec) { return rec.errors[rec.errors.length - 1]; }

function declareLocal(hostRec, characterId, partnerId) {
  hostRec.host.receive('local', { t: 'declare', characterId, partnerId });
}

/* 全員の最新公開 state がホストの公開 state と一致すること */
function assertConverged(hostRec, recs) {
  const pub = Session.publicState(hostRec.host.getGameState());
  recs.forEach((rec) => {
    assert.ok(rec.states.length > 0, 'state を受信していること');
    assert.deepStrictEqual(lastState(rec).state, pub, '公開 state が全員一致すること');
  });
}

/* CPU思考で現在の操作者の手を送り、ゲームを最後まで進める */
function driveGame(hostRec, guestRecs, seed) {
  const host = hostRec.host;
  const rng = makeRng(seed || 7);
  const byKey = {};
  guestRecs.forEach((g) => { byKey[g.key] = g; });
  let guard = 0;
  while (true) {
    const s = host.getGameState();
    if (!s || s.phase === 'finished') break;
    assert.ok(guard++ < 5000, '手数ガード以内に終了すること');
    if (host.stepAutomation()) continue; // CPU席・切断席はホストが進める
    const info = State.getTurnInfo(s);
    const seat = host.getLobby().seats.find((x) => x.playerId === info.controllerId);
    assert.ok(seat, '操作者の席が見つかること');
    const mv = Cpu.chooseMove(s, 2, rng);
    assert.ok(mv, 'CPU思考が手を返すこと');
    const before = JSON.stringify(s);
    if (seat.key === 'local') host.receive('local', { t: 'move', move: mv });
    else byKey[seat.key].guest.sendMove(mv);
    assert.notStrictEqual(JSON.stringify(host.getGameState()), before,
      '手が適用されて state が進むこと: ' + JSON.stringify(mv));
  }
  return host.getGameState();
}

/* ホスト＋ゲスト1人を宣言まで済ませたロビー（2人戦・select フェーズ） */
function lobby2p(seed) {
  const hostRec = makeHost(seed);
  const g1 = makeGuest(hostRec, 'ゲスト1');
  hostRec.host.beginSelect();
  return { hostRec, g1 };
}

// ---------- ロビー ----------

test('ロビー：ゲストが参加すると welcome とロビーが全員へ届く', () => {
  const hostRec = makeHost(1);
  const g1 = makeGuest(hostRec, 'ゲスト1');
  assert.ok(g1.welcome, 'welcome を受信すること');
  assert.strictEqual(g1.welcome.key, g1.key);
  const lobby = lastLobby(g1);
  assert.strictEqual(lobby.phase, 'waiting');
  assert.strictEqual(lobby.seats.length, 2);
  assert.strictEqual(lobby.seats[0].isHost, true);
  assert.strictEqual(lobby.seats[1].name, 'ゲスト1');
  assert.strictEqual(lastLobby(hostRec).seats.length, 2, 'ホスト本人にもロビーが届くこと');
});

test('ロビー：満員（4席）の部屋には参加できず、開始後の参加も拒否される', () => {
  const hostRec = makeHost(2);
  makeGuest(hostRec, 'G1'); makeGuest(hostRec, 'G2'); makeGuest(hostRec, 'G3');
  const g5 = makeGuest(hostRec, 'G5');
  assert.strictEqual(lastError(g5).reason, 'room-full');
  assert.strictEqual(lastLobby(hostRec).seats.length, 4);

  const h2 = makeHost(3);
  makeGuest(h2, '先客');
  assert.strictEqual(h2.host.beginSelect().ok, true);
  const late = makeGuest(h2, '遅刻');
  assert.strictEqual(lastError(late).reason, 'already-started');
});

test('ロビー：キャラ選択開始には2席以上が必要', () => {
  const hostRec = makeHost(4);
  const r = hostRec.host.beginSelect();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'too-few-players');
});

// ---------- 宣言の仲裁 ----------

test('宣言：生徒・相棒の重複は仲裁され、2人戦の色ペア競合も防がれる', () => {
  const { hostRec, g1 } = lobby2p(5);
  declareLocal(hostRec, 'sora', 'eagle'); // 青（ペア: 青+赤）
  let seat = lastLobby(hostRec).seats.find((s) => s.isHost);
  assert.strictEqual(seat.declared, true);

  g1.guest.declare('sora', 'badger'); // 生徒が重複
  assert.strictEqual(lastError(g1).reason, 'already-taken');

  g1.guest.declare('ren', 'lion'); // 赤は青と同ペア → 2人戦では競合
  assert.strictEqual(lastError(g1).reason, 'pair-conflict');

  g1.guest.declare('ren', 'badger'); // 黄なら OK
  assert.strictEqual(lastLobby(g1).allDeclared, true);
  const gSeat = lastLobby(g1).seats.find((s) => s.key === g1.key);
  assert.strictEqual(gSeat.characterId, 'ren');
  assert.strictEqual(gSeat.partnerId, 'badger');
});

// ---------- 対戦の同期と検証 ----------

test('対戦：開始で全員へ state が届き、不正な move は拒否されて state が変わらない', () => {
  const hostRec = makeHost(6);
  const g1 = makeGuest(hostRec, 'ゲスト1');
  assert.strictEqual(hostRec.host.addCpu(2).ok, true);
  hostRec.host.beginSelect();
  declareLocal(hostRec, 'sora', 'eagle'); // 青
  g1.guest.declare('hikari', 'lion');     // 赤
  const started = hostRec.host.startGame('normal');
  assert.strictEqual(started.ok, true, JSON.stringify(started));
  assertConverged(hostRec, [hostRec, g1]);

  const before = JSON.stringify(hostRec.host.getGameState());
  // 初手は青＝ホストの番。ゲストが手を送っても拒否される
  g1.guest.sendMove({ type: 'pass' });
  assert.strictEqual(lastError(g1).reason, 'not-your-turn');
  assert.strictEqual(JSON.stringify(hostRec.host.getGameState()), before, 'state が変わらないこと');

  // ホスト本人が不正配置（隅を覆わない初手）を送っても拒否される
  hostRec.host.receive('local', {
    t: 'move',
    move: { type: 'place', pieceId: 'one', variantIndex: 0, origin: [5, 5] }
  });
  assert.ok(hostRec.errors.length > 0, 'ホスト本人にもエラーが届くこと');
  assert.strictEqual(JSON.stringify(hostRec.host.getGameState()), before, 'state が変わらないこと');

  // 正しい初手は受理され、全員の state が進む
  const mv = Cpu.chooseMove(hostRec.host.getGameState(), 2, makeRng(9));
  hostRec.host.receive('local', { t: 'move', move: mv });
  assert.notStrictEqual(JSON.stringify(hostRec.host.getGameState()), before);
  assertConverged(hostRec, [hostRec, g1]);
});

test('対戦：CPU席混在（人間2＋CPU2・通常モード）で最後まで進み state が一致する', () => {
  const hostRec = makeHost(10);
  const g1 = makeGuest(hostRec, 'ゲスト1');
  hostRec.host.addCpu(1);
  hostRec.host.addCpu(3);
  hostRec.host.beginSelect();
  declareLocal(hostRec, 'sora', 'eagle');
  g1.guest.declare('hikari', 'badger');
  assert.strictEqual(hostRec.host.startGame('normal').ok, true);
  const finalState = driveGame(hostRec, [g1], 11);
  assert.strictEqual(finalState.phase, 'finished');
  assert.ok(finalState.results && finalState.results.winners.length > 0, '勝者が決まること');
  assertConverged(hostRec, [hostRec, g1]);
});

// ---------- 秘匿情報 ----------

test('秘匿：魔法使いモードで他人の手札の中身は配信されず、自分の手札だけ private で届く', () => {
  const { hostRec, g1 } = lobby2p(20);
  declareLocal(hostRec, 'sora', 'eagle');
  g1.guest.declare('ren', 'badger');
  assert.strictEqual(hostRec.host.startGame('wizard').ok, true);

  // 初手を置き終えるまで進める（初期ドローで各自2枚になる）
  const rng = makeRng(21);
  let guard = 0;
  while (hostRec.host.getGameState().phase === 'opening') {
    assert.ok(guard++ < 100);
    if (hostRec.host.stepAutomation()) continue;
    const s = hostRec.host.getGameState();
    const info = State.getTurnInfo(s);
    const seat = hostRec.host.getLobby().seats.find((x) => x.playerId === info.controllerId);
    const mv = Cpu.chooseMove(s, 2, rng);
    if (seat.key === 'local') hostRec.host.receive('local', { t: 'move', move: mv });
    else g1.guest.sendMove(mv);
  }
  const real = hostRec.host.getGameState();
  [hostRec, g1].forEach((rec) => {
    const st = lastState(rec);
    assert.ok(st, 'state を受信していること');
    // 公開 state のデッキは枚数だけ（hand/draw の中身は無い）
    Object.keys(st.state.decks).forEach((pid) => {
      const d = st.state.decks[pid];
      assert.strictEqual(typeof d.handCount, 'number');
      assert.strictEqual(typeof d.drawCount, 'number');
      assert.ok(!('hand' in d) && !('draw' in d), '手札・山札の中身が含まれないこと');
      assert.strictEqual(d.handCount, real.decks[pid].hand.length, '手札枚数は公開情報として一致');
    });
    // private は自分の playerId と自分の手札だけ
    const myPid = st.private.playerId;
    assert.ok(myPid, '自分の playerId が分かること');
    assert.deepStrictEqual(st.private.hand, real.decks[myPid].hand, '自分の手札は実データで届く');
    assert.strictEqual(st.private.hand.length, 2, '初期ドロー2枚');
  });
  // ホストとゲストで private の playerId が異なる（他人の手札は届いていない）
  assert.notStrictEqual(lastState(hostRec).private.playerId, lastState(g1).private.playerId);
});

test('対戦：魔法使いモード2人戦がカード使用込みで最後まで進む', () => {
  const { hostRec, g1 } = lobby2p(30);
  declareLocal(hostRec, 'sora', 'eagle');
  g1.guest.declare('ren', 'badger');
  assert.strictEqual(hostRec.host.startGame('wizard').ok, true);
  const finalState = driveGame(hostRec, [g1], 31);
  assert.strictEqual(finalState.phase, 'finished');
  const discarded = finalState.players.reduce((sum, p) => sum + finalState.decks[p.id].discard.length, 0);
  assert.ok(discarded > 0, 'カードが実際に使われていること');
  assertConverged(hostRec, [hostRec, g1]);
});

// ---------- 切断・終了 ----------

test('切断：ゲストが切断しても席が保持され、ホストの自動進行で最後まで進む', () => {
  const { hostRec, g1 } = lobby2p(40);
  declareLocal(hostRec, 'sora', 'eagle');
  g1.guest.declare('ren', 'badger');
  assert.strictEqual(hostRec.host.startGame('normal').ok, true);
  hostRec.host.detachGuest(g1.key);
  const seat = hostRec.host.getLobby().seats.find((s) => s.key === g1.key);
  assert.ok(seat, '対戦中の切断では席が保持されること');
  assert.strictEqual(seat.connected, false);
  // 以後はゲストの手番も stepAutomation で進む（driveGame は自動進行を先に試す）
  const finalState = driveGame(hostRec, [], 41);
  assert.strictEqual(finalState.phase, 'finished');
});

test('終了：ホストが部屋を閉じるとゲストへ ended が届く', () => {
  const hostRec = makeHost(50);
  const g1 = makeGuest(hostRec, 'ゲスト1');
  hostRec.host.close();
  assert.ok(g1.ended, 'ended が届くこと');
  assert.strictEqual(g1.ended.reason, 'host-left');
});

console.log('session.test.js: ' + passed + ' tests passed');
