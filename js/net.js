/*
* net.js - マジック・ブロック PeerJS ラッパー（ブラウザ専用）
*
* ルームコードから PeerJS の peer id を決める（接頭辞 'magic-block-' ＋コード）。
* ホストがその id で待ち受け、ゲストは任意の id でホストへ接続する。
* 再接続はしない単純な作り。接続状態・エラーはコールバックで通知する。
*
* ネイティブの setTimeout/clearTimeout を
* オブジェクトのメソッドとして保持・呼び出ししない（本ファイルでは
* タイマー自体を使わず、必要な場合も素の関数として呼ぶこと）。
*/
(function (root) {
'use strict';

var PREFIX = 'magic-block-';
var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function roomPeerId(code) { return PREFIX + String(code).toUpperCase();}

function makeCode(len) {
len = len || 5;
var code = '';
for (var i = 0; i < len; i++) {
code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
}
return code;
}

function ensurePeer() {
if (!root || typeof root.Peer!== 'function') {
throw new Error('PeerJS が読み込まれていません（vendor/peerjs.min.js）');
}
}

/*
* ホストとして部屋を作る。
* handlers: {
* onOpen(peerId), onGuestOpen(connId), onGuestData(connId, msg),
* onGuestClose(connId), onError(type, err)
*}
* 戻り値: { sendTo(connId, msg), broadcast(msg), close(), peerId}
*/
function createHost(code, handlers) {
ensurePeer();
handlers = handlers || {};
var peer = new root.Peer(roomPeerId(code));
var conns = {};
var destroyed = false;

peer.on('open', function (id) {
if (handlers.onOpen) handlers.onOpen(id);
});
peer.on('connection', function (conn) {
var cid = conn.connectionId || conn.peer;
conns[cid] = conn;
conn.on('open', function () {
if (handlers.onGuestOpen) handlers.onGuestOpen(cid);
});
conn.on('data', function (data) {
if (handlers.onGuestData) handlers.onGuestData(cid, data);
});
conn.on('close', function () {
delete conns[cid];
if (handlers.onGuestClose) handlers.onGuestClose(cid);
});
});
peer.on('error', function (e) {
if (handlers.onError) handlers.onError(e && e.type? e.type: 'error', e);
});

function eachConn(fn) {
Object.keys(conns).forEach(function (cid) {
var c = conns[cid];
if (c && c.open) fn(c);
});
}

return {
peerId: roomPeerId(code),
sendTo: function (connId, msg) {
var c = conns[connId];
if (c && c.open) c.send(msg);
},
broadcast: function (msg) {
eachConn(function (c) { c.send(msg);});
},
close: function () {
if (destroyed) return;
destroyed = true;
eachConn(function (c) { try { c.close();} catch (e) { /* noop */}});
try { peer.destroy();} catch (e) { /* noop */}
}
};
}

/*
* ゲストとして部屋に参加する。
* handlers: { onOpen(), onData(msg), onClose(), onError(type, err)}
* 戻り値: { send(msg), close()}
*/
function createGuest(code, handlers) {
ensurePeer();
handlers = handlers || {};
var peer = new root.Peer();
var conn = null;
var destroyed = false;
var opened = false;

peer.on('open', function () {
conn = peer.connect(roomPeerId(code), { reliable: true});
conn.on('open', function () {
opened = true;
if (handlers.onOpen) handlers.onOpen();
});
conn.on('data', function (data) {
if (handlers.onData) handlers.onData(data);
});
conn.on('close', function () {
if (handlers.onClose) handlers.onClose();
});
});
peer.on('error', function (e) {
if (handlers.onError) handlers.onError(e && e.type? e.type: 'error', e);
});

return {
send: function (msg) {
if (conn && opened) conn.send(msg);
},
close: function () {
if (destroyed) return;
destroyed = true;
try { if (conn) conn.close();} catch (e) { /* noop */}
try { peer.destroy();} catch (e) { /* noop */}
}
};
}

var api = {
PREFIX: PREFIX,
roomPeerId: roomPeerId,
makeCode: makeCode,
createHost: createHost,
createGuest: createGuest
};
if (typeof module!== 'undefined' && module.exports) module.exports = api;
if (root) root.MagicNet = api;
})(typeof self!== 'undefined'? self: typeof globalThis!== 'undefined'? globalThis: this);
