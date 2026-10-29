'use strict';

process.env.BOT_DELAY_MS = '0';
process.env.AWAY_AUTOPLAY_MS = '50';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { server, io } = require('../server/index');

let url;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  io.close();
  await new Promise((resolve) => server.close(resolve));
});

function client() {
  const s = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  s.last = null;
  s.on('room:state', (r) => (s.last = r));
  return new Promise((resolve) => s.on('connect', () => resolve(s)));
}

const ask = (s, ev, payload = {}) => s.timeout(3000).emitWithAck(ev, payload);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function pickMove(game) {
  for (const c of game.myHand) {
    if (c.mode === 'none' && c.playable) return { card: c.uid, tikis: [] };
    if (c.mode === 'one' && c.tikis.length) return { card: c.uid, tikis: [c.tikis[c.tikis.length - 1]] };
    if (c.mode === 'two' && c.tikis.length >= 2) return { card: c.uid, tikis: c.tikis.slice(0, 2) };
  }
  return null;
}

// 讓真人客戶端自動出牌，直到遊戲結束
function autoplay(s, onState) {
  return new Promise((resolve) => {
    let busy = false;
    const tick = async (r) => {
      if (onState) onState(r);
      const g = r.game;
      if (!g || busy) return;
      if (g.phase === 'gameOver') return resolve(r);
      busy = true;
      try {
        if (g.phase === 'playing' && g.turn === r.you) {
          const res = await ask(s, 'game:play', pickMove(g));
          assert.equal(res.ok, true, res.message);
        } else if (g.phase === 'roundEnd' && r.hostId === r.you) {
          await ask(s, 'game:next');
        }
      } finally {
        busy = false;
      }
      // 等回覆時可能錯過了新狀態，用最新的再判斷一次
      if (s.last !== r) tick(s.last);
    };
    s.on('room:state', tick);
    if (s.last) tick(s.last);
  });
}

test('建立、加入、加電腦、開始，整場打完；資訊保密；斷線重連', async () => {
  const alice = await client();
  const bob = await client();

  assert.equal((await ask(alice, 'room:create', { name: '   ' })).code, 'BAD_NAME');
  const created = await ask(alice, 'room:create', { name: 'Alice' });
  assert.equal(created.ok, true);
  const code = created.session.roomId;
  assert.match(code, /^[A-Z]{4}$/);

  assert.equal((await ask(bob, 'room:join', { roomId: 'ZZZZ', name: 'Bob' })).code, 'ROOM_NOT_FOUND');
  const joined = await ask(bob, 'room:join', { roomId: code.toLowerCase(), name: 'Bob' });
  assert.equal(joined.ok, true);

  assert.equal((await ask(bob, 'room:addBot')).code, 'NOT_HOST');
  assert.equal((await ask(alice, 'room:addBot')).ok, true);
  assert.equal((await ask(alice, 'room:options', { variant: true })).ok, true);
  assert.equal((await ask(alice, 'room:start')).ok, true);
  await wait(30);

  const g = bob.last.game;
  assert.ok(g, 'Bob 應該收到遊戲狀態');
  assert.equal(g.seats.length, 3);
  assert.equal(g.myTarget.length, 3);
  assert.equal(g.lastRound, null);
  // 變體規則：別人的手牌內容不給看
  for (const s of g.seats) if (s.id !== bob.last.you) assert.equal(s.handTypes, null);
  assert.equal(JSON.stringify(g).includes('targets'), false, '不能送出其他人的目標卡');

  // 不是自己的回合不能出牌（先等輪到真人，避免和電腦玩家搶時間）
  const humanIds = [alice.last.you, bob.last.you];
  for (let i = 0; i < 50 && !humanIds.includes(alice.last.game.turn); i++) await wait(20);
  const notMe = alice.last.game.turn === alice.last.you ? bob : alice;
  const mv = pickMove(notMe.last.game);
  if (mv) assert.equal((await ask(notMe, 'game:play', mv)).code, 'NOT_YOUR_TURN');

  // Bob 斷線再用 session 回來
  const bobSession = joined.session;
  bob.disconnect();
  await wait(100);
  const bob2 = await client();
  const back = await ask(bob2, 'room:resync', bobSession);
  assert.equal(back.ok, true);
  assert.equal((await ask(bob2, 'room:resync', { ...bobSession, token: 'x'.repeat(64) })).code, 'UNAUTHORIZED');

  const [endA, endB] = await Promise.all([autoplay(alice), autoplay(bob2)]);
  assert.equal(endA.game.phase, 'gameOver');
  assert.ok(endA.game.winners.length >= 1);
  assert.ok(endA.game.round >= 3);
  assert.equal(endB.game.phase, 'gameOver');

  // 結束後回大廳
  assert.equal((await ask(alice, 'room:rematch')).ok, true);
  await wait(30);
  assert.equal(alice.last.game, null);
  assert.equal(alice.last.players.length, 3);

  alice.disconnect();
  bob2.disconnect();
});

test('遊戲中有人離開，由電腦接手並打完', async () => {
  const a = await client();
  const b = await client();
  const { session } = await ask(a, 'room:create', { name: 'A' });
  await ask(b, 'room:join', { roomId: session.roomId, name: 'B' });
  await ask(a, 'room:start');
  await wait(30);
  assert.equal((await ask(b, 'room:leave')).ok, true);
  await wait(30);
  const leaver = a.last.game.seats.find((s) => s.name.startsWith('B'));
  assert.equal(leaver.isBot, true);
  const end = await autoplay(a);
  assert.equal(end.game.phase, 'gameOver');
  assert.equal(end.game.round >= 4, true);
  a.disconnect();
  b.disconnect();
});

test('斷線的玩家輪到時會被代打', async () => {
  const a = await client();
  const b = await client();
  const { session } = await ask(a, 'room:create', { name: 'A' });
  await ask(b, 'room:join', { roomId: session.roomId, name: 'B' });
  await ask(a, 'room:start');
  await wait(30);
  b.disconnect(); // B 掛著不回來，伺服器 50ms 後幫他出牌
  const end = await autoplay(a);
  assert.equal(end.game.phase, 'gameOver');
  assert.ok(end.game.log.length > 0);
  a.disconnect();
});
