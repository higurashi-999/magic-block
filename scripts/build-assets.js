#!/usr/bin/env node
/*
* build-assets.js - 画像素材を js/assets.js（data URI 集）に変換する生成スクリプト。
*
* GitHub へのプッシュはテキストのみ可能なため、assets-src/web/ の WebP 13点を
* base64 data URI 化し、UMD 風モジュール js/assets.js として書き出す。
* 生成物は手で編集しないこと（素材を差し替えたらこのスクリプトを再実行する）。
*
* 使い方: node scripts/build-assets.js
*/
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SRC_DIR = path.join(ROOT, 'assets-src', 'web');
var OUT_FILE = path.join(ROOT, 'js', 'assets.js');

var STUDENTS = ['sora', 'ren', 'hikari', 'yukino'];
var PARTNERS = ['lion', 'badger', 'eagle', 'snake'];

function dataUri(fileName) {
var filePath = path.join(SRC_DIR, fileName);
if (!fs.existsSync(filePath)) {
throw new Error('素材が見つかりません: ' + filePath);
}
var buf = fs.readFileSync(filePath);
return 'data:image/webp;base64,' + buf.toString('base64');
}

function entry(key, fileName) {
return ' ' + JSON.stringify(key) + ': ' + JSON.stringify(dataUri(fileName));
}

function group(name, keys, fileOf) {
var lines = keys.map(function (k) { return entry(k, fileOf(k));});
return ' ' + name + ': {\n' + lines.join(',\n') + '\n}';
}

var parts = [];
parts.push(' logo: ' + JSON.stringify(dataUri('logo-title.webp')));
parts.push(group('charNormal', STUDENTS, function (id) { return 'char-' + id + '-normal.webp';}));
parts.push(group('charMagic', STUDENTS, function (id) { return 'char-' + id + '-magic.webp';}));
parts.push(group('partner', PARTNERS, function (id) { return 'partner-' + id + '.webp';}));

var content =
'/*\n' +
' * assets.js - マジック・ブロック イラスト素材（data URI）\n' +
' *\n' +
' * scripts/build-assets.js が assets-src/web/ の WebP 13点から自動生成する。\n' +
' * 手で編集しないこと。素材の正典は assets-src/DESIGN_LOCK.md。\n' +
' * ブラウザ（グローバル MagicAssets）と Node（require）の両方で使える UMD 風モジュール。\n' +
' */\n' +
'(function (root, factory) {\n' +
' var api = factory();\n' +
' if (typeof module!== \'undefined\' && module.exports) {\n' +
' module.exports = api;\n' +
'}\n' +
' if (root) {\n' +
' root.MagicAssets = api;\n' +
'}\n' +
'})(typeof self!== \'undefined\'? self: typeof globalThis!== \'undefined\'? globalThis: this, function () {\n' +
' \'use strict\';\n\n' +
' return {\n' +
parts.join(',\n') + '\n' +
'};\n' +
'});\n';

fs.writeFileSync(OUT_FILE, content);
console.log('wrote ' + OUT_FILE + ' (' + content.length + ' bytes)');
