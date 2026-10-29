'use strict';

const { GROUPS, TIKIS, TARGET_CARDS, TARGET_POINTS, CARD_TYPES, buildHand } = require('./cards');

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 開局排列：三組各自洗亂，三組的先後也隨機
function setupLine(rng) {
  return shuffle(GROUPS, rng).flatMap((g) => shuffle(g.tikis, rng));
}

function createGame(players, options, rng) {
  if (players.length < 2 || players.length > 4) throw new Error('需要 2 到 4 位玩家');
  const n = players.length;
  const state = {
    options: { variant: !!(options && options.variant) },
    seats: players.map((p) => ({ id: p.id, name: p.name, score: 0 })),
    totalRounds: n === 2 ? 4 : n,
    round: 0,
    tiebreak: false,
    activeIds: players.map((p) => p.id),
    firstSeat: Math.floor(rng() * n),
    targetDeck: shuffle(TARGET_CARDS.map((_, i) => i), rng),
    phase: 'playing',
    line: [],
    removed: [],
    hands: {},
    played: {},
    hasPlayed: {},
    targets: {},
    turn: null,
    log: [],
    lastRound: null,
    tiebreakNext: null,
    winners: null,
  };
  startRound(state, rng, true);
  return state;
}

function seatIndex(state, id) {
  return state.seats.findIndex((s) => s.id === id);
}

function seatName(state, id) {
  const s = state.seats.find((x) => x.id === id);
  return s ? s.name : '?';
}

function drawTarget(state, rng) {
  if (state.targetDeck.length === 0) state.targetDeck = shuffle(TARGET_CARDS.map((_, i) => i), rng);
  return state.targetDeck.pop();
}

// 從 fromSeat（含）開始，依座位順序找下一位仍在本局的玩家
function nextActiveSeat(state, fromSeat) {
  const n = state.seats.length;
  for (let k = 0; k < n; k++) {
    const idx = (fromSeat + k) % n;
    if (state.activeIds.includes(state.seats[idx].id)) return idx;
  }
  return -1;
}

function startRound(state, rng, isFirst) {
  state.round += 1;
  if (!isFirst) state.firstSeat = nextActiveSeat(state, state.firstSeat + 1);
  else state.firstSeat = nextActiveSeat(state, state.firstSeat);
  state.line = setupLine(rng);
  state.removed = [];
  state.hands = {};
  state.played = {};
  state.hasPlayed = {};
  state.targets = {};
  const activeCount = state.activeIds.length;
  for (const id of state.activeIds) {
    state.hands[id] = buildHand(activeCount, state.options.variant, rng);
    state.played[id] = [];
    state.hasPlayed[id] = false;
    state.targets[id] = drawTarget(state, rng);
  }
  state.turn = state.seats[state.firstSeat].id;
  state.phase = 'playing';
  state.log = [{ kind: 'round', text: state.tiebreak ? `加賽開始` : `第 ${state.round} 局開始` }];
}

// 一張牌目前可以作用的圖騰；mode: none（不需選）/ one / two（交換）
function cardTargets(state, playerId, card) {
  const line = state.line;
  const len = line.length;
  switch (card.type) {
    case 'up1':
    case 'up2':
    case 'up3': {
      const n = Number(card.type.slice(2));
      return { mode: 'one', tikis: line.filter((_, i) => i >= n) };
    }
    case 'down2':
      return { mode: 'one', tikis: line.filter((_, i) => i + 2 <= len - 1) };
    case 'topple':
      return { mode: 'one', tikis: line.slice() };
    case 'swap':
      return { mode: 'two', tikis: len >= 2 ? line.slice() : [] };
    case 'toast':
      return { mode: 'none', tikis: [], playable: state.hasPlayed[playerId] && len > 3 };
    default:
      return { mode: 'none', tikis: [], playable: false };
  }
}

function isPlayable(state, playerId, card) {
  const t = cardTargets(state, playerId, card);
  if (t.mode === 'none') return !!t.playable;
  if (t.mode === 'two') return t.tikis.length >= 2;
  return t.tikis.length > 0;
}

