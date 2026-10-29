'use strict';

const { TARGET_CARDS } = require('./cards');
const { allMoves, applyEffect } = require('./game');

// 每個目標位置在各名次的「期望價值」：越接近得分條件越高
const SLOT_VALUE = [
  [9, 4, 2, 1, 0.5], // 9 分位：只有第 1 名得分
  [5, 5, 2.5, 1, 0.5], // 5 分位：前 2 名
  [2, 2, 2, 1, 0.5], // 2 分位：前 3 名
];

// 用掉越強的牌，扣一點點分，讓電腦優先用便宜的牌
const CARD_COST = { up1: 0.1, up2: 0.2, up3: 0.35, topple: 0.3, toast: 0.25, swap: 0.3, down2: 0.2 };

function evaluate(line, target, cardsLeftInRound) {
  let v = 0;
  const urgency = cardsLeftInRound <= 3 ? 1.6 : 1; // 回合快結束時，現況幾乎就是結果
  target.forEach((tiki, slot) => {
    const pos = line.indexOf(tiki);
    if (pos === -1) {
      v -= 2;
      return;
    }
    const row = SLOT_VALUE[slot];
    v += (pos < row.length ? row[pos] : 0) * (pos <= slot ? urgency : 1);
    if (pos === line.length - 1) v -= 1.5; // 在最底部，隨時會被燒毀
    else if (pos === line.length - 2) v -= 0.4;
  });
  return v;
}

function chooseMove(state, playerId, rng = Math.random) {
  const moves = allMoves(state, playerId);
  if (moves.length === 0) return null;
  const target = TARGET_CARDS[state.targets[playerId]];
  const cardsLeft = state.activeIds.reduce((a, id) => a + state.hands[id].length, 0) - 1;
  let best = null;
  let bestScore = -Infinity;
  for (const m of moves) {
    const line = state.line.slice();
    const removed = state.removed.slice();
    applyEffect(line, removed, m.type, m.tikis);
    const score = evaluate(line, target, cardsLeft) - (CARD_COST[m.type] || 0) + rng() * 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return { card: best.card, tikis: best.tikis };
}

module.exports = { chooseMove, evaluate };
