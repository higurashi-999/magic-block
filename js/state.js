/*
 * state.js - マジック・ブロック 対戦ステートマシン（純粋ロジック）
 *
 * ゲーム状態（JSON 化可能なプレーンオブジェクト）と手（move）の適用で進行を表現する。
 * applyMove は元の state を変更せず、新しい state を返す。
 * DOM・通信への依存なし。ブラウザ（グローバル MagicState）と Node（require）の両対応（UMD 風）。
 *
 * move の形式:
 *   { type: 'place', pieceId, variantIndex, origin: [x, y] }
 *   { type: 'pass' }
 *   { type: 'playCard', cardIndex, target }  // 魔法使いモードのカードステップのみ
 *     target（カード種別ごとに任意。省略時は「効果なしで出すだけ」になる）:
 *       choice: { pieceId }              次の色の手元から指定するピース
 *       lock:   { pieceId }              次の色の手元から使用不可にするピース
 *       recall: { pieceIndex }           自色の配置済みピース（placedPieces の添字）
 *       warp:   { color, pieceIndex, variantIndex, origin }  相手ピースの移動先
 */
(function (root, factory) {
  var Pieces = null, Logic = null;
  if (typeof module !== 'undefined' && module.exports) {
    Pieces = require('./pieces.js');
    Logic = require('./logic.js');
    module.exports = factory(Pieces, Logic);
  }
  if (root) {
    root.MagicState = factory(root.MagicPieces, root.MagicLogic);
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function (Pieces, Logic) {
  'use strict';

  if (!Pieces) throw new Error('state.js requires pieces.js (MagicPieces)');
  if (!Logic) throw new Error('state.js requires logic.js (MagicLogic)');

  var TURN_ORDER = Logic.TURN_ORDER;

  /* 相棒（メインカラーが決まる） */
  var PARTNERS = [
    { id: 'lion', name: 'ライオン', emoji: '🦁', color: 'red' },
    { id: 'badger', name: 'アナグマ', emoji: '🦡', color: 'yellow' },
    { id: 'eagle', name: 'ワシ', emoji: '🦅', color: 'blue' },
    { id: 'snake', name: 'ヘビ', emoji: '🐍', color: 'green' }
  ];

  /* 生徒キャラ（男2・女2）。姿はモードで切り替わる */
  var STUDENTS = [
    { id: 'sora', name: 'ソラ', gender: 'male', emoji: '👦', wizardEmoji: '🧙' },
    { id: 'ren', name: 'レン', gender: 'male', emoji: '🧑', wizardEmoji: '🧙' },
    { id: 'hikari', name: 'ヒカリ', gender: 'female', emoji: '👧', wizardEmoji: '🧙‍♀️' },
    { id: 'yukino', name: 'ユキノ', gender: 'female', emoji: '👩', wizardEmoji: '🧙‍♀️' }
  ];

  /* 魔法カード定義（SPEC 6.4 の内訳） */
  var CARD_DEFS = {
    twin:     { name: 'ツインキャスト', count: 2, desc: 'ピースを1つ置き、そのピースと角がつながるようにもう1つ置ける' },
    sleep:    { name: 'すやすやパウダー', count: 2, desc: '次のプレイヤーは、自分の手番にカードを使うことができない' },
    bond:     { name: 'ぴたっとボンド', count: 2, desc: '自分のピースと辺がつながるようにピースを1つ置ける' },
    minimize: { name: 'ミニマイズ', count: 2, desc: '次のプレイヤーは手元の一番小さいピースを置かなければならない（置けなければパス）' },
    warp:     { name: 'ワープゲート', count: 2, desc: '相手のピースを1つ選び、相手の他のピースの角につながる別の場所へ移動させる' },
    choice:   { name: 'チョイススペル', count: 1, desc: '次のプレイヤーが置くピースを指定できる（置けなければパス）' },
    recall:   { name: 'リコール', count: 2, desc: 'ボード上の自分のピースを1つ手元に戻す（この手番に使ってもよい）' },
    lock:     { name: 'ピースロック', count: 1, desc: '次のプレイヤーの手元ピース1個を使用不可にする（終了時にそのピースも数える）' }
  };
  var CARD_TYPES = Object.keys(CARD_DEFS);

  /* 2人戦の色ペア（メインカラーから担当2色が決まる） */
  var COLOR_PAIRS = [['blue', 'red'], ['yellow', 'green']];

  function pairOf(color) {
    for (var i = 0; i < COLOR_PAIRS.length; i++) {
      if (COLOR_PAIRS[i].indexOf(color) >= 0) return COLOR_PAIRS[i].slice();
    }
    return [color];
  }

  function partnerById(id) {
    for (var i = 0; i < PARTNERS.length; i++) if (PARTNERS[i].id === id) return PARTNERS[i];
    return null;
  }

  function studentById(id) {
    for (var i = 0; i < STUDENTS.length; i++) if (STUDENTS[i].id === id) return STUDENTS[i];
    return null;
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /* 14枚デッキを構築してシャッフルしたカード種別の配列を返す */
  function buildDeck(rng) {
    rng = rng || Math.random;
    var cards = [];
    CARD_TYPES.forEach(function (t) {
      for (var i = 0; i < CARD_DEFS[t].count; i++) cards.push(t);
    });
    for (var i = cards.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = cards[i]; cards[i] = cards[j]; cards[j] = tmp;
    }
    return cards;
  }

  function allPieceIds() {
    return Pieces.PIECES.map(function (p) { return p.id; });
  }

  function nextColor(color) {
    var idx = TURN_ORDER.indexOf(color);
    return TURN_ORDER[(idx + 1) % TURN_ORDER.length];
  }

  /* ロックされていない使用可能ピース */
  function usablePieces(state, color) {
    var locked = state.locked[color] || [];
    return (state.hands[color] || []).filter(function (id) { return locked.indexOf(id) < 0; });
  }

  function drawCards(deck, n) {
    for (var i = 0; i < n && deck.draw.length > 0; i++) {
      deck.hand.push(deck.draw.pop());
    }
  }

  /*
   * 手番開始処理：turnState を組み立てる。
   * 魔法使いモードのフリーピース手番では、フリー山札の上1枚を伏せて捨てる。
   * 前の手番から持ち越された「次のプレイヤーへの効果」はここで消費する。
   */
  function startTurn(state) {
    var color = TURN_ORDER[state.turnColorIdx];
    var isFree = state.freeColor === color;
    var controllerId = isFree
      ? state.players[state.freeControlPtr % state.players.length].id
      : state.colorOwner[color];
    var ts = {
      color: color,
      controllerId: controllerId,
      isFree: isFree,
      step: 'place',
      cardSealed: false,
      forcedPieceId: null,
      forcedSmallest: false,
      allowEdge: false,
      placementsLeft: 1,
      placementsDone: 0,
      twinFirstCells: null,
      cardPlayedType: null
    };
    if (state.pendingNext && state.pendingNext.forColor === color) {
      ts.cardSealed = !!state.pendingNext.cardSealed;
      ts.forcedPieceId = state.pendingNext.forcedPieceId || null;
      ts.forcedSmallest = !!state.pendingNext.forcedSmallest;
      state.pendingNext = null;
    }
    if (state.mode === 'wizard' && state.phase === 'playing') {
      if (isFree) {
        var freeDeck = state.decks.free;
        if (freeDeck && freeDeck.draw.length > 0) {
          freeDeck.discard.push(freeDeck.draw.pop());
          state.log.push('フリーピースのカードを伏せて捨てた');
        }
        ts.step = 'place';
      } else if (ts.cardSealed) {
        ts.step = 'place';
      } else if (state.decks[controllerId] && state.decks[controllerId].hand.length > 0) {
        ts.step = 'card';
      } else {
        ts.step = 'place';
      }
    }
    state.turn = ts;
    return state;
  }

  /* 次の色へ手番を進める（通常モードではパス済みの色を飛ばす） */
  function advanceTurn(state) {
    var finishedColor = TURN_ORDER[state.turnColorIdx];
    if (finishedColor === state.freeColor) {
      state.freeControlPtr = (state.freeControlPtr + 1) % state.players.length;
    }
    for (var step = 0; step < TURN_ORDER.length; step++) {
      state.turnColorIdx = (state.turnColorIdx + 1) % TURN_ORDER.length;
      var color = TURN_ORDER[state.turnColorIdx];
      if (state.mode === 'normal' && state.passed[color]) continue;
      break;
    }
    return startTurn(state);
  }

  /* 終了判定＋結果算出 */
  function finishCheck(state) {
    if (state.phase !== 'playing') return state;
    var hands = {};
    TURN_ORDER.forEach(function (color) { hands[color] = usablePieces(state, color); });
    if (Logic.isGameOver(state.board, hands)) {
      state.phase = 'finished';
      state.results = computeResults(state);
      state.log.push('ゲーム終了');
    }
    return state;
  }

  function computeResults(state) {
    var perColor = {};
    TURN_ORDER.forEach(function (color) {
      perColor[color] = {
        remainingSquares: Logic.remainingSquares(state.hands[color]),
        piecesRemaining: state.hands[color].length,
        lastPlacedSize: state.lastPlaced[color]
      };
    });
    var players = state.players.map(function (p) { return { id: p.id, colors: p.colors }; });
    var result = Logic.finalScores(players, perColor, state.mode);
    return { scores: result.scores, winners: result.winners, perColor: perColor };
  }

  /*
   * ゲーム作成。
   * config: {
   *   mode: 'normal' | 'wizard',
   *   players: [{ id, name, type: 'human'|'cpu', cpuLevel: 1|2|3,
   *               characterId, partnerId, colors?: [color,...] }],
   *   rng?: function () -> [0,1)  // デッキシャッフル・開始色決定用
   *   startColor?: color  // 開始色の明示指定（省略時は rng でランダムに決める）
   * }
   * colors を省略すると partnerId のメインカラーから決まる
   * （4人/3人戦はメインカラー1色、2人戦はペア2色。残り色はフリーピース）。
   * 手番は開始色から色順（青→黄→赤→緑）に巡回する。
   */
  function createGame(config) {
    if (!config || (config.mode !== 'normal' && config.mode !== 'wizard')) {
      throw new Error('createGame: mode must be normal or wizard');
    }
    if (!config.players || config.players.length < 2 || config.players.length > 4) {
      throw new Error('createGame: players must be 2-4');
    }
    var players = config.players.map(function (p, i) {
      var colors = null;
      if (p.colors && p.colors.length > 0) {
        colors = p.colors.slice();
      } else if (p.partnerId) {
        var partner = partnerById(p.partnerId);
        if (!partner) throw new Error('createGame: unknown partner ' + p.partnerId);
        colors = config.players.length === 2 ? pairOf(partner.color) : [partner.color];
      } else {
        throw new Error('createGame: player ' + p.id + ' needs colors or partnerId');
      }
      return {
        id: p.id || ('p' + (i + 1)),
        name: p.name || ('プレイヤー' + (i + 1)),
        type: p.type || 'human',
        cpuLevel: p.cpuLevel || 2,
        characterId: p.characterId || null,
        partnerId: p.partnerId || null,
        colors: colors
      };
    });
    // 色の重複・2人戦ペア競合チェック
    var colorOwner = {};
    players.forEach(function (p) {
      p.colors.forEach(function (color) {
        if (colorOwner[color]) throw new Error('createGame: color assigned twice: ' + color);
        colorOwner[color] = p.id;
      });
    });
    var freeColor = null;
    TURN_ORDER.forEach(function (color) {
      if (!colorOwner[color]) {
        if (freeColor) throw new Error('createGame: more than one free color');
        freeColor = color;
        colorOwner[color] = null;
      }
    });

    var rng = config.rng || Math.random;
    // 開始色：明示指定がなければランダムに決める。手番はこの色から色順に巡回する
    var startColorIdx;
    if (config.startColor) {
      startColorIdx = TURN_ORDER.indexOf(config.startColor);
      if (startColorIdx < 0) throw new Error('createGame: unknown startColor ' + config.startColor);
    } else {
      startColorIdx = Math.floor(rng() * TURN_ORDER.length);
    }
    var startColor = TURN_ORDER[startColorIdx];

    var state = {
      mode: config.mode,
      phase: 'opening',
      board: Logic.createBoard(),
      players: players,
      colorOwner: colorOwner,
      freeColor: freeColor,
      hands: {},
      placedPieces: {},
      lastPlaced: {},
      passed: {},
      locked: {},
      decks: {},
      startColor: startColor,
      turnColorIdx: startColorIdx,
      freeControlPtr: 0,
      openingDone: {},
      initialDrawn: {},
      pendingNext: null,
      turn: null,
      results: null,
      log: []
    };
    TURN_ORDER.forEach(function (color) {
      state.hands[color] = allPieceIds();
      state.placedPieces[color] = [];
      state.lastPlaced[color] = null;
      state.passed[color] = false;
      state.locked[color] = [];
      state.openingDone[color] = false;
    });
    if (config.mode === 'wizard') {
      // 2人戦は2色分28枚を混ぜた1つの山札にする（SPEC 6.6）
      var decksPerPlayer = players.length === 2 ? 2 : 1;
      players.forEach(function (p) {
        var draw = [];
        for (var d = 0; d < decksPerPlayer; d++) draw = draw.concat(buildDeck(rng));
        if (decksPerPlayer > 1) {
          for (var i = draw.length - 1; i > 0; i--) {
            var j = Math.floor(rng() * (i + 1));
            var tmp = draw[i]; draw[i] = draw[j]; draw[j] = tmp;
          }
        }
        state.decks[p.id] = { draw: draw, hand: [], discard: [] };
      });
      if (freeColor) {
        state.decks.free = { draw: buildDeck(rng), hand: [], discard: [] };
      }
    }
    state.log.push('ゲーム開始（' + (config.mode === 'wizard' ? '魔法使いモード' : '通常モード') + '）');
    state.log.push('🎲 ' + startColor + ' からスタート');
    return startTurn(state);
  }

  function getTurnInfo(state) {
    if (!state.turn) return null;
    var t = state.turn;
    return {
      color: t.color,
      startColor: state.startColor || null,
      controllerId: t.controllerId,
      isFree: t.isFree,
      step: t.step,
      phase: state.phase,
      cardSealed: t.cardSealed,
      forcedPieceId: t.forcedPieceId,
      forcedSmallest: t.forcedSmallest,
      allowEdge: t.allowEdge,
      placementsLeft: t.placementsLeft,
      cardPlayedType: t.cardPlayedType
    };
  }

  function playerById(state, id) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return state.players[i];
    }
    return null;
  }

  /* 盤上の指定マスを含む配置済みピースの添字（なければ -1） */
  function placedPieceAt(state, color, x, y) {
    var list = state.placedPieces[color] || [];
    for (var i = 0; i < list.length; i++) {
      var cells = list[i].cells;
      for (var j = 0; j < cells.length; j++) {
        if (cells[j][0] === x && cells[j][1] === y) return i;
      }
    }
    return -1;
  }

  /* 現在の手番で置ける合法手（強制ピース・ツイン2手目の制約を反映） */
  function legalMovesForTurn(state) {
    if (state.phase === 'finished' || !state.turn) return [];
    var color = state.turn.color;
    var pieces = usablePieces(state, color);
    if (state.turn.forcedPieceId) {
      pieces = pieces.filter(function (id) { return id === state.turn.forcedPieceId; });
    } else if (state.turn.forcedSmallest) {
      var min = Logic.smallestPieceSize(pieces);
      pieces = pieces.filter(function (id) {
        var p = Pieces.getPiece(id);
        return p && p.size === min;
      });
    }
    var options = { allowEdge: state.turn.allowEdge };
    if (state.phase === 'opening') options.firstMove = true;
    var moves = Logic.legalMoves(state.board, color, pieces, options);
    if (state.turn.twinFirstCells) {
      var first = state.turn.twinFirstCells;
      moves = moves.filter(function (m) {
        return m.cells.some(function (c) {
          return first.some(function (f) {
            return Math.abs(c[0] - f[0]) === 1 && Math.abs(c[1] - f[1]) === 1;
          });
        });
      });
    }
    return moves;
  }

  function err(reason) { return { ok: false, reason: reason }; }

  /* ---- move: place ---- */
  function applyPlace(state, move) {
    var turn = state.turn;
    var color = turn.color;
    if (state.phase !== 'opening' && turn.step !== 'place') {
      return err('must-play-card-first');
    }
    var usable = usablePieces(state, color);
    if (usable.indexOf(move.pieceId) < 0) return err('piece-not-available');
    if (turn.forcedPieceId && move.pieceId !== turn.forcedPieceId) return err('forced-piece');
    if (turn.forcedSmallest) {
      var piece = Pieces.getPiece(move.pieceId);
      if (!piece || piece.size !== Logic.smallestPieceSize(usable)) return err('forced-smallest');
    }
    var cells = Logic.placementCells(move.pieceId, move.variantIndex, move.origin);
    if (!cells) return err('invalid-variant');
    if (turn.twinFirstCells) {
      var touchesFirst = cells.some(function (c) {
        return turn.twinFirstCells.some(function (f) {
          return Math.abs(c[0] - f[0]) === 1 && Math.abs(c[1] - f[1]) === 1;
        });
      });
      if (!touchesFirst) return err('twin-must-connect');
    }
    var options = { allowEdge: turn.allowEdge };
    if (state.phase === 'opening') options.firstMove = true;
    var placed = Logic.tryPlace(state.board, color, cells, options);
    if (!placed.ok) return err(placed.reason);
    state.board = placed.board;
    state.hands[color].splice(state.hands[color].indexOf(move.pieceId), 1);
    state.placedPieces[color].push({ pieceId: move.pieceId, cells: cells });
    state.lastPlaced[color] = Pieces.getPiece(move.pieceId).size;
    state.log.push(color + ' が ' + move.pieceId + ' を置いた');

    if (state.phase === 'opening') {
      state.openingDone[color] = true;
      if (state.mode === 'wizard' && !turn.isFree) {
        var pid = turn.controllerId;
        if (!state.initialDrawn[pid]) {
          drawCards(state.decks[pid], 2);
          state.initialDrawn[pid] = true;
        }
      }
      var allOpened = TURN_ORDER.every(function (c) { return state.openingDone[c]; });
      if (!allOpened) {
        // 次の未配置の色へ
        for (var i = 0; i < TURN_ORDER.length; i++) {
          state.turnColorIdx = (state.turnColorIdx + 1) % TURN_ORDER.length;
          if (!state.openingDone[TURN_ORDER[state.turnColorIdx]]) break;
        }
        startTurn(state);
      } else {
        state.phase = 'playing';
        // playing は開始色から再開し、そこから色順に巡回する
        state.turnColorIdx = TURN_ORDER.indexOf(state.startColor);
        startTurn(state);
        finishCheck(state);
      }
      return { ok: true, state: state };
    }

    turn.placementsDone += 1;
    turn.placementsLeft -= 1;
    if (turn.placementsLeft > 0) {
      // ツインキャストの2個目：1個目に角でつながる配置のみ可
      turn.twinFirstCells = cells;
      return { ok: true, state: state };
    }
    endTurn(state);
    return { ok: true, state: state };
  }

  /* 手番終了：魔法使いモードでは1枚引いてから次の色へ */
  function endTurn(state) {
    var turn = state.turn;
    if (state.mode === 'wizard' && !turn.isFree && turn.controllerId) {
      var deck = state.decks[turn.controllerId];
      if (deck) drawCards(deck, 1);
    }
    advanceTurn(state);
    finishCheck(state);
  }

  /* ---- move: pass ---- */
  function applyPass(state, move) {
    var turn = state.turn;
    if (state.phase === 'opening') return err('cannot-pass-in-opening');
    if (turn.step !== 'place') return err('must-play-card-first');
    var moves = legalMovesForTurn(state);
    var twinPartial = turn.cardPlayedType === 'twin' && turn.placementsDone === 1;
    if (moves.length > 0 && !twinPartial) return err('has-legal-moves');
    state.log.push(turn.color + ' がパスした');
    if (state.mode === 'normal') {
      state.passed[turn.color] = true;
      advanceTurn(state);
      finishCheck(state);
    } else {
      endTurn(state);
    }
    return { ok: true, state: state };
  }

  /* ---- move: playCard ---- */
  function applyPlayCard(state, move) {
    var turn = state.turn;
    if (state.mode !== 'wizard') return err('not-wizard-mode');
    if (state.phase !== 'playing') return err('not-playing-phase');
    if (turn.step !== 'card') return err('not-card-step');
    var deck = state.decks[turn.controllerId];
    if (!deck || typeof move.cardIndex !== 'number' ||
        move.cardIndex < 0 || move.cardIndex >= deck.hand.length) {
      return err('invalid-card-index');
    }
    var type = deck.hand[move.cardIndex];
    var target = move.target || null;
    var color = turn.color;
    var nc = nextColor(color);

    // 対象指定が必要なカードは、先に検証する（不正な対象ならカードを消費しない）
    if (type === 'warp' && target) {
      var wres = validateWarp(state, color, target);
      if (!wres.ok) return wres;
    }
    if (type === 'recall' && target) {
      if (!state.placedPieces[color][target.pieceIndex]) return err('invalid-target');
    }

    deck.hand.splice(move.cardIndex, 1);
    deck.discard.push(type);
    turn.cardPlayedType = type;
    turn.step = 'place';
    state.log.push(color + ' が ' + CARD_DEFS[type].name + ' を使った');

    switch (type) {
      case 'twin':
        turn.placementsLeft = 2;
        break;
      case 'bond':
        turn.allowEdge = true;
        break;
      case 'sleep':
        state.pendingNext = { forColor: nc, cardSealed: true, forcedPieceId: null, forcedSmallest: false };
        break;
      case 'minimize':
        state.pendingNext = { forColor: nc, cardSealed: false, forcedPieceId: null, forcedSmallest: true };
        break;
      case 'choice':
        if (target && usablePieces(state, nc).indexOf(target.pieceId) >= 0) {
          state.pendingNext = { forColor: nc, cardSealed: false, forcedPieceId: target.pieceId, forcedSmallest: false };
        }
        break;
      case 'lock':
        if (target && usablePieces(state, nc).indexOf(target.pieceId) >= 0) {
          state.locked[nc].push(target.pieceId);
          state.log.push(nc + ' の ' + target.pieceId + ' が使用不可になった');
        }
        break;
      case 'recall':
        if (target) {
          var rp = state.placedPieces[color][target.pieceIndex];
          rp.cells.forEach(function (c) { state.board[c[1]][c[0]] = null; });
          state.placedPieces[color].splice(target.pieceIndex, 1);
          state.hands[color].push(rp.pieceId);
          state.log.push(color + ' が ' + rp.pieceId + ' を手元に戻した');
        }
        break;
      case 'warp':
        if (target) applyWarp(state, target);
        break;
    }
    return { ok: true, state: state };
  }

  function validateWarp(state, currentColor, target) {
    if (!target || target.color === currentColor) return err('invalid-target');
    var list = state.placedPieces[target.color];
    if (!list || !list[target.pieceIndex]) return err('invalid-target');
    var pieceId = list[target.pieceIndex].pieceId;
    var board = Logic.cloneBoard(state.board);
    list[target.pieceIndex].cells.forEach(function (c) { board[c[1]][c[0]] = null; });
    var cells = Logic.placementCells(pieceId, target.variantIndex, target.origin);
    if (!cells) return err('invalid-variant');
    var res = Logic.validatePlacement(board, target.color, cells, {
      firstMove: !Logic.colorOnBoard(board, target.color)
    });
    if (!res.ok) return err('warp-' + res.reason);
    return { ok: true, board: board, cells: cells };
  }

  function applyWarp(state, target) {
    var wres = validateWarp(state, state.turn.color, target);
    // applyPlayCard で検証済みのため成功前提
    state.board = Logic.applyPlacement(wres.board, target.color, wres.cells);
    state.placedPieces[target.color][target.pieceIndex] = {
      pieceId: state.placedPieces[target.color][target.pieceIndex].pieceId,
      cells: wres.cells
    };
    state.log.push(target.color + ' のピースが移動した');
  }

  /*
   * 手を適用する。元の state は変更しない。
   * 成功: { ok: true, state } / 失敗: { ok: false, reason }
   */
  function applyMove(state, move) {
    if (!state || !move || !move.type) return err('invalid-move');
    if (state.phase === 'finished') return err('game-finished');
    var next = clone(state);
    switch (move.type) {
      case 'place': return applyPlace(next, move);
      case 'pass': return applyPass(next, move);
      case 'playCard': return applyPlayCard(next, move);
      default: return err('unknown-move-type');
    }
  }

  return {
    TURN_ORDER: TURN_ORDER,
    PARTNERS: PARTNERS,
    STUDENTS: STUDENTS,
    CARD_DEFS: CARD_DEFS,
    CARD_TYPES: CARD_TYPES,
    COLOR_PAIRS: COLOR_PAIRS,
    pairOf: pairOf,
    partnerById: partnerById,
    studentById: studentById,
    buildDeck: buildDeck,
    createGame: createGame,
    applyMove: applyMove,
    getTurnInfo: getTurnInfo,
    playerById: playerById,
    usablePieces: usablePieces,
    legalMovesForTurn: legalMovesForTurn,
    placedPieceAt: placedPieceAt,
    computeResults: computeResults,
    nextColor: nextColor
  };
});
