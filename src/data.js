// =============================================================
//  게임 데이터 — 숫자를 바꾸면 밸런스가 바뀝니다.
//  image: assets 폴더에 같은 이름의 그림(png)을 넣으면
//         색깔 상자 대신 그 그림이 나옵니다.
// =============================================================

const WARFRAMES = [
  {
    id: 'excalibur', name: '엑스칼리버', color: 0x4a90e2, image: 'excalibur.png',
    hp: 300, shield: 150, armor: 100, speed: 120, energyMax: 150,
    weapon: { name: '스칼라 (근접)', range: 70, damage: 34, fireRate: 0.55 },
    abilities: [
      { id: 'slashDash', name: '슬래시 대시', cost: 25, cooldown: 4 },
      { id: 'radialBlind', name: '래디얼 블라인드', cost: 50, cooldown: 14 },
    ],
  },
  {
    id: 'mag', name: '매그', color: 0xe066c8, image: 'mag.png',
    hp: 260, shield: 260, armor: 65, speed: 110, energyMax: 150,
    weapon: { name: '소마 (소총)', range: 420, damage: 15, fireRate: 0.14 },
    abilities: [
      { id: 'pull', name: '풀', cost: 25, cooldown: 6 },
      { id: 'polarize', name: '폴러라이즈', cost: 50, cooldown: 16 },
    ],
  },
  {
    id: 'volt', name: '볼트', color: 0xf5d142, image: 'volt.png',
    hp: 230, shield: 230, armor: 15, speed: 135, energyMax: 150,
    weapon: { name: '보아 (소총)', range: 380, damage: 13, fireRate: 0.12 },
    abilities: [
      { id: 'shock', name: '쇼크', cost: 25, cooldown: 3 },
      { id: 'speed', name: '스피드', cost: 50, cooldown: 18 },
    ],
  },
  {
    id: 'rhino', name: '라이노', color: 0x9b7a55, image: 'rhino.png',
    hp: 380, shield: 150, armor: 190, speed: 95, energyMax: 150,
    weapon: { name: '헥 (산탄총)', range: 220, damage: 55, fireRate: 0.8 },
    abilities: [
      { id: 'ironSkin', name: '아이언 스킨', cost: 50, cooldown: 20 },
      { id: 'roar', name: '로어', cost: 75, cooldown: 24 },
    ],
  },
];

const GRINEER = {
  lancer:  { name: '랜서',       color: 0xb03a2e, image: 'lancer.png',  hp: 180, armor: 80,  speed: 80,  w: 34, h: 60,
             weapon: { range: 380, damage: 12, fireRate: 1.0 } },
  butcher: { name: '부처',       color: 0xe67e22, image: 'butcher.png', hp: 140, armor: 30,  speed: 160, w: 30, h: 56,
             weapon: { range: 55,  damage: 22, fireRate: 0.8 } },
  heavy:   { name: '헤비 거너',  color: 0x6e2c00, image: 'heavy.png',   hp: 800, armor: 250, speed: 55,  w: 50, h: 76,
             weapon: { range: 420, damage: 8,  fireRate: 0.15 } },
};

// 웨이브: 순서대로 나옵니다. side: 'right' 또는 'left'
const WAVES = [
  [{ type: 'lancer', count: 5 }],
  [{ type: 'lancer', count: 6 }, { type: 'butcher', count: 4 }],
  [{ type: 'butcher', count: 5, side: 'left' }, { type: 'lancer', count: 7 }],
  [{ type: 'heavy', count: 2 }, { type: 'lancer', count: 7 }, { type: 'butcher', count: 5 }],
  [{ type: 'heavy', count: 3 }, { type: 'lancer', count: 9 }, { type: 'butcher', count: 7, side: 'left' }],
];

const RULES = {
  shieldRegenDelay: 3,    // 피해 후 실드가 다시 차기 시작하는 시간(초)
  shieldRegenRate: 0.25,  // 초당 실드 최대치의 몇 % 회복
  energyRegen: 2,         // 초당 에너지 회복
  bleedout: 20,           // 쓰러진 뒤 부활 가능한 시간(초)
  reviveTime: 3,          // 부활에 걸리는 시간(초)
  reviveHpRatio: 0.4,     // 부활 시 체력 비율
  lotusPoints: 3,         // 로터스 개입 횟수
  approachJumpChance: 0.2, // 적에게 다가갈 때 불릿 점프를 쓸 확률
};

// 원작 방어력 공식: 피해 감소 = 방어력 / (방어력 + 300)
function armorReduce(dmg, armor) {
  return dmg * (1 - armor / (armor + 300));
}
