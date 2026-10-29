'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const { TARGET_CARDS } = require('./cards');
const game = require('./game');
const bot = require('./bot');

const PORT = Number(process.env.PORT) || 3000;
const BOT_DELAY_MS = Number(process.env.BOT_DELAY_MS ?? 1100);
const AWAY_AUTOPLAY_MS = Number(process.env.AWAY_AUTOPLAY_MS ?? 30000);
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const MAX_PLAYERS = 4;
const BOT_NAMES = ['阿浪', '小椰', '珊瑚', '海龜'];

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 20000, pingTimeout: 20000 });

/** @type {Map<string, any>} */
const rooms = new Map();

// ---------- 工具 ----------

function makeRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += letters[crypto.randomInt(letters.length)];
    if (!rooms.has(code)) return code;
  }
}

function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, 12);
  return name.length ? name : null;
}

function fail(code, message) {
  return { ok: false, code, message };
}

function rng() {
  return crypto.randomInt(0, 2 ** 32) / 2 ** 32;
}

function humans(room) {
  return room.players.filter((p) => !p.isBot);
}

function findPlayer(room, id) {
  return room.players.find((p) => p.id === id);
}

function ensureHost(room) {
  const host = findPlayer(room, room.hostId);
  if (host && !host.isBot && host.connected) return;
  const next = humans(room).find((p) => p.connected) || humans(room)[0];
  if (next) room.hostId = next.id;
}

// ---------- 給每位玩家的畫面資料（只含他該看到的） ----------

function gameView(room, viewerId) {
  const g = room.game;
  if (!g) return null;
  const isActive = (id) => g.activeIds.includes(id);
  const revealed = g.phase !== 'playing';
  const myHand = g.hands[viewerId] || [];
  return {
    phase: g.phase,
    round: g.round,
    totalRounds: g.totalRounds,
    tiebreak: g.tiebreak,
    variant: g.options.variant,
    line: g.line,
    removed: g.removed,
    turn: g.turn,
    seats: g.seats.map((s) => {
      const p = findPlayer(room, s.id);
      return {
        id: s.id,
        name: s.name,
        score: s.score,
        active: isActive(s.id),
        isBot: p ? p.isBot : true,
        connected: p ? p.isBot || p.connected : false,
        handCount: (g.hands[s.id] || []).length,
        // 基本規則下大家手牌相同、出過的牌公開，所以剩餘手牌本來就推得出來；變體則隱藏
        handTypes: !g.options.variant || s.id === viewerId ? (g.hands[s.id] || []).map((c) => c.type) : null,
        played: g.played[s.id] || [],
      };
    }),
    you: viewerId,
    myTarget: isActive(viewerId) && g.targets[viewerId] !== undefined ? TARGET_CARDS[g.targets[viewerId]] : null,
    myHand: myHand.map((c) => ({
      uid: c.uid,
      type: c.type,
      ...game.cardTargets(g, viewerId, c),
    })),
    log: g.log.slice(-40),
    lastRound: revealed ? g.lastRound : null,
    tiebreakNext: g.tiebreakNext,
    winners: g.winners,
  };
}

function roomView(room, viewerId) {
  return {
    id: room.id,
    hostId: room.hostId,
    you: viewerId,
    options: room.options,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      connected: p.isBot || p.connected,
    })),
    game: gameView(room, viewerId),
  };
}

function broadcast(room) {
  room.lastActive = Date.now();
  for (const p of humans(room)) {
    if (p.socketId) io.to(p.socketId).emit('room:state', roomView(room, p.id));
  }
  scheduleAutoplay(room);
}

// ---------- 電腦玩家與離線代打 ----------

function scheduleAutoplay(room) {
  clearTimeout(room.autoTimer);
  room.autoTimer = null;
  const g = room.game;
  if (!g || g.phase !== 'playing' || !g.turn) return;
  const p = findPlayer(room, g.turn);
  if (!p) return;
  let delay = null;
  let auto = false;
  if (p.isBot) delay = BOT_DELAY_MS;
  else if (!p.connected) {
    delay = AWAY_AUTOPLAY_MS;
    auto = true;
  }
  if (delay === null) return;
  const turnId = g.turn;
  room.autoTimer = setTimeout(() => {
    if (!room.game || room.game.turn !== turnId || room.game.phase !== 'playing') return;
    const move = bot.chooseMove(room.game, turnId, rng);
    if (move) game.playMove(room.game, turnId, move, { auto });
    broadcast(room);
  }, delay);
}

