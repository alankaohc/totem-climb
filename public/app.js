(() => {
  'use strict';

  const TIKIS = {
    purple: { name: '紫', group: 'star' },
    green: { name: '綠', group: 'star' },
    orange: { name: '橙', group: 'star' },
    grey: { name: '灰', group: 'bone' },
    pink: { name: '粉', group: 'bone' },
    brown: { name: '棕', group: 'bone' },
    blue: { name: '藍', group: 'shell' },
    yellow: { name: '黃', group: 'shell' },
    red: { name: '紅', group: 'shell' },
  };
  const HOME_ORDER = ['purple', 'grey', 'blue', 'green', 'pink', 'yellow', 'orange', 'brown', 'red'];
  const GLYPH = { star: 'g-star', bone: 'g-bone', shell: 'g-shell' };
  const CARD = {
    up1: { name: '上升 1', desc: '任選一尊往上 1 格' },
    up2: { name: '上升 2', desc: '任選一尊往上 2 格' },
    up3: { name: '上升 3', desc: '任選一尊往上 3 格' },
    topple: { name: '推到底', desc: '任選一尊移到最底部' },
    toast: { name: '燒毀', desc: '移除最底部那尊' },
    swap: { name: '交換', desc: '任選兩尊交換位置' },
    down2: { name: '下降 2', desc: '任選一尊往下 2 格' },
  };
  const SLOT_PTS = [9, 5, 2];
  const SLOT_NEED = ['第 1 名', '前 2 名', '前 3 名'];

  const $app = document.getElementById('app');
  const $overlay = document.getElementById('overlay');
  const $toast = document.getElementById('toast');
  const $conn = document.getElementById('conn');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const ls = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        if (v === null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      } catch {
        /* 無痕模式等情況存不了，不影響遊戲 */
      }
    },
  };

  function loadSession() {
    try {
      const s = JSON.parse(ls.get('totem.session') || 'null');
      return s && s.roomId && s.playerId && s.token ? s : null;
    } catch {
      return null;
    }
  }

  const store = {
    name: ls.get('totem.name') || '',
    session: loadSession(),
    room: null,
    sel: null, // { uid, picks: [] }
    overlay: null,
    connected: false,
    everConnected: false,
    screen: null,
    pending: false,
  };

  const params = new URLSearchParams(location.search);
  const prefillCode = (params.get('room') || '').toUpperCase().slice(0, 4);

  const socket = io({ transports: ['websocket', 'polling'] });

  // ---------- 小工具 ----------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  let toastTimer = null;
  function toast(msg) {
    $toast.textContent = msg;
    $toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($toast.hidden = true), 3200);
  }

  async function emit(event, payload) {
    try {
      return await socket.timeout(8000).emitWithAck(event, payload || {});
    } catch {
      return { ok: false, message: '伺服器沒有回應，請再試一次' };
    }
  }

  function saveSession(s) {
    store.session = s;
    ls.set('totem.session', s ? JSON.stringify(s) : null);
    history.replaceState(null, '', s ? `/?room=${s.roomId}` : '/');
  }

  function tiki(id, o = {}) {
    const t = TIKIS[id];
    const tag = o.button ? 'button' : 'div';
    const cls = ['tiki', `t-${id}`, o.mini ? 'mini' : '', o.cls || ''].join(' ');
    const label = o.noName ? '' : `<span>${t.name}</span>`;
    const aria = o.noName ? ` aria-label="${t.name}"` : '';
    return `<${tag} class="${cls}" data-id="${id}"${aria} ${o.attrs || ''}><span class="glyph"><svg aria-hidden="true"><use href="#${GLYPH[t.group]}"/></svg></span>${label}</${tag}>`;
  }

  const room = () => store.room;
  const g = () => (store.room ? store.room.game : null);
  const me = () => (store.room ? store.room.you : null);
  const isHost = () => store.room && store.room.hostId === store.room.you;
  const myTurn = () => g() && g().phase === 'playing' && g().turn === me();
  const seatName = (id) => {
    const s = g() && g().seats.find((x) => x.id === id);
    return s ? s.name : '';
  };
  const hostAway = () => {
    const r = room();
    const h = r && r.players.find((p) => p.id === r.hostId);
    return !h || !h.connected;
  };

  // ---------- 連線 ----------

  function renderConn() {
    if (store.connected) {
      $conn.hidden = true;
      return;
    }
    $conn.hidden = false;
    $conn.textContent = store.everConnected
      ? '連線中斷，正在重新連線…'
      : '正在連線伺服器…閒置一段時間後第一次開啟，可能要等將近一分鐘。';
  }

  socket.on('connect', async () => {
    store.connected = true;
    store.everConnected = true;
    renderConn();
    if (store.session) {
      const res = await emit('room:resync', store.session);
      if (!res.ok) {
        saveSession(null);
        store.room = null;
        toast(res.message);
        render();
      }
    } else if (!store.screen) {
      render();
    }
  });

  socket.on('disconnect', () => {
    store.connected = false;
    renderConn();
  });

  socket.on('room:state', (r) => {
    store.room = r;
    const game = r.game;
    if (store.sel) {
      const still = game && myTurn() && game.myHand.some((c) => c.uid === store.sel.uid);
      if (!still) store.sel = null;
    }
    render();
  });

  socket.on('session:replaced', () => {
    store.room = null;
    store.screen = null;
    render();
    toast('你在另一個分頁或裝置開啟了這個房間，這裡已中斷');
  });

  socket.on('room:removed', () => {
    saveSession(null);
    store.room = null;
    render();
    toast('你被房主移出房間了');
  });

  // ---------- 畫面 ----------

  function render() {
    if (!store.room) renderHome();
    else if (!store.room.game) renderLobby();
    else renderGame();
    renderOverlay();
    const mine = myTurn();
    document.title = mine ? '● 輪到你｜圖騰登頂' : '圖騰登頂';
  }

  function renderHome() {
    if (store.screen === 'home') return; // 保留輸入框內容
    store.screen = 'home';
    store.sel = null;
    $app.innerHTML = `
      <section class="home">
        <div class="home-totem" aria-hidden="true">${HOME_ORDER.map((id) => tiki(id, { noName: true })).join('')}</div>
        <div>
          <h1>圖騰登頂</h1>
          <p class="lede">九尊圖騰搶第一。你暗中支持哪三尊？</p>
        </div>
        <div class="home-form">
          <label for="nm">你的暱稱</label>
          <input id="nm" class="field" maxlength="12" autocomplete="nickname" value="${esc(store.name)}" />
          <button class="btn" type="button" data-action="create">建立房間</button>
          <label for="code">或輸入房間代碼加入</label>
          <div class="join-row">
            <input id="code" class="field" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(prefillCode)}" />
            <button class="btn quiet" type="button" data-action="join">加入</button>
          </div>
        </div>
        <div class="home-foot">
          <button class="linklike" type="button" data-action="rules">怎麼玩</button>
          <span class="muted">2 到 4 人，一場約 20 分鐘</span>
        </div>
      </section>`;
    const focusId = prefillCode && store.name ? 'code' : 'nm';
    const el = document.getElementById(focusId);
    if (el && matchMedia('(min-width: 700px)').matches) el.focus();
  }

  function renderLobby() {
    store.screen = 'lobby';
    const r = room();
    const host = isHost();
    const seats = [];
    for (let i = 0; i < 4; i++) {
      const p = r.players[i];
      if (!p) {
        seats.push(`<li class="seat empty">等待加入</li>`);
        continue;
      }
      const tags = [
        p.id === r.hostId ? '<span class="tag host">房主</span>' : '',
        p.isBot ? '<span class="tag">電腦</span>' : '',
        !p.connected ? '<span class="tag away">離線</span>' : '',
      ].join('');
      const remove = host && p.id !== r.you ? `<button class="btn quiet small" data-action="remove" data-id="${p.id}">移出</button>` : '';
      seats.push(
        `<li class="seat ${p.id === r.you ? 'you' : ''}"><span class="who">${esc(p.name)}${p.id === r.you ? '（你）' : ''}</span>${tags}${remove}</li>`
      );
    }
    const variant = host
      ? `<label class="toggle"><input type="checkbox" data-action="variant" ${r.options.variant ? 'checked' : ''} />
          <span><b>20 週年變體</b><br /><span class="muted">加入「交換」和「下降 2」，每人再隨機移除兩張牌，所以大家的手牌不一樣。</span></span></label>`
      : `<p class="muted">${r.options.variant ? '這場使用 20 週年變體規則。' : '這場使用基本規則。'}</p>`;
    $app.innerHTML = `
      <section class="lobby">
        <div class="code-box">
          <div><div class="muted">房間代碼</div><div class="code">${esc(r.id)}</div></div>
          <button class="btn quiet small" data-action="copy-link">複製邀請連結</button>
        </div>
        <ul class="seats">${seats.join('')}</ul>
        ${variant}
        <div class="lobby-actions">
          ${host ? `<button class="btn" data-action="start" ${r.players.length < 2 ? 'disabled' : ''}>開始遊戲</button>
                    <button class="btn quiet" data-action="add-bot" ${r.players.length >= 4 ? 'disabled' : ''}>加入電腦玩家</button>` : ''}
          <button class="btn quiet" data-action="leave">離開房間</button>
        </div>
        <p class="muted">${host ? '把代碼或邀請連結傳給朋友。人不夠的話，可以加入電腦玩家。' : '等房主開始遊戲。'}</p>
      </section>`;
  }

  function measurePole() {
    const map = new Map();
    $app.querySelectorAll('.pole .tiki').forEach((el) => map.set(el.dataset.id, el.getBoundingClientRect().top));
    return map;
  }

  function animatePole(before) {
    if (reduceMotion.matches || before.size === 0) return;
    $app.querySelectorAll('.pole .tiki').forEach((el) => {
      const old = before.get(el.dataset.id);
      if (old === undefined) return;
      const dy = old - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      el.getBoundingClientRect();
      el.style.transition = 'transform 420ms cubic-bezier(.2,.8,.2,1)';
      el.style.transform = '';
    });
  }

  function renderGame() {
    const before = store.screen === 'game' ? measurePole() : new Map();
    store.screen = 'game';
    const r = room();
    const game = g();
    const mine = myTurn();
    const selCard = store.sel ? game.myHand.find((c) => c.uid === store.sel.uid) : null;
    const picking = selCard && selCard.mode !== 'none';
    const legal = new Set(picking ? selCard.tikis : []);
    const picks = store.sel ? store.sel.picks : [];
    const target = game.myTarget || [];

    const roundLabel = game.tiebreak ? '加賽' : `第 ${game.round}／${game.totalRounds} 局`;
    const turnText = game.phase !== 'playing' ? '本局結束' : mine ? '輪到你了' : `輪到 ${esc(seatName(game.turn))}`;

    const players = game.seats
      .map((s) => {
        const remaining = s.handTypes ? s.handTypes.map((t) => `<span class="chip">${CARD[t].name}</span>`).join('') : '';
        const used = s.played.map((t) => `<span class="chip used">${CARD[t].name}</span>`).join('');
        const tags = `${s.isBot ? '<span class="tag">電腦</span>' : ''}${!s.connected ? '<span class="tag away">離線</span>' : ''}`;
        return `<div class="pcard ${game.turn === s.id ? 'turn' : ''} ${s.active ? '' : 'out'}">
          <div class="row"><span class="nm">${esc(s.name)}${s.id === r.you ? '（你）' : ''}</span><span class="sc">${s.score}</span></div>
          <div class="sub">${s.active ? `手牌 ${s.handCount} 張` : '本局觀戰'} ${tags}</div>
          ${s.active ? `<div class="chips">${remaining}${used}</div>` : ''}
        </div>`;
      })
      .join('');

    const poleItems = game.line
      .map((id, i) => {
        const slot = target.indexOf(id);
        const cls = [legal.has(id) ? 'legal' : '', picks.includes(id) ? 'picked' : '', slot !== -1 ? 'mine' : ''].join(' ');
        const attrs = [
          `data-action="pick-tiki"`,
          slot !== -1 ? `data-slot="${SLOT_PTS[slot]} 分"` : '',
          legal.has(id) ? '' : 'disabled',
        ].join(' ');
        return `<li><span class="rank">${i + 1}</span>${tiki(id, { button: true, cls, attrs })}</li>`;
      })
      .join('');
    const burned = game.removed.length
      ? `<div class="burned">已燒毀 ${game.removed.map((id) => tiki(id, { mini: true, cls: 'gone' })).join('')}</div>`
      : '';

    let targetHTML;
    if (target.length) {
      targetHTML = `<h3>你的目標</h3><div class="target-slots">${target
        .map((id, slot) => {
          const pos = game.line.indexOf(id);
          const ok = pos !== -1 && pos <= slot;
          const status = pos === -1 ? '已燒毀' : `現在第 ${pos + 1} 名`;
          return `<div class="target-slot"><span class="pts">${SLOT_PTS[slot]}</span>${tiki(id, { mini: true })}
            <span class="need ${ok ? 'ok' : ''}">要${SLOT_NEED[slot]}，${status}</span></div>`;
        })
        .join('')}</div>`;
    } else {
      targetHTML = `<h3>這局你觀戰</h3><p class="muted">加賽只有同分的玩家參加。</p>`;
    }

    let hint = '';
    let confirm = '';
    if (game.phase === 'playing') {
      if (!mine) hint = game.myHand.length ? `等 ${esc(seatName(game.turn))} 出牌…` : '你的牌打完了，等其他人出牌。';
      else if (!selCard) hint = '選一張牌。';
      else if (selCard.mode === 'none') {
        const bottom = game.line[game.line.length - 1];
        hint = `燒毀最底部的「${TIKIS[bottom].name}」？`;
        confirm = `<div class="confirm-row"><button class="btn on-sand" data-action="confirm">確定燒毀</button><button class="btn quiet" data-action="cancel">取消</button></div>`;
      } else {
        hint = selCard.mode === 'two' ? (picks.length ? '再選第二尊。' : '選第一尊要交換的圖騰。') : '點一尊亮起來的圖騰。';
        confirm = `<div class="confirm-row"><button class="btn quiet small" data-action="cancel">換一張牌</button></div>`;
      }
    }

    const handHTML = game.myHand
      .map((c) => {
        const playable = c.mode === 'none' ? c.playable : c.mode === 'two' ? c.tikis.length >= 2 : c.tikis.length > 0;
        const why = c.type === 'toast' && !c.playable ? '每局第一張不能出燒毀' : '';
        const disabled = !mine || !playable || store.pending;
        const desc = c.type === 'toast' && !c.playable ? '每局第一張不能出' : CARD[c.type].desc;
        return `<button class="acard ${store.sel && store.sel.uid === c.uid ? 'selected' : ''}" data-action="pick-card" data-uid="${c.uid}" ${disabled ? 'disabled' : ''} ${why ? `title="${why}"` : ''}>
          <span class="an">${CARD[c.type].name}</span><span class="ad">${desc}</span></button>`;
      })
      .join('');

    const log = game.log
      .slice()
      .reverse()
      .map((l) => `<li class="${l.kind === 'round' ? 'round' : ''}">${esc(l.text)}</li>`)
      .join('');

    $app.innerHTML = `
      <header class="topbar">
        <span class="brand">圖騰登頂</span>
        <span class="meta">房間 ${esc(r.id)}｜${roundLabel}</span>
        <span class="spacer"></span>
        <span class="turn-banner ${mine ? 'mine' : ''}">${turnText}</span>
        <button class="btn quiet small" data-action="rules">規則</button>
        <button class="btn quiet small" data-action="leave">離開</button>
      </header>
      <div class="board">
        <div class="col col-left">
          <section class="area-players" aria-label="玩家"><div class="players">${players}</div></section>
          <section class="area-log log"><h3>紀錄</h3><ol>${log}</ol></section>
        </div>
        <div class="col col-mid">
          <section class="area-pole" aria-label="圖騰排名"><div class="pole ${picking ? 'picking' : ''}"><ol>${poleItems}</ol>${burned}</div></section>
        </div>
        <div class="col col-right">
          <section class="area-target sheet target">${targetHTML}</section>
          <section class="area-hand sheet hand">
            <h3>你的手牌</h3>
            ${game.myHand.length ? `<div class="hand-cards">${handHTML}</div>` : '<p class="muted">沒有手牌了。</p>'}
            <div class="hand-foot"><p class="hint">${hint}</p>${confirm}</div>
          </section>
        </div>
      </div>`;
    animatePole(before);
  }

  function resultsHTML(game) {
    const lr = game.lastRound;
    if (!lr) return '';
    const finalLine = lr.line
      .slice(0, 3)
      .map((id, i) => `<span class="muted">${i + 1}</span>${tiki(id, { mini: true })}`)
      .join('');
    const rows = lr.results
      .map((res) => {
        const slots = res.parts
          .map((p, i) => `<span class="slot">${tiki(p.tiki, { mini: true, cls: p.points ? '' : 'gone' })}<b>${p.points ? `+${p.points}` : '0'}</b></span>`)
          .join('');
        const seat = game.seats.find((s) => s.id === res.id);
        return `<div class="result"><div class="row"><span class="nm">${esc(seat ? seat.name : '')}${res.id === me() ? '（你）' : ''}</span>
          <span class="pts">本局 +${res.points}，總分 ${seat ? seat.score : ''}</span></div><div class="slots">${slots}</div></div>`;
      })
      .join('');
    return `<p class="muted">最後的前三名</p><div class="final-line">${finalLine}</div><div class="results">${rows}</div>`;
  }

  function renderOverlay() {
    const game = g();
    let html = '';
    if (game && game.phase === 'roundEnd') {
      const canNext = isHost() || hostAway();
      const tb = game.tiebreakNext
        ? `<p><b>同分！</b>${game.tiebreakNext.map((id) => esc(seatName(id))).join('、')} 再加賽一局。</p>`
        : '';
      const title = game.lastRound && game.lastRound.tiebreak ? '加賽結束' : `第 ${game.round} 局結束`;
      html = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="rt"><h2 id="rt">${title}</h2>${resultsHTML(game)}${tb}
        <div class="sheet-actions">${
          canNext
            ? `<button class="btn on-sand" data-action="next">${game.tiebreakNext ? '開始加賽' : '開始下一局'}</button>`
            : '<p class="muted">等房主開始下一局。</p>'
        }</div></div>`;
    } else if (game && game.phase === 'gameOver') {
      const winners = (game.winners || []).map((id) => esc(seatName(id)));
      const headline = winners.length > 1 ? `${winners.join('、')} 並列第一！` : `${winners[0]} 獲勝！`;
      const ranking = game.seats
        .slice()
        .sort((a, b) => b.score - a.score)
        .map((s, i) => `<li><span>${i + 1}</span><span class="nm">${esc(s.name)}${s.id === me() ? '（你）' : ''}</span><b>${s.score}</b></li>`)
        .join('');
      html = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="go"><h2 id="go">遊戲結束</h2>
        <p class="winner">${headline}</p>${resultsHTML(game)}<ol class="rank-list">${ranking}</ol>
        <div class="sheet-actions">${isHost() ? '<button class="btn on-sand" data-action="rematch">回大廳再玩一場</button>' : ''}
        <button class="btn quiet" data-action="leave">離開房間</button></div></div>`;
    } else if (store.overlay === 'rules') {
      html = document.getElementById('rules-tpl').innerHTML;
    }
    if (!html) {
      $overlay.hidden = true;
      $overlay.innerHTML = '';
      return;
    }
    $overlay.innerHTML = html;
    $overlay.hidden = false;
  }

  // ---------- 動作 ----------

  function readName() {
    const el = document.getElementById('nm');
    const name = (el ? el.value : store.name).trim();
    if (!name) {
      toast('先輸入暱稱');
      if (el) el.focus();
      return null;
    }
    store.name = name.slice(0, 12);
    ls.set('totem.name', store.name);
    return store.name;
  }

  async function play(card, tikis) {
    store.pending = true;
    const res = await emit('game:play', { card, tikis });
    store.pending = false;
    store.sel = null;
    if (!res.ok) toast(res.message);
    render();
  }

  const actions = {
    async create() {
      const name = readName();
      if (!name) return;
      const res = await emit('room:create', { name });
      if (!res.ok) return toast(res.message);
      saveSession(res.session);
    },
    async join() {
      const name = readName();
      if (!name) return;
      const code = (document.getElementById('code').value || '').trim().toUpperCase();
      if (code.length !== 4) return toast('房間代碼是 4 個英文字母');
      const res = await emit('room:join', { roomId: code, name });
      if (!res.ok) return toast(res.message);
      saveSession(res.session);
    },
    rules() {
      store.overlay = 'rules';
      renderOverlay();
    },
    'close-overlay'() {
      store.overlay = null;
      renderOverlay();
    },
    async 'copy-link'() {
      const url = `${location.origin}/?room=${room().id}`;
      try {
        await navigator.clipboard.writeText(url);
        toast('已複製邀請連結');
      } catch {
        window.prompt('複製這個連結傳給朋友：', url);
      }
    },
    async 'add-bot'() {
      const res = await emit('room:addBot');
      if (!res.ok) toast(res.message);
    },
    async remove(el) {
      const res = await emit('room:remove', { playerId: el.dataset.id });
      if (!res.ok) toast(res.message);
    },
    async start() {
      const res = await emit('room:start');
      if (!res.ok) toast(res.message);
    },
    async leave() {
      const game = g();
      if (game && game.phase !== 'gameOver' && !window.confirm('離開後由電腦接手你的位置，確定要離開嗎？')) return;
      await emit('room:leave');
      saveSession(null);
      store.room = null;
      store.screen = null;
      render();
    },
    'pick-card'(el) {
      if (!myTurn() || store.pending) return;
      const uid = el.dataset.uid;
      store.sel = store.sel && store.sel.uid === uid ? null : { uid, picks: [] };
      render();
    },
    'pick-tiki'(el) {
      const game = g();
      if (!store.sel || !game) return;
      const card = game.myHand.find((c) => c.uid === store.sel.uid);
      const id = el.dataset.id;
      if (!card || !card.tikis.includes(id)) return;
      if (card.mode === 'one') return play(card.uid, [id]);
      const picks = store.sel.picks;
      if (picks.includes(id)) store.sel.picks = picks.filter((x) => x !== id);
      else picks.push(id);
      if (store.sel.picks.length === 2) return play(card.uid, store.sel.picks.slice());
      render();
    },
    confirm() {
      if (store.sel) play(store.sel.uid, []);
    },
    cancel() {
      store.sel = null;
      render();
    },
    async next() {
      const res = await emit('game:next');
      if (!res.ok) toast(res.message);
    },
    async rematch() {
      const res = await emit('room:rematch');
      if (!res.ok) toast(res.message);
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'INPUT') return;
    const fn = actions[el.dataset.action];
    if (fn) fn(el);
  });

  document.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.action === 'variant') {
      const res = await emit('room:options', { variant: el.checked });
      if (!res.ok) toast(res.message);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (store.overlay) actions['close-overlay']();
      else if (store.sel) actions.cancel();
    }
    if (e.key === 'Enter' && e.target.id === 'nm') (prefillCode ? actions.join : actions.create)();
    if (e.key === 'Enter' && e.target.id === 'code') actions.join();
  });

  $overlay.addEventListener('click', (e) => {
    if (e.target === $overlay && store.overlay) actions['close-overlay']();
  });

  renderConn();
  if (!store.session) render();
  else $app.innerHTML = '<p class="muted" style="text-align:center;padding-top:20vh">正在回到房間…</p>';
})();