function hasAnyMove(state, playerId) {
  return (state.hands[playerId] || []).some((c) => isPlayable(state, playerId, c));
}

// 列出所有合法動作（給電腦玩家用）
function allMoves(state, playerId) {
  const moves = [];
  const seen = new Set();
  for (const card of state.hands[playerId] || []) {
    if (seen.has(card.type)) continue; // 同種牌效果相同
    seen.add(card.type);
    const t = cardTargets(state, playerId, card);
    if (t.mode === 'none') {
      if (t.playable) moves.push({ card: card.uid, type: card.type, tikis: [] });
    } else if (t.mode === 'one') {
      for (const k of t.tikis) moves.push({ card: card.uid, type: card.type, tikis: [k] });
    } else {
      for (let i = 0; i < t.tikis.length; i++)
        for (let j = i + 1; j < t.tikis.length; j++)
          moves.push({ card: card.uid, type: card.type, tikis: [t.tikis[i], t.tikis[j]] });
    }
  }
  return moves;
}

// 只改動 line / removed，不碰其他狀態（電腦玩家模擬也用這個）
function applyEffect(line, removed, type, tikis) {
  const move = (from, to) => {
    const [t] = line.splice(from, 1);
    line.splice(to, 0, t);
  };
  switch (type) {
    case 'up1':
    case 'up2':
    case 'up3': {
      const i = line.indexOf(tikis[0]);
      move(i, i - Number(type.slice(2)));
      break;
    }
    case 'down2': {
      const i = line.indexOf(tikis[0]);
      move(i, i + 2);
      break;
    }
    case 'topple': {
      const i = line.indexOf(tikis[0]);
      move(i, line.length - 1);
      break;
    }
    case 'swap': {
      const i = line.indexOf(tikis[0]);
      const j = line.indexOf(tikis[1]);
      [line[i], line[j]] = [line[j], line[i]];
      break;
    }
    case 'toast':
      removed.push(line.pop());
      break;
  }
}

function describeMove(type, tikis, burned) {
  const nm = (k) => TIKIS[k].name;
  switch (type) {
    case 'up1':
    case 'up2':
    case 'up3':
      return `${nm(tikis[0])} 上升 ${type.slice(2)} 格`;
    case 'down2':
      return `${nm(tikis[0])} 下降 2 格`;
    case 'topple':
      return `${nm(tikis[0])} 推到最底`;
    case 'swap':
      return `${nm(tikis[0])} 和 ${nm(tikis[1])} 交換`;
    case 'toast':
      return `燒毀了 ${nm(burned)}`;
    default:
      return '';
  }
}

function playMove(state, playerId, payload, opts = {}) {
  if (state.phase !== 'playing') return { ok: false, code: 'NOT_PLAYING', message: '目前不是出牌階段' };
  if (state.turn !== playerId) return { ok: false, code: 'NOT_YOUR_TURN', message: '還沒輪到你' };
  const hand = state.hands[playerId];
  const card = hand.find((c) => c.uid === (payload && payload.card));
  if (!card) return { ok: false, code: 'BAD_CARD', message: '你手上沒有這張牌' };
  const tikis = Array.isArray(payload.tikis) ? payload.tikis.filter((x) => typeof x === 'string') : [];
  const t = cardTargets(state, playerId, card);
  if (t.mode === 'none') {
    if (!t.playable) return { ok: false, code: 'ILLEGAL', message: '每局的第一張牌不能是燒毀' };
  } else if (t.mode === 'one') {
    if (tikis.length !== 1 || !t.tikis.includes(tikis[0]))
      return { ok: false, code: 'ILLEGAL', message: '這張牌不能用在那尊圖騰上' };
  } else if (tikis.length !== 2 || tikis[0] === tikis[1] || !tikis.every((k) => t.tikis.includes(k))) {
    return { ok: false, code: 'ILLEGAL', message: '請選兩尊不同的圖騰' };
  }

  const burned = card.type === 'toast' ? state.line[state.line.length - 1] : null;
  applyEffect(state.line, state.removed, card.type, tikis);
  hand.splice(hand.indexOf(card), 1);
  state.played[playerId].push(card.type);
  state.hasPlayed[playerId] = true;
  state.log.push({
    kind: 'move',
    player: playerId,
    card: card.type,
    tikis: card.type === 'toast' ? [burned] : tikis,
    auto: !!opts.auto,
    text: `${seatName(state, playerId)}${opts.auto ? '（代打）' : ''} 打出「${CARD_TYPES[card.type].name}」：${describeMove(card.type, tikis, burned)}`,
  });
  advance(state, playerId);
  return { ok: true };
}