// ---------- 房間生命週期 ----------

function createPlayer(name, isBot) {
  return {
    id: crypto.randomUUID(),
    token: isBot ? null : crypto.randomBytes(32).toString('hex'),
    name,
    isBot,
    socketId: null,
    connected: false,
  };
}

function attachSocket(room, player, socket) {
  if (player.socketId && player.socketId !== socket.id) {
    const old = io.sockets.sockets.get(player.socketId);
    if (old) {
      old.emit('session:replaced');
      old.data.roomId = null;
      old.data.playerId = null;
      old.disconnect(true);
    }
  }
  player.socketId = socket.id;
  player.connected = true;
  socket.data.roomId = room.id;
  socket.data.playerId = player.id;
  socket.join(room.id);
  room.emptySince = null;
}

function session(room, player) {
  return { roomId: room.id, playerId: player.id, token: player.token };
}

function removePlayer(room, playerId) {
  room.players = room.players.filter((p) => p.id !== playerId);
  if (humans(room).length === 0) {
    destroyRoom(room);
    return;
  }
  ensureHost(room);
}

function destroyRoom(room) {
  clearTimeout(room.autoTimer);
  rooms.delete(room.id);
}

function currentRoom(socket) {
  const room = rooms.get(socket.data.roomId);
  if (!room) return { error: fail('ROOM_NOT_FOUND', '房間不存在了') };
  const player = findPlayer(room, socket.data.playerId);
  if (!player) return { error: fail('NOT_IN_ROOM', '你不在這個房間裡') };
  return { room, player };
}

// ---------- Socket 事件 ----------

