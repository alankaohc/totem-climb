'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { GROUPS, TIKIS, TARGET_CARDS, buildHand } = require('../server/cards');
const game = require('../server/game');
const bot = require('../server/bot');

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

test('27 張目標卡：每張三組各一尊、沒有重複、每尊在各位置剛好 3 次', () => {
  assert.equal(TARGET_CARDS.length, 27);
  const keys = new Set(TARGET_CARDS.map((c) => c.slice().sort().join()));
  assert.equal(keys.size, 27);
  for (const card of TARGET_CARDS) {
    const groups = card.map((t) => TIKIS[t].group).sort();
    assert.deepEqual(groups, ['bone', 'shell', 'star']);
  }
  for (const tiki of Object.keys(TIKIS)) {
    for (let slot = 0; slot < 3; slot++) {
      assert.equal(TARGET_CARDS.filter((c) => c[slot] === tiki).length, 3, `${tiki} slot ${slot}`);
    }
  }
});

test('官方規則的計分範例', () => {
  const line = ['purple', 'grey', 'orange', 'pink'];
  assert.equal(game.scoreTarget(line, ['grey', 'purple', 'red']).total, 5);
  assert.equal(game.scoreTarget(line, ['blue', 'grey', 'orange']).total, 7);
  assert.equal(game.scoreTarget(line, ['purple', 'blue', 'grey']).total, 11);
  assert.equal(game.scoreTarget(line, ['orange', 'yellow', 'grey']).total, 2);
});

test('開局排列：三組各自連在一起', () => {
  for (let s = 0; s < 50; s++) {
    const line = game.setupLine(seeded(s));
    assert.equal(line.length, 9);
    for (let i = 0; i < 9; i += 3) {
      const gs = new Set(line.slice(i, i + 3).map((t) => TIKIS[t].group));
      assert.equal(gs.size, 1);
    }
  }
});

test('手牌組成', () => {
  const r = seeded(1);
  assert.equal(buildHand(2, false, r).length, 7);
  assert.equal(buildHand(3, false, r).length, 6);
  assert.equal(buildHand(4, false, r).length, 6);
  assert.equal(buildHand(2, true, r).length, 7);
  assert.equal(buildHand(4, true, r).length, 6);
  assert.equal(buildHand(3, false, r).filter((c) => c.type === 'up1').length, 1);
});

function fixedGame(line) {
  const g = game.createGame(players(2), {}, seeded(7));
  g.line = line.slice();
  g.turn = 'p0';
  g.hands.p0 = [
    { uid: 'a', type: 'up2' },
    { uid: 'b', type: 'toast' },
    { uid: 'c', type: 'topple' },
    { uid: 'd', type: 'swap' },
    { uid: 'e', type: 'down2' },
  ];
  return g;
}

const L = ['purple', 'green', 'orange', 'grey', 'pink', 'brown', 'blue', 'yellow', 'red'];

test('上升必須走滿格數，被越過的往下', () => {
  const g = fixedGame(L);
  assert.equal(game.playMove(g, 'p0', { card: 'a', tikis: ['green'] }).ok, false);
  assert.equal(game.playMove(g, 'p0', { card: 'a', tikis: ['grey'] }).ok, true);
  assert.deepEqual(g.line.slice(0, 4), ['purple', 'grey', 'green', 'orange']);
});

test('燒毀不能當每局第一張，之後移除最底部', () => {
  const g = fixedGame(L);
  assert.equal(game.playMove(g, 'p0', { card: 'b', tikis: [] }).code, 'ILLEGAL');
  g.hasPlayed.p0 = true;
  assert.equal(game.playMove(g, 'p0', { card: 'b', tikis: [] }).ok, true);
  assert.deepEqual(g.removed, ['red']);
  assert.equal(g.line.length, 8);
});

test('推到底、交換、下降 2', () => {
  let g = fixedGame(L);
  game.playMove(g, 'p0', { card: 'c', tikis: ['purple'] });
  assert.equal(g.line[8], 'purple');
  g = fixedGame(L);
  game.playMove(g, 'p0', { card: 'd', tikis: ['purple', 'red'] });
  assert.equal(g.line[0], 'red');
  assert.equal(g.line[8], 'purple');
  g = fixedGame(L);
  assert.equal(game.playMove(g, 'p0', { card: 'e', tikis: ['yellow'] }).ok, false);
  assert.equal(game.playMove(g, 'p0', { card: 'e', tikis: ['purple'] }).ok, true);
  assert.equal(g.line[2], 'purple');
});

test('不是你的回合不能出牌', () => {
  const g = fixedGame(L);
  g.hands.p1 = [{ uid: 'x', type: 'up1' }];
  assert.equal(game.playMove(g, 'p1', { card: 'x', tikis: ['green'] }).code, 'NOT_YOUR_TURN');
});

test('電腦對電腦：2–4 人、基本與變體，整場都能正常結束', () => {
  let games = 0;
  for (const n of [2, 3, 4]) {
    for (const variant of [false, true]) {
      for (let s = 0; s < 150; s++) {
        const r = seeded(s * 31 + n * 7 + (variant ? 1 : 0));
        const g = game.createGame(players(n), { variant }, r);
        let steps = 0;
        while (g.phase !== 'gameOver') {
          assert.ok(steps++ < 500, '卡住了');
          if (g.phase === 'roundEnd') {
            assert.equal(game.nextRound(g, r).ok, true);
            continue;
          }
          assert.equal(g.line.length + g.removed.length, 9);
          const move = bot.chooseMove(g, g.turn, r);
          assert.ok(move, '輪到的玩家沒有動作');
          const res = game.playMove(g, g.turn, move);
          assert.equal(res.ok, true, res.message);
        }
        const expected = n === 2 ? 4 : n;
        assert.ok(g.round === expected || (g.round === expected + 1 && g.tiebreak));
        assert.ok(g.winners.length >= 1);
        games++;
      }
    }
  }
  assert.equal(games, 900);
});
