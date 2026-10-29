'use strict';

// 九尊圖騰，分成三組（背面圖案：海星、魚骨、貝殼）
const GROUPS = [
  { id: 'star', name: '海星', tikis: ['purple', 'green', 'orange'] },
  { id: 'bone', name: '魚骨', tikis: ['grey', 'pink', 'brown'] },
  { id: 'shell', name: '貝殼', tikis: ['blue', 'yellow', 'red'] },
];

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

// 27 張目標卡：[9 分（須第 1 名）, 5 分（前 2 名）, 2 分（前 3 名）]
// 平衡重建版：每尊圖騰在三個分數位置各出現 3 次；第 1、3、19、20 張與官方規則範例相同。
const TARGET_CARDS = [
  ['purple', 'blue', 'grey'],
  ['yellow', 'grey', 'purple'],
  ['grey', 'purple', 'red'],
  ['pink', 'purple', 'blue'],
  ['purple', 'yellow', 'pink'],
  ['red', 'pink', 'purple'],
  ['blue', 'brown', 'purple'],
  ['brown', 'purple', 'yellow'],
  ['purple', 'red', 'brown'],
  ['grey', 'green', 'blue'],
  ['yellow', 'grey', 'green'],
  ['green', 'red', 'grey'],
  ['blue', 'pink', 'green'],
  ['green', 'yellow', 'pink'],
  ['pink', 'green', 'red'],
  ['green', 'blue', 'brown'],
  ['brown', 'green', 'yellow'],
  ['red', 'brown', 'green'],
  ['blue', 'grey', 'orange'],
  ['orange', 'yellow', 'grey'],
  ['grey', 'orange', 'red'],
  ['orange', 'blue', 'pink'],
  ['pink', 'orange', 'yellow'],
  ['red', 'pink', 'orange'],
  ['brown', 'orange', 'blue'],
  ['yellow', 'brown', 'orange'],
  ['orange', 'red', 'brown'],
];

const TARGET_POINTS = [9, 5, 2];

const CARD_TYPES = {
  up1: { name: '上升 1', desc: '任選一尊往上 1 格' },
  up2: { name: '上升 2', desc: '任選一尊往上 2 格' },
  up3: { name: '上升 3', desc: '任選一尊往上 3 格' },
  topple: { name: '推到底', desc: '任選一尊移到最底部' },
  toast: { name: '燒毀', desc: '移除最底部那尊，每局第一張不能出' },
  swap: { name: '交換', desc: '任選兩尊交換位置' },
  down2: { name: '下降 2', desc: '任選一尊往下 2 格' },
};

// 基本手牌（兩人）：上升 1 ×2、上升 2、上升 3、推到底、燒毀 ×2，共 7 張。
// 三、四人時移除一張上升 1。手牌組成若與實體遊戲不同，只要改這裡。
const BASE_HAND = ['up1', 'up1', 'up2', 'up3', 'topple', 'toast', 'toast'];
const VARIANT_EXTRA = ['swap', 'down2'];

function buildHand(playerCount, variant, rng) {
  const types = BASE_HAND.slice();
  if (playerCount >= 3) types.splice(types.indexOf('up1'), 1);
  if (variant) {
    types.push(...VARIANT_EXTRA);
    // 變體：洗混自己的牌，隨機移除兩張
    for (let i = 0; i < 2; i++) types.splice(Math.floor(rng() * types.length), 1);
  }
  return types.map((type, i) => ({ uid: `${type}-${i}`, type }));
}

module.exports = { GROUPS, TIKIS, TARGET_CARDS, TARGET_POINTS, CARD_TYPES, BASE_HAND, buildHand };
