/*
 * session.js - マジック・ブロック オンライン対戦プロトコル（ホスト権威）
 *
 * トランスポート（PeerJS 等）から独立した純粋ロジック寄りのモジュール。
 * ホストが MagicState のステートマシンを保持し、ゲストの move を検証・適用して
 * 最新 state を全員へ配信する。ゲストは move を送り、配信 state を描画するだけ。
 *
 * メッセージ種別:
 *   ゲスト→ホスト: join {name} / declare {characterId, partnerId} /
 *                  move {move} / leave {}
 *   ホスト→ゲスト: welcome {key, code} / lobby {lobby} /
 *                  state {state, private:{playerId, hand}} /
 *                  error {reason} / notice {text} / ended {reason}
 *
 * 秘匿情報：配信 state（publicState）では各デッキを
 * { drawCount, handCount, discard } に要約し、手札・山札の中身を含めない。
 * 自分の手札だけは private として本人宛ての state メッセージに分離して送る。
 *
 * 席（seat）: { key, name, kind:'human'|'cpu', isHost, connected,
 *               declared, characterId, partnerId, cpuLevel, playerId }
 * ホスト本人の席 key は 'local'。ホストUIは sendLocal 経由で
 * ゲストと同じメッセージ（lobby/state/error）を受け取る。
 */
