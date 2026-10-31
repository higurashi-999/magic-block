/*
 * ui.js - マジック・ブロック ローカル対戦UI（DOM操作）
 * ゲーム進行は MagicState / MagicCpu の純粋ロジックに委ね、ここは表示と入力だけを行う。
 */
(function () {
  'use strict';

  var Pieces = window.MagicPieces;
  var Logic = window.MagicLogic;
  var State = window.MagicState;
  var Cpu = window.MagicCpu;
  var PlaceUi = window.MagicPlaceUi;
  var Net = window.MagicNet;
  var Session = window.MagicSession;

  var COLOR_NAMES = { blue: '青', yellow: '黄', red: '赤', green: '緑' };
  var REASON_MSGS = {
    'has-legal-moves': '置ける場所があるからパスできないよ',
    'must-play-card-first': 'まずカードを出してね',
    'cannot-pass-in-opening': '最初の1手はパスできないよ',
    'game-finished': 'ゲームは終わっています',
    'not-your-turn': 'まだあなたの番じゃないよ',
    'already-taken': 'そのキャラ・相棒はもう選ばれているよ',
    'pair-conflict': '2人戦では相棒の色ペアがかぶらないように選んでね',
    'room-full': '部屋が満員だよ',
    'already-started': 'その部屋はもう始まっているよ',
    'not-in-game': 'まだ対戦が始まっていないよ',
    'no-seat': '席が見つからないよ',
    'invalid-choice': 'その選択はできないよ'
  };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function showScreen(id) {
    ['screen-home', 'screen-setup', 'screen-select', 'screen-game', 'screen-result',
     'screen-online', 'screen-lobby']
      .forEach(function (s) { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
  }

  /* ============ 設定 ============ */
  var setup = { count: 4, mode: 'normal', cpuLevel: 2, seats: [] };

  function segWire(id, key, parse) {
    $(id).addEventListener('click', function (ev) {
      var btn = ev.target.closest('button');
      if (!btn) return;
      Array.prototype.forEach.call($(id).children, function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      setup[key] = parse(btn.dataset.v);
      if (key === 'count') renderSeats();
      if (key === 'mode') applyTheme();
    });
  }
  function applyTheme() {
    document.body.className = setup.mode === 'wizard' ? 'theme-wizard' : 'theme-normal';
  }

  function renderSeats() {
    var wrap = $('seat-list');
    wrap.innerHTML = '';
    setup.seats = [];
    for (var i = 0; i < setup.count; i++) {
      var row = el('div', 'seat-row');
      row.appendChild(el('span', 'seat-label', 'プレイヤー' + (i + 1)));
      var name = document.createElement('input');
      name.type = 'text';
      name.value = i === 0 ? 'あなた' : 'プレイヤー' + (i + 1);
      name.maxLength = 10;
      row.appendChild(name);
      var type = null;
      if (i === 0) {
        row.appendChild(el('span', null, '🧑 人間（固定）'));
        setup.seats.push({ nameInput: name, typeSelect: null });
      } else {
        type = document.createElement('select');
        [['cpu', '🤖 CPU'], ['human', '🧑 人間']].forEach(function (pair) {
          var opt = document.createElement('option');
          opt.value = pair[0]; opt.textContent = pair[1];
          type.appendChild(opt);
        });
        row.appendChild(type);
        setup.seats.push({ nameInput: name, typeSelect: type });
      }
      wrap.appendChild(row);
    }
  }

  /* ============ キャラ選択 ============ */
  var sel = null; // { seatIdx, step, gender, humanSeats: [seatIdx...], choices: {seatIdx:{student,partner}} }

  function startSelect() {
    var humanSeats = [];
    setup.seats.forEach(function (s, i) {
      if (i === 0 || s.typeSelect.value === 'human') humanSeats.push(i);
    });
    sel = { humanSeats: humanSeats, pos: 0, step: 'gender', gender: null, choices: {} };
    showScreen('screen-select');
    renderSelect();
  }

  function takenStudents() {
    return Object.keys(sel.choices).map(function (k) { return sel.choices[k].student; }).filter(Boolean);
  }
  function takenPartners() {
    return Object.keys(sel.choices).map(function (k) { return sel.choices[k].partner; }).filter(Boolean);
  }
  function seatName(i) { return setup.seats[i].nameInput.value || ('プレイヤー' + (i + 1)); }

  /* 2人戦：先に選んだ相棒の色ペアと競合しない相棒だけ選べる */
  function partnerAllowed(partnerId) {
    if (setup.count !== 2) return true;
    var taken = takenPartners();
    if (taken.length === 0) return true;
    var firstColor = State.partnerById(taken[0]).color;
    var myColor = State.partnerById(partnerId).color;
    return State.pairOf(firstColor).indexOf(myColor) < 0;
  }

  function choiceCard(emoji, title, sub, disabled, onclick) {
    var card = el('button', 'choice-card' + (disabled ? ' disabled' : ''));
    var b = el('span', 'big-emoji', emoji);
    card.appendChild(b);
    card.appendChild(document.createTextNode(title));
    if (sub) card.appendChild(el('span', 'forms', sub));
    if (!disabled) card.addEventListener('click', onclick);
    return card;
  }

  function renderSelect() {
    var seatIdx = sel.humanSeats[sel.pos];
    var body = $('select-body');
    body.innerHTML = '';
    $('select-title').textContent = 'キャラ選択（' + seatName(seatIdx) + 'さん）';
    $('select-progress').textContent =
      '人間プレイヤー ' + (sel.pos + 1) + ' / ' + sel.humanSeats.length + ' 人目';

    if (sel.step === 'gender') {
      body.appendChild(el('div', 'step-title', '性別をえらんでね'));
      var grid = el('div', 'choice-grid');
      grid.appendChild(choiceCard('👦', 'おとこのこ', null, false, function () {
        sel.gender = 'male'; sel.step = 'student'; renderSelect();
      }));
      grid.appendChild(choiceCard('👧', 'おんなのこ', null, false, function () {
        sel.gender = 'female'; sel.step = 'student'; renderSelect();
      }));
      body.appendChild(grid);
    } else if (sel.step === 'student') {
      body.appendChild(el('div', 'step-title', '生徒をえらんでね'));
      var grid2 = el('div', 'choice-grid');
      var taken = takenStudents();
      State.STUDENTS.filter(function (s) { return s.gender === sel.gender; }).forEach(function (stu) {
        var forms = '普通の学校：' + stu.emoji + ' ／ 魔法学校：' + stu.wizardEmoji;
        grid2.appendChild(choiceCard(
          setup.mode === 'wizard' ? stu.wizardEmoji : stu.emoji,
          stu.name, forms, taken.indexOf(stu.id) >= 0,
          function () {
            sel.choices[seatIdx] = { student: stu.id, partner: null };
            sel.step = 'partner'; renderSelect();
          }));
      });
      body.appendChild(grid2);
    } else if (sel.step === 'partner') {
      body.appendChild(el('div', 'step-title', '相棒をえらんでね（色が決まるよ）'));
      var grid3 = el('div', 'choice-grid');
      var takenP = takenPartners();
      State.PARTNERS.forEach(function (pt) {
        var disabled = takenP.indexOf(pt.id) >= 0 || !partnerAllowed(pt.id);
        var card = choiceCard(pt.emoji, pt.name, null, disabled, function () {
          sel.choices[seatIdx].partner = pt.id;
          nextSelectSeat();
        });
        var chip = el('span', 'color-chip dot-' + pt.color);
        card.insertBefore(chip, card.childNodes[1]);
        card.appendChild(el('span', 'forms', COLOR_NAMES[pt.color] + 'のピース担当'));
        grid3.appendChild(card);
      });
      body.appendChild(grid3);
    }
  }

  function nextSelectSeat() {
    sel.pos++;
    sel.step = 'gender';
    sel.gender = null;
    if (sel.pos >= sel.humanSeats.length) {
      finishSelectAndStart();
    } else {
      renderSelect();
    }
  }

  /* CPU席のキャラ・相棒を自動割当してゲーム開始 */
  function finishSelectAndStart() {
    var usedStudents = takenStudents();
    var usedPartners = takenPartners();
    var players = [];
    for (var i = 0; i < setup.count; i++) {
      var isHuman = i === 0 || setup.seats[i].typeSelect.value === 'human';
      var choice = sel.choices[i];
      if (!choice) {
        var stu = State.STUDENTS.find(function (s) { return usedStudents.indexOf(s.id) < 0; });
        var pt = State.PARTNERS.find(function (p) {
          return usedPartners.indexOf(p.id) < 0 && partnerAllowedFor(p.id, usedPartners);
        });
        choice = { student: stu.id, partner: pt.id };
        usedStudents.push(stu.id);
        usedPartners.push(pt.id);
      }
      players.push({
        id: 'p' + (i + 1),
        name: seatName(i),
        type: isHuman ? 'human' : 'cpu',
        cpuLevel: setup.cpuLevel,
        characterId: choice.student,
        partnerId: choice.partner
      });
    }
    startGame(players);
  }
  function partnerAllowedFor(partnerId, usedPartners) {
    if (setup.count !== 2 || usedPartners.length === 0) return true;
    var firstColor = State.partnerById(usedPartners[0]).color;
    return State.pairOf(firstColor).indexOf(State.partnerById(partnerId).color) < 0;
  }

  /* ============ オンライン対戦 ============ */
  var online = null;
  // { role:'host'|'guest', code, name, net, session, myKey, myPlayerId, lobby, cpuLevel, mode }
  var osel = null; // オンライン用キャラ選択 { step, gender, student, partner }
  var hostPumpTimer = null;

  function onlineName() {
    return ($('online-name').value || '').trim() || (online && online.role === 'host' ? 'ホスト' : 'ゲスト');
  }
  function setOnlineStatus(text) { $('online-status').textContent = text || ''; }
  function setLobbyMsg(text) { $('lobby-msg').textContent = text || ''; }

  function mySeat() {
    if (!online || !online.lobby) return null;
    var key = online.role === 'host' ? Session.LOCAL_KEY : online.myKey;
    var found = null;
    online.lobby.seats.forEach(function (s) { if (s.key === key) found = s; });
    return found;
  }

  /* 配信された公開 state を、UI が描画できる形（自分の手札だけ実データ）に戻す */
  function buildViewState(pub, priv) {
    var view = JSON.parse(JSON.stringify(pub));
    Object.keys(view.decks || {}).forEach(function (key) {
      var d = view.decks[key];
      var hand = (priv && key === priv.playerId) ? priv.hand.slice() : [];
      if (priv && key !== priv.playerId) {
        for (var i = 0; i < d.handCount; i++) hand.push(null);
      }
      view.decks[key] = { draw: new Array(d.drawCount), hand: hand, discard: d.discard };
    });
    return view;
  }

  function onOnlineState(msg) {
    if (!online) return;
    online.myPlayerId = msg.private ? msg.private.playerId : null;
    game = buildViewState(msg.state, msg.private);
    setup.mode = game.mode;
    resetUi();
    applyTheme();
    buildBoard();
    showScreen('screen-game');
    renderAll();
  }

  function onOnlineError(msg) {
    var text = REASON_MSGS[msg.reason] || msg.reason;
    if (!$('screen-game').hidden) {
      showMsg(msg.reason);
    } else if (!$('screen-lobby').hidden || !$('screen-select').hidden) {
      setLobbyMsg(text);
      // 選択の競合なら最新のロビー情報で選択画面を描き直す
      if (msg.reason === 'already-taken' && osel && online && online.lobby &&
          online.lobby.phase === 'select') {
        showScreen('screen-select');
        renderOnlineSelect();
      }
    } else {
      setOnlineStatus(text);
    }
  }

  function onOnlineEnded() {
    var was = online;
    leaveOnline(false);
    game = null;
    document.body.className = 'theme-normal';
    showScreen('screen-home');
    if (was) alert('ホストとの接続が切れたため、対戦は終了しました。');
  }

  function handleHostMessage(msg) {
    if (!online || online.role !== 'host') return;
    if (msg.t === 'lobby') {
      online.lobby = msg.lobby;
      renderLobby();
      if (osel && !$('screen-select').hidden) renderOnlineSelect();
    } else if (msg.t === 'state') {
      onOnlineState(msg);
    } else if (msg.t === 'error') {
      onOnlineError(msg);
    }
  }

  function startHostRoom() {
    var name = onlineName();
    var code = Net.makeCode(5);
    online = {
      role: 'host', code: code, name: name, net: null, session: null,
      myKey: Session.LOCAL_KEY, myPlayerId: null, lobby: null, cpuLevel: 2, mode: 'normal'
    };
    setOnlineStatus('部屋を作成中…');
    var session = Session.createHostSession({
      code: code, hostName: name,
      sendLocal: handleHostMessage
    });
    online.session = session;
    try {
      online.net = Net.createHost(code, {
        onOpen: function () {
          online.lobby = session.getLobby();
          showScreen('screen-lobby');
          renderLobby();
        },
        onGuestOpen: function (connId) {
          var key = session.attachGuest(function (m) { online.net.sendTo(connId, m); });
          online['keyOf_' + connId] = key;
        },
        onGuestData: function (connId, data) {
          var key = online['keyOf_' + connId];
          if (key) session.receive(key, data);
        },
        onGuestClose: function (connId) {
          var key = online['keyOf_' + connId];
          if (key) session.detachGuest(key);
        },
        onError: function (type) {
          if (type === 'unavailable-id') {
            setOnlineStatus('そのルームコードは使用中だよ。もう一度試してね。');
            showScreen('screen-online');
            leaveOnline(false);
          } else {
            setOnlineStatus('通信エラー（' + type + '）');
          }
        }
      });
    } catch (e) {
      setOnlineStatus('通信の初期化に失敗しました');
      online = null;
    }
  }

  function startGuestRoom() {
    var code = ($('online-code').value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,6}$/.test(code)) {
      setOnlineStatus('ルームコードは英数字4〜6文字で入力してね');
      return;
    }
    var name = onlineName();
    online = {
      role: 'guest', code: code, name: name, net: null, session: null,
      myKey: null, myPlayerId: null, lobby: null, cpuLevel: 2, mode: 'normal'
    };
    setOnlineStatus('部屋「' + code + '」に接続中…');
    var session = Session.createGuestSession({
      name: name,
      send: function (m) { if (online && online.net) online.net.send(m); },
      onWelcome: function (msg) {
        online.myKey = msg.key;
        showScreen('screen-lobby');
      },
      onLobby: function (lobby) {
        online.lobby = lobby;
        renderLobby();
        if (!$('screen-select').hidden) {
          if (osel) renderOnlineSelect();
        } else if ($('screen-game').hidden) {
          showScreen('screen-lobby');
        }
      },
      onState: onOnlineState,
      onError: onOnlineError,
      onNotice: function (msg) { setLobbyMsg(msg.text); },
      onEnded: onOnlineEnded
    });
    online.session = session;
    try {
      online.net = Net.createGuest(code, {
        onOpen: function () { session.connect(); },
        onData: function (data) { session.receive(data); },
        onClose: function () { session.transportClosed(); },
        onError: function (type) {
          if (type === 'peer-unavailable') {
            setOnlineStatus('部屋が見つからないよ。コードを確認してね。');
          } else {
            setOnlineStatus('通信エラー（' + type + '）');
          }
        }
      });
    } catch (e) {
      setOnlineStatus('通信の初期化に失敗しました');
      online = null;
    }
  }

  function leaveOnline(notifyHost) {
    if (hostPumpTimer) { clearTimeout(hostPumpTimer); hostPumpTimer = null; }
    if (!online) return;
    var o = online;
    online = null;
    try {
      if (o.role === 'host' && o.session) o.session.close();
      if (o.role === 'guest' && o.session && notifyHost !== false) o.session.leave();
    } catch (e) { /* noop */ }
    try { if (o.net) o.net.close(); } catch (e) { /* noop */ }
  }

  /* --- ロビー描画 --- */
  function renderLobby() {
    if (!online || !online.lobby) return;
    var lobby = online.lobby;
    var isHost = online.role === 'host';
    $('lobby-code').textContent = online.code;
    var note = {
      waiting: '友達にコードを教えて、集まるのを待ってね。',
      select: 'キャラと相棒を選んでね（先に選んだ人のものは選べないよ）。',
      game: '対戦中だよ。'
    }[lobby.phase] || '';
    $('lobby-phase-note').textContent = note;

    var wrap = $('lobby-members');
    wrap.innerHTML = '';
    var me = mySeat();
    lobby.seats.forEach(function (s) {
      var row = el('div', 'member-row' + (s.connected ? '' : ' offline') + (me && s.key === me.key ? ' me' : ''));
      var label;
      if (s.kind === 'cpu') {
        label = '🤖 ' + s.name + '（つよさ ' + s.cpuLevel + '）';
      } else {
        var stu = s.characterId ? State.studentById(s.characterId) : null;
        var pt = s.partnerId ? State.partnerById(s.partnerId) : null;
        label = (stu ? (onlineModeIsWizard() ? stu.wizardEmoji : stu.emoji) : '🧑') +
          (pt ? pt.emoji : '') + ' ' + s.name + (s.isHost ? '（ホスト）' : '');
      }
      row.appendChild(el('span', 'm-name', label));
      var status;
      if (s.kind === 'cpu') status = s.characterId ? '準備OK' : '自動で割当';
      else if (!s.connected) status = '切断中…';
      else if (lobby.phase === 'waiting') status = '待機中';
      else if (s.declared) status = '選択OK ✔';
      else status = '選択中…';
      row.appendChild(el('span', 'm-status', status));
      wrap.appendChild(row);
    });

    $('lobby-host-controls').hidden = !isHost;
    $('lobby-guest-controls').hidden = isHost;
    if (isHost) {
      $('lobby-cpu-row').hidden = lobby.phase !== 'waiting';
      $('btn-begin-select').hidden = lobby.phase !== 'waiting' || lobby.seats.length < 2;
      $('lobby-start-row').hidden = !(lobby.phase === 'select' && lobby.allDeclared);
      $('btn-lobby-select').hidden = true;
      if (lobby.phase === 'select' && me && !me.declared) {
        $('lobby-host-controls').hidden = false;
        $('btn-lobby-select').hidden = false;
        $('lobby-guest-controls').hidden = false;
        $('lobby-guest-note').textContent = 'ホストのあなたもキャラ・相棒を選んでね。';
      }
    } else {
      var needSelect = lobby.phase === 'select' && me && !me.declared;
      $('btn-lobby-select').hidden = !needSelect;
      $('lobby-guest-note').textContent =
        lobby.phase === 'waiting' ? 'ホストがキャラ選択をはじめるのを待っているよ…' :
        lobby.phase === 'select' ? (me && me.declared ? '選択OK！みんなが選び終わるのを待っているよ…' : 'キャラ・相棒を選んでね。') :
        '対戦中だよ。';
    }
    if (lobby.phase === 'game' && game) showScreen('screen-game');
  }
  function onlineModeIsWizard() {
    return online && online.lobby && online.lobby.mode === 'wizard';
  }

  /* --- オンライン用キャラ選択（自分1人分） --- */
  function startOnlineSelect() {
    osel = { step: 'gender', gender: null, student: null, partner: null };
    showScreen('screen-select');
    renderOnlineSelect();
  }
  function onlineTakenStudents() {
    if (!online || !online.lobby) return [];
    return online.lobby.seats.filter(function (s) { return s.declared && s.characterId; })
      .map(function (s) { return s.characterId; });
  }
  function onlineTakenPartners() {
    if (!online || !online.lobby) return [];
    return online.lobby.seats.filter(function (s) { return s.declared && s.partnerId; })
      .map(function (s) { return s.partnerId; });
  }
  function onlinePartnerAllowed(partnerId) {
    if (!online || !online.lobby || online.lobby.seats.length !== 2) return true;
    var others = online.lobby.seats.filter(function (s) {
      return s.declared && s.partnerId && !(mySeat() && s.key === mySeat().key);
    });
    if (others.length === 0) return true;
    var firstColor = State.partnerById(others[0].partnerId).color;
    return State.pairOf(firstColor).indexOf(State.partnerById(partnerId).color) < 0;
  }
  function renderOnlineSelect() {
    if (!osel) return;
    var body = $('select-body');
    body.innerHTML = '';
    $('select-title').textContent = 'キャラ選択（' + online.name + 'さん）';
    $('select-progress').textContent = 'オンライン対戦：自分のキャラと相棒を選んでね';
    if (osel.step === 'gender') {
      body.appendChild(el('div', 'step-title', '性別をえらんでね'));
      var grid = el('div', 'choice-grid');
      grid.appendChild(choiceCard('👦', 'おとこのこ', null, false, function () {
        osel.gender = 'male'; osel.step = 'student'; renderOnlineSelect();
      }));
      grid.appendChild(choiceCard('👧', 'おんなのこ', null, false, function () {
        osel.gender = 'female'; osel.step = 'student'; renderOnlineSelect();
      }));
      body.appendChild(grid);
    } else if (osel.step === 'student') {
      body.appendChild(el('div', 'step-title', '生徒をえらんでね'));
      var grid2 = el('div', 'choice-grid');
      var taken = onlineTakenStudents();
      State.STUDENTS.filter(function (s) { return s.gender === osel.gender; }).forEach(function (stu) {
        var forms = '普通の学校：' + stu.emoji + ' ／ 魔法学校：' + stu.wizardEmoji;
        grid2.appendChild(choiceCard(stu.emoji, stu.name, forms, taken.indexOf(stu.id) >= 0,
          function () {
            osel.student = stu.id; osel.step = 'partner'; renderOnlineSelect();
          }));
      });
      body.appendChild(grid2);
    } else if (osel.step === 'partner') {
      body.appendChild(el('div', 'step-title', '相棒をえらんでね（色が決まるよ）'));
      var grid3 = el('div', 'choice-grid');
      var takenP = onlineTakenPartners();
      State.PARTNERS.forEach(function (pt) {
        var disabled = takenP.indexOf(pt.id) >= 0 || !onlinePartnerAllowed(pt.id);
        var card = choiceCard(pt.emoji, pt.name, null, disabled, function () {
          osel.partner = pt.id;
          submitOnlineDeclare();
        });
        var chip = el('span', 'color-chip dot-' + pt.color);
        card.insertBefore(chip, card.childNodes[1]);
        card.appendChild(el('span', 'forms', COLOR_NAMES[pt.color] + 'のピース担当'));
        grid3.appendChild(card);
      });
      body.appendChild(grid3);
    }
  }
  function submitOnlineDeclare() {
    if (!online || !osel) return;
    if (online.role === 'host') {
      online.session.receive(Session.LOCAL_KEY, {
        t: 'declare', characterId: osel.student, partnerId: osel.partner
      });
    } else {
      online.session.declare(osel.student, osel.partner);
    }
    osel = null;
    showScreen('screen-lobby');
    renderLobby();
  }

  /* オンライン時の move 送信（結果は state 配信で戻ってくる） */
  function submitOnlineMove(move) {
    if (!online) return;
    if (online.role === 'host') {
      online.session.receive(Session.LOCAL_KEY, { t: 'move', move: move });
    } else {
      online.session.sendMove(move);
    }
    clearPieceSelection();
    ui.targetMode = null; ui.cardIndex = null; ui.warpCtx = null;
    showMsg('');
    renderAll();
  }

  /* ホスト側：CPU席・切断席の手番を少しずつ進める */
  function scheduleHostPump() {
    if (hostPumpTimer) { clearTimeout(hostPumpTimer); hostPumpTimer = null; }
    if (!online || online.role !== 'host' || !game || game.phase === 'finished') return;
    hostPumpTimer = setTimeout(function () {
      if (online && online.session) online.session.stepAutomation();
    }, 550);
  }

  /* ============ 対戦 ============ */
  var game = null;
  var lastConfig = null;
  var ui = null; // { selectedPiece, variantIndex, tentative, movesCache, targetMode, cardIndex, warpCtx, warpVariant }
  var cpuTimer = null;

  function resetUi() {
    ui = {
      selectedPiece: null, variantIndex: 0, tentative: null,
      activeAnchor: null, candIdx: 0,
      movesCache: null, movesKey: '',
      targetMode: null, cardIndex: null,
      warpCtx: null, warpVariant: 0
    };
  }

  /* 選択中ピース・仮置きまわりの選択状態をまとめて解除する */
  function clearPieceSelection() {
    ui.selectedPiece = null; ui.tentative = null; ui.variantIndex = 0;
    ui.activeAnchor = null; ui.candIdx = 0;
  }

  function startGame(players) {
    lastConfig = { mode: setup.mode, players: players };
    game = State.createGame({ mode: setup.mode, players: players });
    resetUi();
    applyTheme();
    showScreen('screen-game');
    buildBoard();
    renderAll();
  }

  function currentPlayer() {
    var info = State.getTurnInfo(game);
    return info ? State.playerById(game, info.controllerId) : null;
  }
  function isHumanTurn() {
    if (!game || game.phase === 'finished') return false;
    if (online) {
      var info = State.getTurnInfo(game);
      return !!info && info.controllerId === online.myPlayerId;
    }
    var p = currentPlayer();
    return p && p.type === 'human';
  }

  /* 盤面DOMを一度だけ作る */
  var boardCells = [];
  function buildBoard() {
    var board = $('board');
    board.innerHTML = '';
    boardCells = [];
    for (var y = 0; y < 20; y++) {
      for (var x = 0; x < 20; x++) {
        var c = el('div', 'cell');
        c.dataset.x = x; c.dataset.y = y;
        board.appendChild(c);
        boardCells.push(c);
      }
    }
  }

  function legalMovesCached() {
    var key = JSON.stringify(game.board) + '|' + game.turn.color + '|' +
      game.turn.step + '|' + (game.turn.forcedPieceId || '') + '|' +
      game.turn.forcedSmallest + '|' + game.turn.allowEdge + '|' +
      (game.turn.twinFirstCells ? 'T' : '') + '|' + game.phase + '|' +
      State.usablePieces(game, game.turn.color).join(',');
    if (ui.movesKey !== key) {
      ui.movesKey = key;
      ui.movesCache = State.legalMovesForTurn(game);
    }
    return ui.movesCache;
  }

  function studentEmoji(player) {
    var stu = State.studentById(player.characterId);
    if (!stu) return '🧑';
    return game.mode === 'wizard' ? stu.wizardEmoji : stu.emoji;
  }
  function partnerEmoji(player) {
    var pt = State.partnerById(player.partnerId);
    return pt ? pt.emoji : '';
  }
  function playerLabel(player) {
    return studentEmoji(player) + partnerEmoji(player) + ' ' + player.name;
  }

  function renderAll() {
    if (!game) return;
    renderBanner();
    renderStrip();
    renderBoard();
    renderCards();
    renderTargetArea();
    renderHand();
    renderLog();
    $('btn-pass').disabled = !(isHumanTurn() && game.phase !== 'opening' &&
      game.turn.step === 'place' && !ui.targetMode);
    if (game.phase === 'finished') {
      renderResult();
      showScreen('screen-result');
      return;
    }
    if (online) {
      if (online.role === 'host') scheduleHostPump();
    } else {
      scheduleCpu();
    }
  }

  function renderBanner() {
    var info = State.getTurnInfo(game);
    var player = currentPlayer();
    var text, sub = '';
    if (game.phase === 'finished') {
      text = '🏁 ゲーム終了！';
    } else if (game.phase === 'opening') {
      text = '🎲 最初のピースを置こう：' + COLOR_NAMES[info.color] + '（' + playerLabel(player) + '）';
      sub = 'ボードの四隅のどれか1マスを覆うように置いてね';
    } else {
      text = '🎯 ' + COLOR_NAMES[info.color] + 'の番：' + playerLabel(player);
      if (info.isFree) text += '（フリーピースを操作）';
      if (player.type === 'cpu') sub = 'CPUが考え中…';
      else if (info.step === 'card') sub = '手札からカードを1枚出してね';
      else if (info.cardSealed) sub = 'すやすやパウダーでカードは使えない。ピースを置いてね';
      else if (info.forcedPieceId) sub = 'チョイススペルで指定されたピースを置いてね';
      else if (info.forcedSmallest) sub = 'ミニマイズ！一番小さいピースを置いてね';
      else if (info.cardPlayedType === 'twin' && game.turn.placementsLeft === 2) sub = 'ツインキャスト！ピースを2個置けるよ';
      else if (info.cardPlayedType === 'twin') sub = 'ツインキャスト：あと1個、1個目と角がつながる場所に置いてね';
      else if (info.allowEdge) sub = 'ぴたっとボンド：辺でくっつけてもOK！';
      else sub = 'ピースを置いてね（置けなければパス）';
    }
    if (online && game.phase !== 'finished' && player &&
        info.controllerId !== online.myPlayerId && player.type === 'human') {
      sub = 'あいての手番だよ。結果が届くのを待っててね…';
    }
    $('turn-banner').innerHTML = '';
    $('turn-banner').appendChild(document.createTextNode(text));
    if (sub) $('turn-banner').appendChild(el('span', 'sub', sub));
  }

  function renderStrip() {
    var strip = $('players-strip');
    strip.innerHTML = '';
    var info = State.getTurnInfo(game);
    Logic.TURN_ORDER.forEach(function (color) {
      var ownerId = game.colorOwner[color];
      var owner = ownerId ? State.playerById(game, ownerId) : null;
      var chip = el('div', 'p-chip' + (info && info.color === color && game.phase !== 'finished' ? ' turn' : ''));
      var dot = el('span', 'dot dot-' + color);
      chip.appendChild(dot);
      chip.appendChild(el('span', 'pname', owner ? playerLabel(owner) : '🎲 フリー'));
      chip.appendChild(document.createElement('br'));
      var rest = Logic.remainingSquares(game.hands[color]);
      chip.appendChild(document.createTextNode('残り ' + rest + 'マス'));
      if (game.passed[color]) chip.appendChild(document.createTextNode('（脱落）'));
      if (game.freeColor === color && owner === null) chip.appendChild(document.createTextNode(''));
      strip.appendChild(chip);
    });
  }

  /* ハイライト対象マップ（アンカーキー -> その角を覆う候補の配列）を作る。
   * 黄色表示は「四隅（初手）」と「自分の色に角で接するマス」のうち、
   * 選択中ピースを実際に置ける配置が覆うマスだけに絞る。 */
  function currentAnchors() {
    if (!ui.selectedPiece) return {};
    return PlaceUi.buildAnchorMap(legalMovesCached(), game.board, game.turn.color, {
      pieceId: ui.selectedPiece,
      opening: game.phase === 'opening',
      allowEdge: game.turn.allowEdge
    });
  }
  function warpDestMoves() {
    if (!ui.warpCtx) return [];
    var ctx = ui.warpCtx;
    var board = Logic.cloneBoard(game.board);
    game.placedPieces[ctx.color][ctx.pieceIndex].cells.forEach(function (c) { board[c[1]][c[0]] = null; });
    return Logic.legalMoves(board, ctx.color, [ctx.pieceId], {
      firstMove: !Logic.colorOnBoard(board, ctx.color)
    });
  }

  function renderBoard() {
    var info = State.getTurnInfo(game);
    var hl = {};
    var tentCells = {};
    if (isHumanTurn() && !ui.targetMode && game.turn.step === 'place') {
      hl = currentAnchors();
    }
    if (ui.tentative) {
      ui.tentative.cells.forEach(function (c) { tentCells[c[0] + ',' + c[1]] = true; });
    }
    // ワープ移動先ハイライト
    var warpHl = {};
    if (ui.targetMode === 'warpDest') {
      warpDestMoves().forEach(function (m) {
        if (m.variantIndex === ui.warpVariant) warpHl[m.origin[0] + ',' + m.origin[1]] = m;
      });
    }
    for (var y = 0; y < 20; y++) {
      for (var x = 0; x < 20; x++) {
        var cell = boardCells[y * 20 + x];
        var v = game.board[y][x];
        var cls = 'cell';
        if (v) cls += ' c-' + v;
        if (tentCells[x + ',' + y]) cls += ' tent c-' + info.color;
        if (hl[x + ',' + y] || warpHl[x + ',' + y]) cls += ' hl';
        if (ui.targetMode === 'recall' && v === info.color) cls += ' targetable';
        if (ui.targetMode === 'warpPiece' && v && v !== info.color) cls += ' targetable';
        cell.className = cls;
      }
    }
  }

  function miniPiece(pieceId, color, variantIndex) {
    var piece = Pieces.getPiece(pieceId);
    var variants = piece.variants[variantIndex || 0] || piece.variants[0];
    var maxX = Math.max.apply(null, variants.map(function (c) { return c[0]; }));
    var maxY = Math.max.apply(null, variants.map(function (c) { return c[1]; }));
    var grid = el('div', 'mini');
    grid.style.gridTemplateColumns = 'repeat(' + (maxX + 1) + ', 9px)';
    var filled = {};
    variants.forEach(function (c) { filled[c[0] + ',' + c[1]] = true; });
    for (var y = 0; y <= maxY; y++) {
      for (var x = 0; x <= maxX; x++) {
        var i = el('i', filled[x + ',' + y] ? 'f c-' + color : '');
        grid.appendChild(i);
      }
    }
    return grid;
  }

  function renderHand() {
    var info = State.getTurnInfo(game);
    var wrap = $('hand-pieces');
    wrap.innerHTML = '';
    if (game.phase === 'finished') { $('hand-title').textContent = ''; $('piece-controls').hidden = true; return; }
    var color = info.color;
    var usable = State.usablePieces(game, color);
    var locked = game.locked[color] || [];
    $('hand-title').textContent = '手持ちピース（' + COLOR_NAMES[color] + '）残り ' +
      Logic.remainingSquares(game.hands[color]) + 'マス';
    var humanPlace = isHumanTurn() && game.turn.step === 'place' && !ui.targetMode;
    /*
     * 置けないピースのグレーアウト判定について（安全側の扱い）：
     * 配置ステップ（step === 'place'）では、その手番に効く効果（カード封じ・
     * 強制指定・ぴたっとボンド・ツイン2個目など）はすべて state.turn に反映
     * 済みなので、legalMovesForTurn の合法手をピース単位に集計すれば正確に
     * 「絶対に置けないピース」を判定できる。
     * 一方カードステップ（step === 'card'）では、ぴたっとボンドやツインで
     * 置けるようになる可能性や、リコールで手持ち自体が変わる可能性があるため、
     * 通常ルール基準でグレーアウトすると誤表示になる。よってカードステップ中は
     * グレーアウトしない。
     */
    var placeable = (isHumanTurn() && game.turn.step === 'place' && !ui.targetMode)
      ? PlaceUi.placeablePieceIds(legalMovesCached())
      : null;
    // 大きい順に表示
    var sorted = usable.slice().sort(function (a, b) {
      return Pieces.getPiece(b).size - Pieces.getPiece(a).size;
    });
    sorted.forEach(function (pid) {
      var canPlace = !placeable || !!placeable[pid];
      var btn = el('button', 'piece-btn' + (ui.selectedPiece === pid ? ' selected' : '') +
        (canPlace ? '' : ' unplaceable'));
      // 選択中ピースのプレビューは現在の向き（回転・反転）を反映する
      btn.appendChild(miniPiece(pid, color, ui.selectedPiece === pid ? ui.variantIndex : 0));
      btn.appendChild(el('span', 'psize', canPlace ? Pieces.getPiece(pid).size + 'マス' : '置けない'));
      if (humanPlace && canPlace) {
        btn.addEventListener('click', function () {
          ui.selectedPiece = pid;
          ui.variantIndex = 0;
          ui.tentative = null;
          ui.activeAnchor = null;
          ui.candIdx = 0;
          renderAll();
        });
      } else {
        btn.disabled = true;
      }
      wrap.appendChild(btn);
    });
    locked.forEach(function (pid) {
      var btn = el('button', 'piece-btn locked');
      btn.appendChild(miniPiece(pid, color));
      btn.appendChild(el('span', 'psize', '🔒使用不可'));
      wrap.appendChild(btn);
    });
    $('piece-controls').hidden = !(humanPlace && ui.selectedPiece);
    $('btn-confirm').disabled = !ui.tentative;
  }

  function renderCards() {
    var area = $('cards-area');
    area.innerHTML = '';
    if (game.mode !== 'wizard' || game.phase !== 'playing') return;
    var info = State.getTurnInfo(game);
    var player = currentPlayer();
    if (info.isFree) {
      area.appendChild(el('div', null, ''));
      area.firstChild.id = 'cards-note';
      area.firstChild.textContent = 'フリーピースの手番はカードなし（伏せて1枚捨てたよ）';
      return;
    }
    var deck = game.decks[info.controllerId];
    if (info.step === 'card' && player.type === 'human' &&
        (!online || info.controllerId === online.myPlayerId)) {
      deck.hand.forEach(function (type, idx) {
        var def = State.CARD_DEFS[type];
        var card = el('button', 'magic-card');
        card.appendChild(el('span', 'cname', '🪄 ' + def.name));
        card.appendChild(el('span', 'cdesc', def.desc));
        card.addEventListener('click', function () { onCardClick(idx, type); });
        area.appendChild(card);
      });
    } else {
      for (var i = 0; i < deck.hand.length; i++) {
        area.appendChild(el('div', 'magic-card-back', '🂠 カード'));
      }
      if (deck.hand.length === 0) {
        area.appendChild(el('div', null, ''));
        area.lastChild.id = 'cards-note';
        area.lastChild.textContent = 'カードはもうないよ（山札 ' + deck.draw.length + '枚）';
      }
    }
  }

  function renderTargetArea() {
    var area = $('target-area');
    area.innerHTML = '';
    if (!ui.targetMode) { area.hidden = true; return; }
    area.hidden = false;
    var info = State.getTurnInfo(game);
    if (ui.targetMode === 'pieceTarget') {
      var type = game.decks[info.controllerId] ? ui.pendingCardType : null;
      area.appendChild(el('div', 't-title',
        (type === 'choice' ? 'チョイススペル：次のプレイヤーが置くピースを指定してね' :
         'ピースロック：次のプレイヤーの使えなくなるピースを選んでね')));
      var nc = State.nextColor(info.color);
      var list = el('div', null);
      list.style.display = 'flex'; list.style.flexWrap = 'wrap'; list.style.gap = '8px';
      State.usablePieces(game, nc).forEach(function (pid) {
        var btn = el('button', 'piece-btn');
        btn.appendChild(miniPiece(pid, nc));
        btn.appendChild(el('span', 'psize', Pieces.getPiece(pid).size + 'マス'));
        btn.addEventListener('click', function () {
          doPlayCard(ui.cardIndex, { pieceId: pid });
        });
        list.appendChild(btn);
      });
      area.appendChild(list);
    } else if (ui.targetMode === 'recall') {
      area.appendChild(el('div', 't-title', 'リコール：盤の自分のピースをタップしてね'));
    } else if (ui.targetMode === 'warpPiece') {
      area.appendChild(el('div', 't-title', 'ワープゲート：動かしたい相手のピースをタップしてね'));
    } else if (ui.targetMode === 'warpDest') {
      area.appendChild(el('div', 't-title', 'ワープゲート：移動先を選んでね（形は回転・反転ボタンで変更）'));
      var row = el('div', null);
      var rot = el('button', null, '↻ 形を変える');
      rot.addEventListener('click', function () {
        var vars = {};
        warpDestMoves().forEach(function (m) { vars[m.variantIndex] = true; });
        var list = Object.keys(vars).map(Number).sort(function (a, b) { return a - b; });
        var pos = list.indexOf(ui.warpVariant);
        ui.warpVariant = list[(pos + 1) % list.length];
        ui.tentative = null;
        renderAll();
      });
      row.appendChild(rot);
      if (ui.tentative) {
        var ok = el('button', 'primary', '✔ この場所に移動');
        ok.addEventListener('click', function () {
          doPlayCard(ui.cardIndex, {
            color: ui.warpCtx.color, pieceIndex: ui.warpCtx.pieceIndex,
            variantIndex: ui.tentative.variantIndex, origin: ui.tentative.origin
          });
        });
        row.appendChild(ok);
      }
      area.appendChild(row);
    }
    var cancel = el('button', null, '効果なしで出す');
    cancel.addEventListener('click', function () { doPlayCard(ui.cardIndex, null); });
    area.appendChild(cancel);
    var back = el('button', null, 'キャンセル');
    back.addEventListener('click', function () {
      ui.targetMode = null; ui.cardIndex = null; renderAll();
    });
    area.appendChild(back);
  }

  function onCardClick(idx, type) {
    ui.cardIndex = idx;
    ui.pendingCardType = type;
    if (type === 'choice' || type === 'lock') {
      ui.targetMode = 'pieceTarget';
      renderAll();
    } else if (type === 'recall') {
      if (game.placedPieces[game.turn.color].length === 0) { doPlayCard(idx, null); return; }
      ui.targetMode = 'recall';
      renderAll();
    } else if (type === 'warp') {
      ui.targetMode = 'warpPiece';
      renderAll();
    } else {
      doPlayCard(idx, null);
    }
  }

  function doPlayCard(idx, target) {
    if (online) {
      submitOnlineMove({ type: 'playCard', cardIndex: idx, target: target });
      return;
    }
    var r = State.applyMove(game, { type: 'playCard', cardIndex: idx, target: target });
    if (!r.ok) { showMsg(r.reason); return; }
    game = r.state;
    clearPieceSelection();
    ui.targetMode = null; ui.cardIndex = null; ui.warpCtx = null;
    showMsg('');
    renderAll();
  }

  function showMsg(reason) {
    $('msg').textContent = reason ? (REASON_MSGS[reason] || ('その手は置けないよ（' + reason + '）')) : '';
  }

  /* 盤面タップ */
  function onBoardClick(ev) {
    var cell = ev.target.closest('.cell');
    if (!cell || !isHumanTurn()) return;
    var x = Number(cell.dataset.x), y = Number(cell.dataset.y);
    var info = State.getTurnInfo(game);

    if (ui.targetMode === 'recall') {
      var idx = State.placedPieceAt(game, info.color, x, y);
      if (idx >= 0) doPlayCard(ui.cardIndex, { pieceIndex: idx });
      return;
    }
    if (ui.targetMode === 'warpPiece') {
      var v = game.board[y][x];
      if (v && v !== info.color) {
        var pidx = State.placedPieceAt(game, v, x, y);
        if (pidx >= 0) {
          ui.warpCtx = { color: v, pieceIndex: pidx, pieceId: game.placedPieces[v][pidx].pieceId };
          var vars = {};
          warpDestMoves().forEach(function (m) { vars[m.variantIndex] = true; });
          var list = Object.keys(vars).map(Number);
          ui.warpVariant = list.length ? list[0] : 0;
          ui.targetMode = 'warpDest';
          ui.tentative = null;
          renderAll();
        }
      }
      return;
    }
    if (ui.targetMode === 'warpDest') {
      var found = null;
      warpDestMoves().forEach(function (m) {
        if (m.variantIndex === ui.warpVariant && m.origin[0] === x && m.origin[1] === y) found = m;
      });
      if (found) {
        ui.tentative = found;
        renderAll();
      }
      return;
    }
    if (ui.targetMode) return;
    if (game.turn.step !== 'place' || !ui.selectedPiece) return;
    // アンカー（黄色マス）のタップで候補を仮置きし、同じ配置になる2回目の
    // タップで確定する（ダブルタップ確定）。解決ロジックは PlaceUi.pickTap。
    var pick = PlaceUi.pickTap({
      anchors: currentAnchors(),
      activeAnchor: ui.activeAnchor,
      candIdx: ui.candIdx,
      tentative: ui.tentative,
      preferredVariantIndex: ui.variantIndex,
      x: x, y: y
    });
    if (!pick) return;
    ui.tentative = pick.move;
    ui.variantIndex = pick.move.variantIndex;
    if (pick.action === 'confirm') {
      doConfirm();
      return;
    }
    ui.activeAnchor = pick.anchor;
    ui.candIdx = pick.candIdx;
    showMsg('');
    renderAll();
  }

  function doConfirm() {
    if (!ui.tentative) return;
    var m = ui.tentative;
    if (online) {
      submitOnlineMove({ type: 'place', pieceId: m.pieceId, variantIndex: m.variantIndex, origin: m.origin });
      return;
    }
    var r = State.applyMove(game, {
      type: 'place', pieceId: m.pieceId, variantIndex: m.variantIndex, origin: m.origin
    });
    if (!r.ok) { showMsg(r.reason); return; }
    game = r.state;
    clearPieceSelection();
    showMsg('');
    renderAll();
  }

  function rotateSelected(dir) {
    if (!ui.selectedPiece) return;
    // 仮置き中は、同じアンカー（角）を覆う候補を切り替える
    // （回転＝次の候補／反転＝前の候補）。手持ちプレビューの向きも連動する。
    if (ui.tentative && ui.activeAnchor) {
      var cands = currentAnchors()[ui.activeAnchor];
      if (cands && cands.length > 1) {
        var idx = ui.candIdx + (dir === 'rot' ? 1 : -1);
        idx = ((idx % cands.length) + cands.length) % cands.length;
        ui.candIdx = idx;
        ui.tentative = cands[idx];
        ui.variantIndex = cands[idx].variantIndex;
        showMsg('');
        renderAll();
        return;
      }
    }
    var piece = Pieces.getPiece(ui.selectedPiece);
    var n = piece.variants.length;
    if (dir === 'rot') {
      ui.variantIndex = (ui.variantIndex + 1) % n;
    } else {
      // 反転：現在の形を左右反転したバリエーションへ
      var cur = piece.variants[ui.variantIndex];
      var flippedKey = Pieces.cellsKey(Pieces.flipX(cur));
      for (var i = 0; i < n; i++) {
        if (Pieces.cellsKey(piece.variants[i]) === flippedKey) { ui.variantIndex = i; break; }
      }
    }
    // 向きを変えたら仮置きは解除する（新しい向きは手持ちプレビューに反映され、
    // 次にアンカーをタップしたとき、その向きの候補が優先表示される）
    ui.tentative = null;
    ui.activeAnchor = null;
    ui.candIdx = 0;
    renderAll();
  }

  /* CPUの手番を自動進行 */
  function scheduleCpu() {
    if (cpuTimer) { clearTimeout(cpuTimer); cpuTimer = null; }
    if (!game || game.phase === 'finished') return;
    var player = currentPlayer();
    if (!player || player.type !== 'cpu') return;
    cpuTimer = setTimeout(function () {
      var mv = Cpu.chooseMove(game, player.cpuLevel);
      if (!mv) return;
      var r = State.applyMove(game, mv);
      if (!r.ok) {
        // 万一失敗したらカードは対象なしで出し直し、それもダメならパスを試みる
        if (mv.type === 'playCard') {
          r = State.applyMove(game, { type: 'playCard', cardIndex: mv.cardIndex, target: null });
        }
        if (!r.ok) r = State.applyMove(game, { type: 'pass' });
        if (!r.ok) return;
      }
      game = r.state;
      clearPieceSelection();
      ui.targetMode = null;
      renderAll();
    }, 550);
  }

  function renderLog() {
    var log = $('log');
    log.innerHTML = '';
    game.log.slice(-30).forEach(function (line) {
      log.appendChild(el('div', null, line));
    });
    log.scrollTop = log.scrollHeight;
  }

  /* ============ 結果 ============ */
  function renderResult() {
    $('btn-rematch').style.display = online ? 'none' : '';
    var res = game.results;
    var winnerNames = res.winners.map(function (id) {
      return playerLabel(State.playerById(game, id));
    }).join(' ＆ ');
    $('winner-banner').textContent = '🏆 勝者：' + winnerNames;
    var wrap = $('result-table');
    wrap.innerHTML = '';
    var table = el('table', null);
    var head = el('tr', null);
    ['プレイヤー', '色', '残りマス', '得点'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    table.appendChild(head);
    game.players.forEach(function (p) {
      var isWin = res.winners.indexOf(p.id) >= 0;
      p.colors.forEach(function (color, ci) {
        var tr = el('tr', isWin ? 'win' : '');
        if (ci === 0) {
          var tdName = el('td', null, playerLabel(p));
          tdName.rowSpan = p.colors.length;
          tr.appendChild(tdName);
        }
        var info = res.perColor[color];
        tr.appendChild(el('td', null, COLOR_NAMES[color]));
        tr.appendChild(el('td', null, String(info.remainingSquares)));
        var scoreText;
        if (game.mode === 'normal') {
          var s = Logic.advanceScore(info);
          scoreText = (s > 0 ? '+' : '') + s +
            (info.piecesRemaining === 0 ? (info.lastPlacedSize === 1 ? '（全配置＋最小ボーナス！）' : '（全配置ボーナス！）') : '');
        } else {
          scoreText = ci === 0 && p.colors.length > 1
            ? '多い方の色で ' + res.scores[p.id]
            : String(res.scores[p.id]);
          if (ci > 0) scoreText = '';
        }
        if (ci === 0) {
          var tdScore = el('td', null, game.mode === 'normal' ? String(res.scores[p.id]) + '点' : scoreText);
          tdScore.rowSpan = p.colors.length;
          if (game.mode === 'normal') tdScore.textContent = res.scores[p.id] + '点' + (p.colors.length > 1 ? '（2色合計）' : '');
          tr.appendChild(tdScore);
        }
        table.appendChild(tr);
      });
    });
    wrap.appendChild(table);
    var note = el('p', 'note', game.mode === 'normal'
      ? '得点：残りマス×−1点／全部置ききると+15点／最後が1マスピースなら+20点'
      : '得点：残りマスが一番少ない人の勝ち（2人戦は担当2色のうち多い方の色で判定）');
    wrap.appendChild(note);
  }

  /* ============ イベント配線 ============ */
  function init() {
    segWire('seg-count', 'count', Number);
    segWire('seg-mode', 'mode', String);
    segWire('seg-level', 'cpuLevel', Number);
    renderSeats();
    $('btn-show-setup').addEventListener('click', function () { applyTheme(); showScreen('screen-setup'); });
    $('btn-setup-back').addEventListener('click', function () { showScreen('screen-home'); });
    $('btn-to-select').addEventListener('click', startSelect);
    $('btn-select-back').addEventListener('click', function () {
      if (online) { osel = null; showScreen('screen-lobby'); renderLobby(); return; }
      showScreen('screen-setup');
    });
    $('board').addEventListener('click', onBoardClick);
    $('btn-confirm').addEventListener('click', doConfirm);
    $('btn-cancel').addEventListener('click', function () {
      clearPieceSelection();
      renderAll();
    });
    $('btn-rotate').addEventListener('click', function () {
      if (ui.targetMode === 'warpDest') return; // ワープ用は対象エリアのボタンを使う
      rotateSelected('rot');
    });
    $('btn-flip').addEventListener('click', function () { rotateSelected('flip'); });
    $('btn-pass').addEventListener('click', function () {
      if (online) { submitOnlineMove({ type: 'pass' }); return; }
      var r = State.applyMove(game, { type: 'pass' });
      if (!r.ok) { showMsg(r.reason); return; }
      game = r.state;
      clearPieceSelection();
      showMsg('');
      renderAll();
    });
    $('btn-quit').addEventListener('click', function () {
      if (cpuTimer) clearTimeout(cpuTimer);
      if (online) leaveOnline(true);
      game = null;
      document.body.className = 'theme-normal';
      showScreen('screen-home');
    });
    $('btn-rematch').addEventListener('click', function () {
      setup.mode = lastConfig.mode;
      game = State.createGame({ mode: lastConfig.mode, players: lastConfig.players });
      resetUi();
      applyTheme();
      showScreen('screen-game');
      buildBoard();
      renderAll();
    });
    $('btn-home').addEventListener('click', function () {
      if (online) leaveOnline(true);
      game = null;
      document.body.className = 'theme-normal';
      showScreen('screen-home');
    });

    /* オンライン配線 */
    $('btn-show-online').addEventListener('click', function () {
      setOnlineStatus('');
      showScreen('screen-online');
    });
    $('btn-online-back').addEventListener('click', function () { showScreen('screen-home'); });
    $('btn-create-room').addEventListener('click', startHostRoom);
    $('btn-join-room').addEventListener('click', startGuestRoom);
    $('btn-lobby-leave').addEventListener('click', function () {
      leaveOnline(true);
      game = null;
      document.body.className = 'theme-normal';
      showScreen('screen-home');
    });
    $('btn-lobby-select').addEventListener('click', startOnlineSelect);
    $('seg-cpu-level').addEventListener('click', function (ev) {
      var btn = ev.target.closest('button');
      if (!btn) return;
      Array.prototype.forEach.call($('seg-cpu-level').children, function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      if (online) online.cpuLevel = Number(btn.dataset.v);
    });
    $('seg-online-mode').addEventListener('click', function (ev) {
      var btn = ev.target.closest('button');
      if (!btn) return;
      Array.prototype.forEach.call($('seg-online-mode').children, function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      if (online) online.mode = btn.dataset.v;
    });
    $('btn-add-cpu').addEventListener('click', function () {
      if (!online || online.role !== 'host') return;
      var r = online.session.addCpu(online.cpuLevel);
      if (!r.ok) setLobbyMsg(REASON_MSGS[r.reason] || r.reason);
    });
    $('btn-begin-select').addEventListener('click', function () {
      if (!online || online.role !== 'host') return;
      var r = online.session.beginSelect();
      if (!r.ok) setLobbyMsg(r.reason === 'too-few-players' ? '2人以上集まってから始めてね' : r.reason);
    });
    $('btn-start-game').addEventListener('click', function () {
      if (!online || online.role !== 'host') return;
      var r = online.session.startGame(online.mode);
      if (!r.ok) setLobbyMsg(REASON_MSGS[r.reason] || r.reason);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
