/*
 * pieces.js - マジック・ブロック 標準21ピース定義
 *
 * 各色が持つ21ピース（モノミノ1 / ドミノ1 / トリミノ2 / テトロミノ5 / ペントミノ12、
 * 合計89マス）の形状定義と、回転・反転バリエーション生成。
 * ブラウザ（グローバル MagicPieces）と Node（require）の両方で使える UMD 風モジュール。
 * DOM・通信への依存なし。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.MagicPieces = api;
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* 文字アート（'X' がマス）からセル座標 [x, y] の配列を作る */
  function parseArt(art) {
    var cells = [];
    for (var y = 0; y < art.length; y++) {
      var row = art[y];
      for (var x = 0; x < row.length; x++) {
        if (row.charAt(x) === 'X') cells.push([x, y]);
      }
    }
    return normalizeCells(cells);
  }

  /* 左上 (最小x, 最小y) が (0,0) になるよう平行移動し、(y, x) 順にソートする */
  function normalizeCells(cells) {
    var minX = Infinity, minY = Infinity, i;
    for (i = 0; i < cells.length; i++) {
      if (cells[i][0] < minX) minX = cells[i][0];
      if (cells[i][1] < minY) minY = cells[i][1];
    }
    var out = cells.map(function (c) { return [c[0] - minX, c[1] - minY]; });
    out.sort(function (a, b) { return (a[1] - b[1]) || (a[0] - b[0]); });
    return out;
  }

  function cellsKey(cells) {
    return cells.map(function (c) { return c[0] + ',' + c[1]; }).join(';');
  }

  /* 90度回転 (x, y) -> (y, -x) */
  function rotate90(cells) {
    return normalizeCells(cells.map(function (c) { return [c[1], -c[0]]; }));
  }

  /* 左右反転 (x, y) -> (-x, y) */
  function flipX(cells) {
    return normalizeCells(cells.map(function (c) { return [-c[0], c[1]]; }));
  }

  /*
   * 回転4通り × 反転2通りの全バリエーション（重複排除済み）を返す。
   * 各バリエーションは normalizeCells 済みのセル配列。
   */
  function buildVariants(baseCells) {
    var seen = {}, variants = [], current, i, j;
    for (i = 0; i < 2; i++) {
      current = i === 0 ? baseCells : flipX(baseCells);
      for (j = 0; j < 4; j++) {
        var key = cellsKey(current);
        if (!seen[key]) {
          seen[key] = true;
          variants.push(current);
        }
        current = rotate90(current);
      }
    }
    return variants;
  }

  /* ピース定義: label は表示用コード（マス数 + 形状名） */
  var DEFS = [
    // 1マス（モノミノ）
    { id: 'one', label: '1', art: ['X'] },
    // 2マス（ドミノ）
    { id: 'two', label: '2', art: ['XX'] },
    // 3マス（トリミノ）2種
    { id: 'three-line', label: '3I', art: ['XXX'] },
    { id: 'three-corner', label: '3V', art: ['XX', 'X.'] },
    // 4マス（テトロミノ）5種 = 自由テトロミノ全種
    { id: 'four-line', label: '4I', art: ['XXXX'] },
    { id: 'four-square', label: '4O', art: ['XX', 'XX'] },
    { id: 'four-t', label: '4T', art: ['XXX', '.X.'] },
    { id: 'four-l', label: '4L', art: ['X.', 'X.', 'XX'] },
    { id: 'four-z', label: '4Z', art: ['XX.', '.XX'] },
    // 5マス（ペントミノ）12種 = 自由ペントミノ全種（F I L P N T U V W X Y Z）
    { id: 'five-f', label: '5F', art: ['.XX', 'XX.', '.X.'] },
    { id: 'five-i', label: '5I', art: ['XXXXX'] },
    { id: 'five-l', label: '5L', art: ['X.', 'X.', 'X.', 'XX'] },
    { id: 'five-p', label: '5P', art: ['XX', 'XX', 'X.'] },
    { id: 'five-n', label: '5N', art: ['.X', '.X', 'XX', 'X.'] },
    { id: 'five-t', label: '5T', art: ['XXX', '.X.', '.X.'] },
    { id: 'five-u', label: '5U', art: ['X.X', 'XXX'] },
    { id: 'five-v', label: '5V', art: ['X..', 'X..', 'XXX'] },
    { id: 'five-w', label: '5W', art: ['X..', 'XX.', '.XX'] },
    { id: 'five-x', label: '5X', art: ['.X.', 'XXX', '.X.'] },
    { id: 'five-y', label: '5Y', art: ['.X', 'XX', '.X', '.X'] },
    { id: 'five-z', label: '5Z', art: ['XX.', '.X.', '.XX'] }
  ];

  var PIECES = DEFS.map(function (d) {
    var cells = parseArt(d.art);
    return {
      id: d.id,
      label: d.label,
      size: cells.length,
      cells: cells,
      variants: buildVariants(cells)
    };
  });

  var PIECE_MAP = {};
  PIECES.forEach(function (p) { PIECE_MAP[p.id] = p; });

  function getPiece(id) {
    return PIECE_MAP[id] || null;
  }

  /* ピース（オブジェクトまたは id）の全バリエーションを返す */
  function variantsOf(pieceOrId) {
    var piece = typeof pieceOrId === 'string' ? getPiece(pieceOrId) : pieceOrId;
    return piece ? piece.variants : [];
  }

  /* 形状の正準キー：全バリエーションのキーのうち辞書順最小（同一形状の判定用） */
  function canonicalKey(cells) {
    return buildVariants(normalizeCells(cells))
      .map(cellsKey)
      .sort()[0];
  }

  var TOTAL_SQUARES = PIECES.reduce(function (sum, p) { return sum + p.size; }, 0);

  return {
    PIECES: PIECES,
    PIECE_MAP: PIECE_MAP,
    PIECE_COUNT: PIECES.length,
    TOTAL_SQUARES_PER_COLOR: TOTAL_SQUARES,
    getPiece: getPiece,
    variantsOf: variantsOf,
    normalizeCells: normalizeCells,
    cellsKey: cellsKey,
    canonicalKey: canonicalKey,
    rotate90: rotate90,
    flipX: flipX
  };
});
