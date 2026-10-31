/*
 * logic.js - マジック・ブロック 純粋ゲームロジック
 *
 * 20x20 盤面、配置可否判定、合法手列挙、パス/終了判定、スコア計算。
 * DOM・通信への依存なし。ブラウザ（グローバル MagicLogic）と Node（require）の両対応（UMD 風）。
 *
 * 盤面の表現: board[y][x] に色文字列 ('blue' | 'yellow' | 'red' | 'green') または null。
 * セル座標は [x, y]（x: 0=左端, y: 0=上端）。
 */
(function (root, factory) {
  var Pieces = null;
  if (typeof module !== 'undefined' && module.exports) {
    Pieces = require('./pieces.js');
    module.exports = factory(Pieces);
  }
  if (root) {
    root.MagicLogic = factory(root.MagicPieces);
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function (Pieces) {
  'use strict';

  if (!Pieces) throw new Error('logic.js requires pieces.js (MagicPieces)');

  var BOARD_SIZE = 20;
  /* 着手順は色順固定：青 → 黄 → 赤 → 緑 */
  var COLORS = ['blue', 'yellow', 'red', 'green'];
  var CORNERS = [[0, 0], [BOARD_SIZE - 1, 0], [0, BOARD_SIZE - 1], [BOARD_SIZE - 1, BOARD_SIZE - 1]];

  function createBoard() {
    var board = [], y;
    for (y = 0; y < BOARD_SIZE; y++) {
      board.push(new Array(BOARD_SIZE).fill(null));
    }
    return board;
  }

  function cloneBoard(board) {
    return board.map(function (row) { return row.slice(); });
  }

  function inBounds(x, y) {
    return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
  }

  function getCell(board, x, y) {
    return inBounds(x, y) ? board[y][x] : undefined;
  }

  function colorOnBoard(board, color) {
    for (var y = 0; y < BOARD_SIZE; y++) {
      for (var x = 0; x < BOARD_SIZE; x++) {
        if (board[y][x] === color) return true;
      }
    }
    return false;
  }

  /* ピースのバリエーションを原点 (ox, oy) に置いたときの絶対座標セル配列 */
  function placementCells(pieceId, variantIndex, origin) {
    var variants = Pieces.variantsOf(pieceId);
    var variant = variants[variantIndex];
    if (!variant) return null;
    return variant.map(function (c) { return [c[0] + origin[0], c[1] + origin[1]]; });
  }

  var EDGE_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var DIAG_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  /* 配置セル群が盤上の自色ピースと辺／角で接しているかを調べる（配置セル自体は盤上にある前提でも安全） */
  function contactInfo(board, color, cells) {
    var own = {};
    cells.forEach(function (c) { own[c[0] + ',' + c[1]] = true; });
    var edge = false, diagonal = false;
    cells.forEach(function (c) {
      EDGE_DIRS.forEach(function (d) {
        var nx = c[0] + d[0], ny = c[1] + d[1];
        if (!own[nx + ',' + ny] && getCell(board, nx, ny) === color) edge = true;
      });
      DIAG_DIRS.forEach(function (d) {
        var nx = c[0] + d[0], ny = c[1] + d[1];
        if (!own[nx + ',' + ny] && getCell(board, nx, ny) === color) diagonal = true;
      });
    });
    return { edge: edge, diagonal: diagonal };
  }

  function isCornerCell(x, y) {
    return CORNERS.some(function (c) { return c[0] === x && c[1] === y; });
  }

  /*
   * 配置可否判定。
   * options:
   *   firstMove (boolean|undefined): true=初手扱い（隅を完全に覆うこと）。
   *     undefined の場合は盤上に自色があるかどうかで自動判定する。
   *   allowEdge (boolean): ぴたっとボンド効果。true のとき自色との辺接を許可し、
   *     辺接でも「接続あり」とみなす（角接がなくても辺接があれば可）。
   * 戻り値: { ok: boolean, reason: string|null }
   *   reason: 'out-of-bounds' | 'occupied' | 'first-must-cover-corner' |
   *           'edge-contact' | 'no-corner-contact'
   */
  function validatePlacement(board, color, cells, options) {
    options = options || {};
    var i, c;
    for (i = 0; i < cells.length; i++) {
      c = cells[i];
      if (!inBounds(c[0], c[1])) return { ok: false, reason: 'out-of-bounds' };
    }
    for (i = 0; i < cells.length; i++) {
      c = cells[i];
      if (board[c[1]][c[0]] !== null) return { ok: false, reason: 'occupied' };
    }
    var firstMove = typeof options.firstMove === 'boolean'
      ? options.firstMove
      : !colorOnBoard(board, color);
    if (firstMove) {
      var coversCorner = cells.some(function (cell) { return isCornerCell(cell[0], cell[1]); });
      if (!coversCorner) return { ok: false, reason: 'first-must-cover-corner' };
      return { ok: true, reason: null };
    }
    var contact = contactInfo(board, color, cells);
    if (contact.edge && !options.allowEdge) {
      return { ok: false, reason: 'edge-contact' };
    }
    var connected = contact.diagonal || (options.allowEdge && contact.edge);
    if (!connected) return { ok: false, reason: 'no-corner-contact' };
    return { ok: true, reason: null };
  }

  function canPlace(board, color, cells, options) {
    return validatePlacement(board, color, cells, options).ok;
  }

  /*
   * 配置を適用した新しい盤面を返す（元の盤面は変更しない）。
   * 検証はしない。検証つきは tryPlace を使うこと。
   */
  function applyPlacement(board, color, cells) {
    var next = cloneBoard(board);
    cells.forEach(function (c) { next[c[1]][c[0]] = color; });
    return next;
  }

  /* 検証して配置する。成功時 { ok:true, board }, 失敗時 { ok:false, reason } */
  function tryPlace(board, color, cells, options) {
    var result = validatePlacement(board, color, cells, options);
    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true, board: applyPlacement(board, color, cells) };
  }

  /*
   * 合法手の列挙。
   * pieceIds: 手元にあるピース id の配列。
   * options は validatePlacement と同じ（firstMove / allowEdge）。limit を渡すと件数上限で打ち切る。
   * 戻り値: [{ pieceId, variantIndex, origin: [x, y], cells: [[x, y], ...] }, ...]
   */
  function legalMoves(board, color, pieceIds, options) {
    options = options || {};
    var limit = typeof options.limit === 'number' ? options.limit : Infinity;
    var moves = [];
    for (var p = 0; p < pieceIds.length; p++) {
      var pieceId = pieceIds[p];
      var variants = Pieces.variantsOf(pieceId);
      for (var v = 0; v < variants.length; v++) {
        for (var oy = 0; oy < BOARD_SIZE; oy++) {
          for (var ox = 0; ox < BOARD_SIZE; ox++) {
            var cells = placementCells(pieceId, v, [ox, oy]);
            if (canPlace(board, color, cells, options)) {
              moves.push({ pieceId: pieceId, variantIndex: v, origin: [ox, oy], cells: cells });
              if (moves.length >= limit) return moves;
            }
          }
        }
      }
    }
    return moves;
  }

  function hasLegalMove(board, color, pieceIds, options) {
    options = options || {};
    var opts = {};
    for (var k in options) opts[k] = options[k];
    opts.limit = 1;
    return legalMoves(board, color, pieceIds, opts).length > 0;
  }

  /* 手元ピース（id 配列）の残りマス総数 */
  function remainingSquares(pieceIds) {
    return pieceIds.reduce(function (sum, id) {
      var piece = Pieces.getPiece(id);
      return sum + (piece ? piece.size : 0);
    }, 0);
  }

  /* 手元ピース（id 配列）のうち一番小さいピースのマス数（ミニマイズ判定用）。空なら null */
  function smallestPieceSize(pieceIds) {
    var min = null;
    pieceIds.forEach(function (id) {
      var piece = Pieces.getPiece(id);
      if (piece && (min === null || piece.size < min)) min = piece.size;
    });
    return min;
  }

  /*
   * 通常モード：アドバンススコア。
   * input: { remainingSquares: number, piecesRemaining: number, lastPlacedSize: number|null }
   *   残りピースのマス総数 × -1。全部置ききれば +15、最後のピースが1マスなら合計 +20。
   */
  function advanceScore(input) {
    if (input.piecesRemaining === 0) {
      return input.lastPlacedSize === 1 ? 20 : 15;
    }
    return -input.remainingSquares;
  }

  /* 魔法使いモード：スタンダードスコア（残りマス総数。そのまま返し、少ない方が勝ち） */
  function wizardScore(input) {
    return input.remainingSquares;
  }

  /*
   * 最終スコア計算（人数変則をパラメータ化）。
   * players: [{ id, colors: ['blue'] }, ...]  2人戦では colors に2色を入れる。
   *   共有フリーピースの色はどのプレイヤーの colors にも含めない（自動的にスコア除外）。
   * perColor: { blue: { remainingSquares, piecesRemaining, lastPlacedSize }, ... }
   * mode: 'normal' | 'wizard'
   *   normal: プレイヤーのスコア = 担当色のアドバンススコア合計（高い方が勝ち）。
   *   wizard: 1色担当なら残りマス。2色担当なら「残りマスが多い方の色」のマス数（少ない方が勝ち）。
   * 戻り値: { scores: { playerId: number }, winners: [playerId, ...] }（同点は複数勝者）
   */
  function finalScores(players, perColor, mode) {
    var scores = {};
    players.forEach(function (player) {
      var colorScores = player.colors.map(function (color) {
        var info = perColor[color];
        if (!info) throw new Error('finalScores: missing perColor info for ' + color);
        return mode === 'wizard' ? wizardScore(info) : advanceScore(info);
      });
      if (mode === 'wizard') {
        scores[player.id] = colorScores.length === 1
          ? colorScores[0]
          : Math.max.apply(null, colorScores);
      } else {
        scores[player.id] = colorScores.reduce(function (a, b) { return a + b; }, 0);
      }
    });
    var values = players.map(function (p) { return scores[p.id]; });
    var best = mode === 'wizard' ? Math.min.apply(null, values) : Math.max.apply(null, values);
    var winners = players.filter(function (p) { return scores[p.id] === best; })
      .map(function (p) { return p.id; });
    return { scores: scores, winners: winners };
  }

  /*
   * ゲーム終了判定：どの色にも合法手がなければ終了。
   * hands: { blue: [pieceIds...], ... }（手元が空の色は置けないものとして扱う）
   * optionsByColor: { blue: { allowEdge }, ... }（省略可。firstMove は盤面から自動判定）
   */
  function isGameOver(board, hands, optionsByColor) {
    optionsByColor = optionsByColor || {};
    for (var i = 0; i < COLORS.length; i++) {
      var color = COLORS[i];
      var hand = hands[color];
      if (!hand || hand.length === 0) continue;
      if (hasLegalMove(board, color, hand, optionsByColor[color] || {})) return false;
    }
    return true;
  }

  /* 指定色がパスすべきか（手元はあるが合法手がない） */
  function shouldPass(board, color, pieceIds, options) {
    if (!pieceIds || pieceIds.length === 0) return true;
    return !hasLegalMove(board, color, pieceIds, options || {});
  }

  return {
    BOARD_SIZE: BOARD_SIZE,
    COLORS: COLORS,
    TURN_ORDER: COLORS.slice(),
    CORNERS: CORNERS.map(function (c) { return c.slice(); }),
    createBoard: createBoard,
    cloneBoard: cloneBoard,
    inBounds: inBounds,
    getCell: getCell,
    colorOnBoard: colorOnBoard,
    placementCells: placementCells,
    validatePlacement: validatePlacement,
    canPlace: canPlace,
    applyPlacement: applyPlacement,
    tryPlace: tryPlace,
    legalMoves: legalMoves,
    hasLegalMove: hasLegalMove,
    remainingSquares: remainingSquares,
    smallestPieceSize: smallestPieceSize,
    advanceScore: advanceScore,
    wizardScore: wizardScore,
    finalScores: finalScores,
    isGameOver: isGameOver,
    shouldPass: shouldPass
  };
});