io.on('connection', (socket) => {
  const on = (event, fn) => {
    socket.on(event, (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        reply(fn(payload || {}) || { ok: true });
      } catch (err) {
        console.error(`[${event}]`, err);
        reply(fail('SERVER_ERROR', '伺服器發生錯誤，請再試一次'));
      }
    });
  };

  on('room:create', ({ name }) => {
    const nm = cleanName(name);
    if (!nm) return fail('BAD_NAME', '請輸入暱稱');
    const room = {
      id: makeRoomCode(),
      hostId: null,
      players: [],
      options: { variant: false },
      game: null,
      autoTimer: null,
      emptySince: null,
      lastActive: Date.now(),
    };
    const player = createPlayer(nm, false);
    room.players.push(player);
    room.hostId = player.id;
    rooms.set(room.id, room);
    attachSocket(room, player, socket);
    broadcast(room);
    return { ok: true, session: session(room, player) };
  });

  on('room:join', ({ roomId, name }) => {
    const nm = cleanName(name);
    if (!nm) return fail('BAD_NAME', '請輸入暱稱');
    const code = typeof roomId === 'string' ? roomId.trim().toUpperCase() : '';
    const room = rooms.get(code);
    if (!room) return fail('ROOM_NOT_FOUND', `找不到房間 ${code || ''}，請確認代碼`);
    if (room.game) return fail('IN_PROGRESS', '這個房間的遊戲已經開始了');
    if (room.players.length >= MAX_PLAYERS) return fail('ROOM_FULL', '房間已滿（最多 4 人）');
    const player = createPlayer(nm, false);
    room.players.push(player);
    attachSocket(room, player, socket);
    ensureHost(room);
    broadcast(room);
    return { ok: true, session: session(room, player) };
  });

  on('room:resync', ({ roomId, playerId, token }) => {
    const room = rooms.get(roomId);
    if (!room) return fail('ROOM_NOT_FOUND', '房間不存在了（伺服器可能重新啟動過）');
    const player = findPlayer(room, playerId);
    if (!player || player.isBot || typeof token !== 'string' || player.token !== token)
      return fail('UNAUTHORIZED', '無法回到這個房間');
    attachSocket(room, player, socket);
    ensureHost(room);
    broadcast(room);
    return { ok: true, session: session(room, player) };
  });

  on('room:leave', () => {
    const { room, player, error } = currentRoom(socket);
    if (error) return { ok: true };
    socket.leave(room.id);
    socket.data.roomId = null;
    socket.data.playerId = null;
    if (room.game && room.game.seats.some((s) => s.id === player.id)) {
      // 遊戲進行中離開：由電腦接手，牌局繼續
      player.isBot = true;
      player.token = null;
      player.socketId = null;
      player.connected = false;
      player.name = `${player.name}（電腦）`;
      game.renameSeat(room.game, player.id, player.name);
      if (humans(room).length === 0) {
        destroyRoom(room);
        return { ok: true };
      }
      ensureHost(room);
    } else {
      removePlayer(room, player.id);
      if (!rooms.has(room.id)) return { ok: true };
    }
    broadcast(room);
    return { ok: true };
  });

  on('room:addBot', () => {
    const { room, player, error } = currentRoom(socket);
    if (error) return error;
    if (room.hostId !== player.id) return fail('NOT_HOST', '只有房主可以加入電腦玩家');
    if (room.game) return fail('IN_PROGRESS', '遊戲已經開始了');
    if (room.players.length >= MAX_PLAYERS) return fail('ROOM_FULL', '房間已滿');
    const used = new Set(room.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `電腦 ${room.players.length + 1}`;
    room.players.push(createPlayer(name, true));
    broadcast(room);
  });

  on('room:remove', ({ playerId }) => {
    const { room, player, error } = currentRoom(socket);
    if (error) return error;
    if (room.hostId !== player.id) return fail('NOT_HOST', '只有房主可以移出玩家');
    if (room.game) return fail('IN_PROGRESS', '遊戲進行中不能移出玩家');
    const target = findPlayer(room, playerId);
    if (!target || target.id === player.id) return fail('BAD_PLAYER', '找不到這位玩家');
    if (target.socketId) {
      const s = io.sockets.sockets.get(target.socketId);
      if (s) {
        s.emit('room:removed');
        s.leave(room.id);
        s.data.roomId = null;
        s.data.playerId = null;
      }
    }
    removePlayer(room, target.id);
    broadcast(room);
  });

  on('room:options', ({ variant }) => {
    const { room, player, error } = currentRoom(socket);
    if (error) return error;
    if (room.hostId !== player.id) return fail('NOT_HOST', '只有房主可以調整設定');
    if (room.game) return fail('IN_PROGRESS', '遊戲已經開始了');
    room.options.variant = !!variant;
    broadcast(room);
  });

  on('room:start', () => {
    const { room, player, error } = currentRoom(socket);
    if (error) return error;
    if (room.hostId !== player.id) return fail('NOT_HOST', '只有房主可以開始遊戲');
    if (room.game) return fail('IN_PROGRESS', '遊戲已經開始了');
    if (room.players.length < 2) return fail('TOO_FEW', '至少要 2 位玩家，可以先加入電腦玩家');
    room.game = game.createGame(room.players, room.options, rng);
    broadcast(room);
  });

  on('game:play', ({ card, tikis }) => {
    const { room, player, error } = currentRoom(socket);
    if (error) return error;
    if (!room.game) return fail('NOT_PLAYING', '遊戲還沒開始');
    const res = game.playMove(room.game, player.id, { card, tikis });
    if (!res.ok) return res;
    broadcast(room);
  });

  on('game:next', () => {
    const { room, player, error } = currentRoom(socket);
    if (error) return error;
    if (!room.game) return fail('NOT_PLAYING', '遊戲還沒開始');
    const host = findPlayer(room, room.hostId);
    const hostAway = !host || !host.connected;
    if (room.hostId !== player.id && !hostAway) return fail('NOT_HOST', '等房主開始下一局');
    const res = game.nextRound(room.game, rng);
    if (!res.ok) return res;
    broadcast(room);
  });

  on('room:rematch', () => {
    const { room, player, error } = currentRoom(socket);
    if (error) return error;
    if (room.hostId !== player.id) return fail('NOT_HOST', '只有房主可以重新開始');
    if (!room.game || room.game.phase !== 'gameOver') return fail('NOT_OVER', '遊戲還沒結束');
    room.game = null;
    // 離線太久的真人玩家在回到大廳時移除
    room.players = room.players.filter((p) => p.isBot || p.connected || p.id === player.id);
    ensureHost(room);
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    const player = findPlayer(room, socket.data.playerId);
    if (!player || player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    if (!humans(room).some((p) => p.connected)) room.emptySince = Date.now();
    ensureHost(room);
    broadcast(room);
  });
});

// 清掉沒人在的房間
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS) destroyRoom(room);
  }
}, 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`圖騰登頂 listening on :${PORT}`));
}

module.exports = { server, io, rooms };