function roundIsOver(state) {
  if (state.line.length <= 3) return true;
  return state.activeIds.every((id) => state.hands[id].length === 0);
}

function advance(state, lastId) {
  if (roundIsOver(state)) return endRound(state);
  let idx = seatIndex(state, lastId);
  for (let k = 0; k < state.seats.length; k++) {
    idx = nextActiveSeat(state, idx + 1);
    const id = state.seats[idx].id;
    if (state.hands[id].length === 0) continue;
    if (!hasAnyMove(state, id)) {
      // 理論上不會發生；保險起見，沒有合法動作就丟掉一張牌並跳過
      state.hands[id].shift();
      state.log.push({ kind: 'skip', player: id, text: `${seatName(state, id)} 沒有可以出的牌，跳過` });
      if (roundIsOver(state)) return endRound(state);
      continue;
    }
    state.turn = id;
    return;
  }
  endRound(state);
}

function scoreTarget(line, target) {
  const parts = target.map((tiki, slot) => {
    const pos = line.indexOf(tiki);
    const ok = pos !== -1 && pos <= slot;
    return { tiki, pos, points: ok ? TARGET_POINTS[slot] : 0 };
  });
  return { parts, total: parts.reduce((a, p) => a + p.points, 0) };
}

function endRound(state) {
  state.turn = null;
  const results = state.activeIds.map((id) => {
    const target = TARGET_CARDS[state.targets[id]];
    const s = scoreTarget(state.line, target);
    const seat = state.seats.find((x) => x.id === id);
    seat.score += s.total;
    return { id, target, parts: s.parts, points: s.total };
  });
  state.lastRound = {
    round: state.round,
    tiebreak: state.tiebreak,
    line: state.line.slice(),
    removed: state.removed.slice(),
    results,
  };
  state.log.push({ kind: 'round', text: '本局結束，翻開目標卡' });

  const regularDone = state.round >= state.totalRounds;
  if (!regularDone) {
    state.phase = 'roundEnd';
    return;
  }
  const contenders = state.seats.filter((s) => state.activeIds.includes(s.id));
  const best = Math.max(...contenders.map((s) => s.score));
  const leaders = contenders.filter((s) => s.score === best).map((s) => s.id);
  if (leaders.length > 1 && !state.tiebreak) {
    // 原版規則：同分的玩家再打一局加賽
    state.phase = 'roundEnd';
    state.tiebreakNext = leaders;
    return;
  }
  state.phase = 'gameOver';
  state.winners = leaders; // 加賽後仍同分則並列
}

function nextRound(state, rng) {
  if (state.phase !== 'roundEnd') return { ok: false, code: 'NOT_ROUND_END', message: '本局還沒結束' };
  if (state.tiebreakNext) {
    state.tiebreak = true;
    state.activeIds = state.tiebreakNext;
    state.tiebreakNext = null;
  }
  startRound(state, rng, false);
  return { ok: true };
}

// 替換玩家（例如真人離開後改由電腦接手）
function renameSeat(state, id, name) {
  const s = state.seats.find((x) => x.id === id);
  if (s) s.name = name;
}

module.exports = {
  shuffle,
  setupLine,
  createGame,
  cardTargets,
  isPlayable,
  allMoves,
  applyEffect,
  playMove,
  nextRound,
  scoreTarget,
  renameSeat,
};