(function (root, factory) {
  var State = null, Cpu = null;
  if (typeof module !== 'undefined' && module.exports) {
    State = require('./state.js');
    Cpu = require('./cpu.js');
    module.exports = factory(State, Cpu);
  }
  if (root) {
    root.MagicSession = factory(root.MagicState, root.MagicCpu);
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function (State, Cpu) {
  'use strict';

  if (!State) throw new Error('session.js requires state.js (MagicState)');
  if (!Cpu) throw new Error('session.js requires cpu.js (MagicCpu)');

  var LOCAL_KEY = 'local';
  var MAX_SEATS = 4;

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  /* 配信してよい形に state を要約する（手札・山札の中身を落とす） */
  function publicState(state) {
    var pub = clone(state);
    Object.keys(pub.decks || {}).forEach(function (key) {
      var d = pub.decks[key];
      pub.decks[key] = {
        drawCount: d.draw ? d.draw.length : 0,
        handCount: d.hand ? d.hand.length : 0,
        discard: d.discard ? d.discard.slice() : []
      };
    });
    return pub;
  }

  function privateFor(state, playerId) {
    var deck = state && state.decks ? state.decks[playerId] : null;
    return {
      playerId: playerId,
      hand: deck && deck.hand ? deck.hand.slice() : []
    };
  }

  /* ================= ホスト ================= */

  /*
   * options: { code, hostName, rng?, sendLocal(msg) }
   * 使い方:
   *   var key = host.attachGuest(sendFn)   // 接続ごとに呼ぶ。key を返す
   *   host.receive(key, msg)               // ゲスト→ホストのメッセージ
   *   host.receive(LOCAL_KEY, msg)         // ホスト本人の declare / move
   *   host.detachGuest(key)                // 切断
   *   host.addCpu(level) / host.beginSelect() / host.startGame(mode)
   *   host.stepAutomation()                // CPU席・切断席の手番を1手進める
   *   host.close()                         // 部屋を閉じる（ended を全員へ）
   */
  function createHostSession(options) {
    options = options || {};
    var rng = options.rng || Math.random;
    var sendLocal = options.sendLocal || function () {};
    var seats = [];
    var senders = {}; // key -> sendFn（local は sendLocal）
    var guestSeq = 0;
    var phase = 'waiting'; // waiting | select | game
    var game = null;
    var gameMode = null;
    var closed = false;

    function seatByKey(key) {
      for (var i = 0; i < seats.length; i++) if (seats[i].key === key) return seats[i];
      return null;
    }
    function seatByPlayerId(pid) {
      for (var i = 0; i < seats.length; i++) if (seats[i].playerId === pid) return seats[i];
      return null;
    }

    function addSeat(fields) {
      var seat = {
        key: fields.key,
        name: fields.name || 'プレイヤー',
        kind: fields.kind || 'human',
        isHost: !!fields.isHost,
        connected: fields.connected !== false,
        declared: false,
        characterId: null,
        partnerId: null,
        cpuLevel: fields.cpuLevel || 2,
        playerId: null
      };
      seats.push(seat);
      return seat;
    }
    addSeat({ key: LOCAL_KEY, name: options.hostName || 'ホスト', isHost: true });

    function allDeclared() {
      return seats.every(function (s) { return s.kind === 'cpu' || s.declared; });
    }

    function publicLobby() {
      return {
        phase: phase,
        code: options.code || null,
        mode: gameMode,
        allDeclared: allDeclared(),
        seats: seats.map(function (s) {
          return {
            key: s.key, name: s.name, kind: s.kind, isHost: s.isHost,
            connected: s.connected, declared: s.declared,
            characterId: s.characterId, partnerId: s.partnerId,
            cpuLevel: s.cpuLevel, playerId: s.playerId
          };
        })
      };
    }

    function sendTo(key, msg) {
      if (key === LOCAL_KEY) { sendLocal(clone(msg)); return; }
      var fn = senders[key];
      if (fn) fn(clone(msg));
    }
    function sendError(key, reason) { sendTo(key, { t: 'error', reason: reason }); }
    function broadcastLobby() {
      var msg = { t: 'lobby', lobby: publicLobby() };
      seats.forEach(function (s) {
        if (s.kind === 'human') sendTo(s.key, msg);
      });
    }
    /* 現在の game state を各人へ個別化して配信する */
    function syncState() {
      if (!game) return;
      var pub = publicState(game);
      seats.forEach(function (s) {
        if (s.kind !== 'human') return;
        sendTo(s.key, {
          t: 'state',
          state: pub,
          private: privateFor(game, s.playerId)
        });
      });
    }

    /* ---- 参加・切断 ---- */

    function attachGuest(sendFn) {
      guestSeq += 1;
      var key = 'g' + guestSeq;
      senders[key] = sendFn;
      return key;
    }

    function detachGuest(key) {
      if (key === LOCAL_KEY) return;
      var seat = seatByKey(key);
      delete senders[key];
      if (!seat) return;
      if (phase === 'game') {
        // 対戦中は席を保持し、切断扱い（手番はホストが自動で進める）
        seat.connected = false;
        broadcastLobby();
      } else {
        // 対戦前なら席ごと取り除く（空席として再参加できる）
        seats = seats.filter(function (s) { return s.key !== key; });
        broadcastLobby();
      }
    }

    /* ---- ロビー操作（ホストUIから直接呼ぶ） ---- */

    function addCpu(level) {
      if (phase !== 'waiting') return { ok: false, reason: 'not-waiting' };
      if (seats.length >= MAX_SEATS) return { ok: false, reason: 'room-full' };
      var n = seats.filter(function (s) { return s.kind === 'cpu'; }).length + 1;
      addSeat({ key: 'cpu' + n + '-' + seats.length, name: 'CPU' + n, kind: 'cpu', cpuLevel: level || 2 });
      broadcastLobby();
      return { ok: true };
    }

    function beginSelect() {
      if (phase !== 'waiting') return { ok: false, reason: 'not-waiting' };
      if (seats.length < 2) return { ok: false, reason: 'too-few-players' };
      phase = 'select';
      broadcastLobby();
      return { ok: true };
    }

    /* CPU席に未使用の生徒・相棒を割り当てる（2人戦は色ペア制約を守る） */
    function assignCpuChoices() {
      var usedStudents = [], usedPartners = [];
      seats.forEach(function (s) {
        if (s.kind !== 'cpu') {
          if (s.characterId) usedStudents.push(s.characterId);
          if (s.partnerId) usedPartners.push(s.partnerId);
        }
      });
      var assignedPartnerColors = usedPartners.map(function (pid) {
        return State.partnerById(pid).color;
      });
      seats.forEach(function (s) {
        if (s.kind !== 'cpu') return;
        var stu = State.STUDENTS.filter(function (x) { return usedStudents.indexOf(x.id) < 0; })[0];
        var pt = State.PARTNERS.filter(function (p) {
          if (usedPartners.indexOf(p.id) >= 0) return false;
          if (seats.length === 2 && assignedPartnerColors.length > 0) {
            return State.pairOf(assignedPartnerColors[0]).indexOf(p.color) < 0;
          }
          return true;
        })[0];
        if (!stu || !pt) throw new Error('no character/partner left for CPU seat');
        s.characterId = stu.id;
        s.partnerId = pt.id;
        s.declared = true;
        usedStudents.push(stu.id);
        usedPartners.push(pt.id);
        assignedPartnerColors.push(pt.color);
      });
    }

    function startGame(mode) {
      if (phase !== 'select') return { ok: false, reason: 'not-select-phase' };
      if (!allDeclared()) return { ok: false, reason: 'not-all-declared' };
      if (mode !== 'normal' && mode !== 'wizard') return { ok: false, reason: 'invalid-mode' };
      try {
        assignCpuChoices();
        var players = seats.map(function (s, i) {
          s.playerId = 'p' + (i + 1);
          return {
            id: s.playerId, name: s.name,
            type: s.kind === 'cpu' ? 'cpu' : 'human',
            cpuLevel: s.cpuLevel,
            characterId: s.characterId, partnerId: s.partnerId
          };
        });
        game = State.createGame({ mode: mode, players: players, rng: rng });
      } catch (e) {
        seats.forEach(function (s) { s.playerId = null; });
        return { ok: false, reason: 'create-failed', message: String(e && e.message || e) };
      }
      gameMode = mode;
      phase = 'game';
      broadcastLobby();
      syncState();
      return { ok: true };
    }

    /* ---- ゲストからのメッセージ ---- */

    function onJoin(key, msg) {
      if (seatByKey(key)) return; // 参加済み
      if (phase !== 'waiting') { sendError(key, 'already-started'); return; }
      if (seats.length >= MAX_SEATS) { sendError(key, 'room-full'); return; }
      var seat = addSeat({ key: key, name: msg.name || 'ゲスト' });
      sendTo(key, { t: 'welcome', key: key, code: options.code || null });
      seats.forEach(function (s) {
        if (s.kind === 'human' && s.key !== key) {
          sendTo(s.key, { t: 'notice', text: seat.name + ' が参加したよ' });
        }
      });
      broadcastLobby();
    }

    function onDeclare(key, msg) {
      var seat = seatByKey(key);
      if (!seat || seat.kind !== 'human') { sendError(key, 'no-seat'); return; }
      if (phase !== 'select') { sendError(key, 'not-select-phase'); return; }
      var stu = State.studentById(msg.characterId);
      var pt = State.partnerById(msg.partnerId);
      if (!stu || !pt) { sendError(key, 'invalid-choice'); return; }
      // 重複仲裁：他の席が確定済みの生徒・相棒は選べない
      for (var i = 0; i < seats.length; i++) {
        var s = seats[i];
        if (s.key === key || !s.declared) continue;
        if (s.characterId === stu.id) { sendError(key, 'already-taken'); return; }
        if (s.partnerId === pt.id) { sendError(key, 'already-taken'); return; }
        // 2人戦：色ペアが競合する相棒は選べない
        if (seats.length === 2 &&
            State.pairOf(State.partnerById(s.partnerId).color).indexOf(pt.color) >= 0) {
          sendError(key, 'pair-conflict');
          return;
        }
      }
      seat.characterId = stu.id;
      seat.partnerId = pt.id;
      seat.declared = true;
      broadcastLobby();
    }

    function onMove(key, msg) {
      var seat = seatByKey(key);
      if (!seat || seat.kind !== 'human') { sendError(key, 'no-seat'); return; }
      if (phase !== 'game' || !game) { sendError(key, 'not-in-game'); return; }
      var info = State.getTurnInfo(game);
      if (!info || info.controllerId !== seat.playerId) {
        sendError(key, 'not-your-turn');
        return;
      }
      var r = State.applyMove(game, msg.move);
      if (!r.ok) { sendError(key, r.reason); return; }
      game = r.state;
      syncState();
    }

    function receive(key, msg) {
      if (closed || !msg || !msg.t) return;
      switch (msg.t) {
        case 'join': onJoin(key, msg); break;
        case 'declare': onDeclare(key, msg); break;
        case 'move': onMove(key, msg); break;
        case 'leave': detachGuest(key); break;
        default: sendError(key, 'unknown-message');
      }
    }

    /* ---- CPU席・切断席の自動進行 ---- */

    /* 切断した人間の手番：まずパスを試み、無理なら形勢を変えない範囲で代替手を打つ */
    function disconnectedMove() {
      var info = State.getTurnInfo(game);
      if (info.step === 'card') {
        var deck = game.decks[info.controllerId];
        if (deck && deck.hand.length > 0) {
          return { type: 'playCard', cardIndex: 0, target: null };
        }
      }
      var pass = State.applyMove(game, { type: 'pass' });
      if (pass.ok) return { type: 'pass' };
      // 置ける手があるためパスできない局面では、ランダムな合法手で代替する
      return Cpu.chooseMove(game, 1, rng);
    }

    function stepAutomation() {
      if (closed || phase !== 'game' || !game || game.phase === 'finished') return false;
      var info = State.getTurnInfo(game);
      if (!info) return false;
      var seat = seatByPlayerId(info.controllerId);
      if (!seat) return false;
      var isCpu = seat.kind === 'cpu';
      var isDisconnected = seat.kind === 'human' && !seat.connected;
      if (!isCpu && !isDisconnected) return false;

      var mv = isCpu ? Cpu.chooseMove(game, seat.cpuLevel, rng) : disconnectedMove();
      if (!mv) return false;
      var r = State.applyMove(game, mv);
      if (!r.ok && mv.type === 'playCard') {
        r = State.applyMove(game, { type: 'playCard', cardIndex: mv.cardIndex, target: null });
      }
      if (!r.ok) r = State.applyMove(game, { type: 'pass' });
      if (!r.ok) return false;
      game = r.state;
      syncState();
      return true;
    }

    function close() {
      if (closed) return;
      closed = true;
      seats.forEach(function (s) {
        if (s.kind === 'human' && s.key !== LOCAL_KEY) {
          sendTo(s.key, { t: 'ended', reason: 'host-left' });
        }
      });
    }

    return {
      LOCAL_KEY: LOCAL_KEY,
      attachGuest: attachGuest,
      detachGuest: detachGuest,
      receive: receive,
      addCpu: addCpu,
      beginSelect: beginSelect,
      startGame: startGame,
      stepAutomation: stepAutomation,
      close: close,
      getLobby: publicLobby,
      getGameState: function () { return game; },
      getPhase: function () { return phase; }
    };
  }

  /* ================= ゲスト ================= */

  /*
   * options: { name, send(msg), onWelcome?, onLobby?, onState?, onError?, onNotice?, onEnded? }
   * transport が開いたら connect() で join を送る。受信は receive(msg)。
   * ホストとの接続が切れたら transportClosed() を呼ぶ。
   */
  function createGuestSession(options) {
    options = options || {};
    var send = options.send || function () {};
    var myKey = null;
    var ended = false;

    function emit(name, arg) {
      if (typeof options[name] === 'function') options[name](arg);
    }

    function connect() {
      send({ t: 'join', name: options.name || 'ゲスト' });
    }

    function receive(msg) {
      if (!msg || !msg.t) return;
      switch (msg.t) {
        case 'welcome':
          myKey = msg.key;
          emit('onWelcome', msg);
          break;
        case 'lobby': emit('onLobby', msg.lobby); break;
        case 'state': emit('onState', msg); break;
        case 'error': emit('onError', msg); break;
        case 'notice': emit('onNotice', msg); break;
        case 'ended':
          if (!ended) { ended = true; emit('onEnded', msg); }
          break;
      }
    }

    function transportClosed() {
      if (!ended) { ended = true; emit('onEnded', { t: 'ended', reason: 'host-left' }); }
    }

    return {
      connect: connect,
      receive: receive,
      transportClosed: transportClosed,
      declare: function (characterId, partnerId) {
        send({ t: 'declare', characterId: characterId, partnerId: partnerId });
      },
      sendMove: function (move) {
        send({ t: 'move', move: move });
      },
      leave: function () { send({ t: 'leave' }); },
      getKey: function () { return myKey; }
    };
  }

  return {
    LOCAL_KEY: LOCAL_KEY,
    MAX_SEATS: MAX_SEATS,
    publicState: publicState,
    createHostSession: createHostSession,
    createGuestSession: createGuestSession
  };
});
