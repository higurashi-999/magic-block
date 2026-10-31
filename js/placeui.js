/*
 * placeui.js - 配置操作まわりの純粋関数（DOM・通信への依存なし）
 *
 * 対戦画面の「黄色ハイライト」とタップ操作を、テスト可能な形に切り出したもの。
 * ブラウザ（グローバル MagicPlaceUi）と Node（require）の両対応（UMD 風）。
 *
 * 用語：
 *   アンカー … ハイライト表示する「接続点」のマス。
 *     - 初手（opening）：ボード四隅のマス
 *     - 通常手番：自色の既配置ピースに角（斜め）で接する空きマス
 *       （ぴたっとボンド発動中は、辺で接するマスも接続点になるため含める）
 *   合法手は必ず「接続」を根拠に成立するので、どの合法配置も最低1つの
 *   アンカーを覆う。逆にアンカーを覆わない配置は存在しない。したがって
 *   ハイライトをアンカーだけに絞っても、到達できない合法手は生まれない。
 */
(function (root, factory) {
  var Logic = null;
  if (typeof module !== 'undefined' && module.exports) {
    Logic = require('./logic.js');
    module.exports = factory(Logic);
  }
  if (root) {
    root.MagicPlaceUi = factory(root.MagicLogic);
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function (Logic) {
  'use strict';

  if (!Logic) throw new Error('placeui.js requires logic.js (MagicLogic)');

  var EDGE_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var DIAG_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  function key(x, y) { return x + ',' + y; }

  function touches(board, color, x, y, dirs) {
    for (var i = 0; i < dirs.length; i++) {
      if (Logic.getCell(board, x + dirs[i][0], y + dirs[i][1]) === color) return true;
    }
    return false;
  }

  /*
   * 配置セル (x, y) がアンカーかどうか。
   * options: { opening: boolean, allowEdge: boolean }
   *   board は配置「前」の盤面（自色の既配置ピースが載っている状態）を渡すこと。
   */
  function isAnchorCell(board, color, x, y, options) {
    options = options || {};
    if (options.opening) return Logic.isCornerCell
      ? Logic.isCornerCell(x, y)
      : Logic.CORNERS.some(function (c) { return c[0] === x && c[1] === y; });
    if (Logic.getCell(board, x, y) !== null) return false; // 占有マスはアンカーにしない
    if (touches(board, color, x, y, DIAG_DIRS)) return true;
    if (options.allowEdge && touches(board, color, x, y, EDGE_DIRS)) return true;
    return false;
  }

  /*
   * 合法手リストを「アンカーキー -> そのアンカーを覆う候補（合法手）の配列」に
   * グループ化する。options.pieceId を渡すとそのピースの手だけに絞る。
   * 候補の並びは moves の順序をそのまま保つ（＝ state の合法手列挙順で安定）。
   * 候補切り替えのインデックスはこの並びを前提にするため、呼び出し側で
   * 動的に並び替えてはいけない。
   */
  function buildAnchorMap(moves, board, color, options) {
    options = options || {};
    var map = {};
    moves.forEach(function (m) {
      if (options.pieceId && m.pieceId !== options.pieceId) return;
      m.cells.forEach(function (c) {
        if (!isAnchorCell(board, color, c[0], c[1], options)) return;
        var k = key(c[0], c[1]);
        if (!map[k]) map[k] = [];
        map[k].push(m);
      });
    });
    return map;
  }

  /* 合法手リストに登場するピース id の集合（{ pieceId: true }） */
  function placeablePieceIds(moves) {
    var set = {};
    moves.forEach(function (m) { set[m.pieceId] = true; });
    return set;
  }

  /* 2つの move が同一配置かどうか（ピース・バリエーション・原点で判定） */
  function sameMove(a, b) {
    return !!a && !!b &&
      a.pieceId === b.pieceId &&
      a.variantIndex === b.variantIndex &&
      a.origin[0] === b.origin[0] &&
      a.origin[1] === b.origin[1];
  }

  /*
   * 盤面タップの解決。
   * input: {
   *   anchors: buildAnchorMap の結果,
   *   activeAnchor: 現在選択中のアンカーキー（なければ null）,
   *   candIdx: activeAnchor の候補配列における現在のインデックス,
   *   tentative: 現在表示中の仮置き move（なければ null）,
   *   preferredVariantIndex: 新しいアンカーを選ぶときに優先したいバリエーション（任意）,
   *   x, y: タップしたマス
   * }
   * 戻り値:
   *   { action: 'select', anchor, candIdx, move }  仮置きを move に切り替える
   *   { action: 'confirm', move }                 そのまま配置を確定する
   *   null                                        何もしない
   *
   * ルール:
   *   - アンカーをタップすると、そのアンカーを覆う候補を仮置き表示する。
   *     同じアンカーの連続タップで候補を順に切り替える。
   *   - タップで選ばれる配置が現在の仮置きと同一なら「2回連続タップ」とみなして
   *     確定する（候補が1つしかないアンカーの2回目タップ、仮置きが覆う別アンカー
   *     のタップ、など）。候補が複数ある場合は切り替えが優先され、誤確定しない。
   *   - 仮置き（ゴースト）のマスのうちアンカーでないマスをタップしても確定する。
   */
  function pickTap(input) {
    var x = input.x, y = input.y;
    var k = key(x, y);
    var tent = input.tentative || null;
    var candidates = input.anchors ? input.anchors[k] : null;
    if (candidates && candidates.length > 0) {
      var idx = 0;
      if (input.activeAnchor === k && tent) {
        idx = (input.candIdx + 1) % candidates.length;
      } else if (typeof input.preferredVariantIndex === 'number') {
        for (var i = 0; i < candidates.length; i++) {
          if (candidates[i].variantIndex === input.preferredVariantIndex) { idx = i; break; }
        }
      }
      var move = candidates[idx];
      if (tent && sameMove(tent, move)) return { action: 'confirm', move: move };
      return { action: 'select', anchor: k, candIdx: idx, move: move };
    }
    if (tent) {
      var onGhost = tent.cells.some(function (c) { return c[0] === x && c[1] === y; });
      if (onGhost) return { action: 'confirm', move: tent };
    }
    return null;
  }

  return {
    key: key,
    isAnchorCell: isAnchorCell,
    buildAnchorMap: buildAnchorMap,
    placeablePieceIds: placeablePieceIds,
    sameMove: sameMove,
    pickTap: pickTap
  };
});
