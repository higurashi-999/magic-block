/*
 * cpu.js - マジック・ブロック CPU思考（純粋ロジック）
 *
 * chooseMove(state, level, rng) は現在の手番に対する move を1つ返す
 * （魔法使いモードのカードステップでは playCard、配置ステップでは place / pass）。
 * 返した move はそのまま MagicState.applyMove に渡せる。
 *
 * level: 1=よわい（ランダム寄り） / 2=ふつう（大型優先＋獲得角） / 3=つよい（＋妨害・終盤最適化）
 * DOM・通信への依存なし。UMD 風。
 */
(function (root, factory) {
  var Pieces = null, Logic = null, State = null;
  if (typeof module !== 'undefined' && module.exports) {
    Pieces = require('./pieces.js');
    Logic = require('./logic.js');
    State = require('./state.js');
    module.exports = factory(Pieces, Logic, State);
  }
  if (root) {
    root.MagicCpu = factory(root.MagicPieces, root.MagicLogic, root.MagicState);
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function (Pieces, Logic, State) {
  'use strict';

  if (!Pieces || !Logic || !State) throw new Error('cpu.js requires pieces.js, logic.js, state.js');

  var EDGE = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  /* 指定色の「角フロンティア」（そこに置く起点になる空きマス）の集合 */
  function frontierSet(board, color) {
    var set = {};
    for (var y = 0; y < Logic.BOARD_SIZE; y++) {
      for (var x = 0; x < Logic.BOARD_SIZE; x++) {
        if (board[y][x] !== null) continue;
        var diag = false, edge = false;
        for (var i = 0; i < 4; i++) {
          if (Logic.getCell(board, x + DIAG[i][0], y + DIAG[i][1]) === color) diag = true;
          if (Logic.getCell(board, x + EDGE[i][0], y + EDGE[i][1]) === color) edge = true;
        }
        if (diag && !edge) set[x + ',' + y] = true;
      }
    }
    return set;
  }

  function frontierCount(board, color) {
    return Object.keys(frontierSet(board, color)).length;
  }

  function isFrontierCell(board, color, x, y) {
    if (Logic.getCell(board, x, y) !== null) return false;
    var diag = false;
    for (var i = 0; i < 4; i++) {
      if (Logic.getCell(board, x + DIAG[i][0], y + DIAG[i][1]) === color) diag = true;
      if (Logic.getCell(board, x + EDGE[i][0], y + EDGE[i][1]) === color) return false;
    }
    return diag;
  }

  function placeMoveOf(m) {
    return { type: 'place', pieceId: m.pieceId, variantIndex: m.variantIndex, origin: m.origin };
  }

  /* 配置1手の評価（ふつう以上）。ctx は手番ごとに事前計算したフロンティア情報 */
  function evaluatePlacement(state, move, level, rng, ctx) {
    var color = state.turn.color;
    var size = Pieces.getPiece(move.pieceId).size;
    var newBoard = Logic.applyPlacement(state.board, color, move.cells);
    var score = size * 10;
    // 獲得角：この配置で新しく生まれた自色の角フロンティア数
    var gained = 0, seen = {};
    move.cells.forEach(function (c) {
      DIAG.forEach(function (d) {
        var nx = c[0] + d[0], ny = c[1] + d[1], key = nx + ',' + ny;
        if (seen[key]) return;
        seen[key] = true;
        if (!ctx.ownFrontier[key] && isFrontierCell(newBoard, color, nx, ny)) gained++;
      });
    });
    score += gained * 3;
    if (level >= 3) {
      // 妨害：相手の角フロンティアだったマスを何マス埋めたか
      Logic.TURN_ORDER.forEach(function (oc) {
        if (oc === color || !ctx.oppFrontier[oc]) return;
        move.cells.forEach(function (c) {
          if (ctx.oppFrontier[oc][c[0] + ',' + c[1]]) score += 4;
        });
      });
      // 終盤：残りマスが少なくなってきたら大きいピースを強く優先
      if (ctx.remainingSquares <= 30) score += size * 4;
    }
    score += rng() * 0.9; // 同点手のばらつき
    return score;
  }

  function choosePlacementMove(state, level, rng) {
    var moves = State.legalMovesForTurn(state);
    if (moves.length === 0) return { type: 'pass' };
    if (level <= 1) {
      return placeMoveOf(moves[Math.floor(rng() * moves.length)]);
    }
    var color = state.turn.color;
    var ctx = {
      ownFrontier: frontierSet(state.board, color),
      oppFrontier: {},
      remainingSquares: Logic.remainingSquares(State.usablePieces(state, color))
    };
    if (level >= 3) {
      Logic.TURN_ORDER.forEach(function (oc) {
        if (oc !== color && Logic.colorOnBoard(state.board, oc)) {
          ctx.oppFrontier[oc] = frontierSet(state.board, oc);
        }
      });
    }
    var best = null, bestScore = -Infinity;
    moves.forEach(function (m) {
      var s = evaluatePlacement(state, m, level, rng, ctx);
      if (s > bestScore) { bestScore = s; best = m; }
    });
    return placeMoveOf(best);
  }

  /* ワープゲートの移動先を探す。見つかれば target、なければ null */
  function findWarpTarget(state, level) {
    var color = state.turn.color;
    var candidates = [];
    Logic.TURN_ORDER.forEach(function (oc) {
      if (oc === color) return;
      state.placedPieces[oc].forEach(function (pp, idx) {
        candidates.push({ color: oc, pieceIndex: idx, pieceId: pp.pieceId, size: Pieces.getPiece(pp.pieceId).size });
      });
    });
    candidates.sort(function (a, b) { return b.size - a.size; });
    var best = null;
    for (var i = 0; i < candidates.length && i < 6; i++) {
      var cand = candidates[i];
      var board = Logic.cloneBoard(state.board);
      state.placedPieces[cand.color][cand.pieceIndex].cells.forEach(function (c) {
        board[c[1]][c[0]] = null;
      });
      var options = { firstMove: !Logic.colorOnBoard(board, cand.color) };
      var dests = Logic.legalMoves(board, cand.color, [cand.pieceId], options);
      if (dests.length === 0) continue;
      // 移動先は相手の角フロンティアが最も小さくなる場所（つよいは厳密、ふつうは先頭寄り）
      var chosen = dests[0], chosenFrontier = Infinity;
      var limit = level >= 3 ? dests.length : Math.min(dests.length, 12);
      for (var d = 0; d < limit; d++) {
        var nb = Logic.applyPlacement(board, cand.color, dests[d].cells);
        var f = frontierCount(nb, cand.color);
        if (f < chosenFrontier) { chosenFrontier = f; chosen = dests[d]; }
      }
      var gain = frontierCount(state.board, cand.color) - chosenFrontier + cand.size;
      if (!best || gain > best.gain) {
        best = {
          gain: gain,
          target: { color: cand.color, pieceIndex: cand.pieceIndex, variantIndex: chosen.variantIndex, origin: chosen.origin }
        };
      }
    }
    return best ? best.target : null;
  }

  function largestPieceId(pieceIds) {
    var best = null, bestSize = -1;
    pieceIds.forEach(function (id) {
      var p = Pieces.getPiece(id);
      if (p && p.size > bestSize) { bestSize = p.size; best = id; }
    });
    return best;
  }

  /* カードステップの手を選ぶ */
  function chooseCardMove(state, level, rng) {
    var info = State.getTurnInfo(state);
    var deck = state.decks[info.controllerId];
    var hand = deck.hand;
    var color = info.color;
    var nc = State.nextColor(color);
    var nextUsable = State.usablePieces(state, nc);
    var movesNow = State.legalMovesForTurn(state);

    if (level <= 1) {
      var idx = Math.floor(rng() * hand.length);
      var type = hand[idx];
      var target = null;
      if ((type === 'choice' || type === 'lock') && nextUsable.length > 0) {
        target = { pieceId: nextUsable[Math.floor(rng() * nextUsable.length)] };
      } else if (type === 'recall' && state.placedPieces[color].length > 0) {
        target = { pieceIndex: Math.floor(rng() * state.placedPieces[color].length) };
      }
      return { type: 'playCard', cardIndex: idx, target: target };
    }

    var best = null;
    hand.forEach(function (type, cardIndex) {
      var score = 0, target = null;
      switch (type) {
        case 'twin': {
          if (movesNow.length === 0) { score = -5; break; }
          var maxSize = 0;
          movesNow.forEach(function (m) {
            var s = Pieces.getPiece(m.pieceId).size;
            if (s > maxSize) maxSize = s;
          });
          score = 6 + maxSize;
          break;
        }
        case 'bond': {
          var edgeMoves = Logic.legalMoves(state.board, color, State.usablePieces(state, color), { allowEdge: true });
          if (edgeMoves.length > movesNow.length) {
            score = movesNow.length === 0 ? 26 : 10;
          } else {
            score = 1;
          }
          break;
        }
        case 'sleep':
          score = 5;
          break;
        case 'minimize': {
          score = 7;
          var lp = largestPieceId(nextUsable);
          if (lp && Pieces.getPiece(lp).size >= 4) score += 3;
          break;
        }
        case 'choice': {
          if (nextUsable.length === 0) { score = 0; break; }
          var forced = null;
          if (level >= 3) {
            // 次の色が置けないピースがあればそれを指定（確実にパスさせられる）
            for (var i = 0; i < nextUsable.length; i++) {
              var pid = nextUsable[i];
              if (!Logic.hasLegalMove(state.board, nc, [pid], {})) { forced = pid; break; }
            }
          }
          if (forced) {
            target = { pieceId: forced };
            score = 18;
          } else {
            target = { pieceId: largestPieceId(nextUsable) };
            score = 9;
          }
          break;
        }
        case 'lock': {
          if (nextUsable.length === 0) { score = 0; break; }
          target = { pieceId: largestPieceId(nextUsable) };
          score = level >= 3 ? 12 : 9;
          break;
        }
        case 'recall': {
          var placedList = state.placedPieces[color];
          if (placedList.length === 0) { score = -3; break; }
          // 一番小さい配置済みピースを戻す候補
          var smallIdx = 0;
          placedList.forEach(function (pp, i2) {
            if (Pieces.getPiece(pp.pieceId).size < Pieces.getPiece(placedList[smallIdx].pieceId).size) smallIdx = i2;
          });
          target = { pieceIndex: smallIdx };
          if (movesNow.length === 0) {
            // リコール後に置けるようになるか試算する
            var sim = State.applyMove(state, { type: 'playCard', cardIndex: cardIndex, target: target });
            score = (sim.ok && State.legalMovesForTurn(sim.state).length > 0) ? 24 : 3;
          } else {
            score = 2;
          }
          break;
        }
        case 'warp': {
          var wt = findWarpTarget(state, level);
          if (wt) {
            target = wt;
            score = 14;
          } else {
            score = -2;
          }
          break;
        }
      }
      score += rng() * 0.5;
      if (!best || score > best.score) best = { score: score, move: { type: 'playCard', cardIndex: cardIndex, target: target } };
    });
    return best.move;
  }

  /*
   * 現在の手番に対する move を返す。
   * level: 1|2|3（省略時は手番プレイヤーの cpuLevel）
   */
  function chooseMove(state, level, rng) {
    rng = rng || Math.random;
    if (!state || state.phase === 'finished') return null;
    var info = State.getTurnInfo(state);
    if (!info) return null;
    if (typeof level !== 'number') {
      var player = State.playerById(state, info.controllerId);
      level = player ? player.cpuLevel : 2;
    }
    if (info.step === 'card') return chooseCardMove(state, level, rng);
    return choosePlacementMove(state, level, rng);
  }

  return {
    chooseMove: chooseMove,
    frontierCount: frontierCount
  };
});
