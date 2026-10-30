// =============================================================
//  전투 시험판 — 색깔 상자 버전 (쿼터뷰)
//  워프레임 4기가 알아서 싸우고, 플레이어(로터스)는 3번 개입합니다.
// =============================================================

const W = 1280, H = 720;
const WORLD_W = 3400;              // 구역 전체 가로 길이 (카메라가 따라감)
const FLOOR_TOP = 200, FLOOR_BOTTOM = 640; // 걸어다닐 수 있는 바닥 범위
const ADVANCE = 550;               // 웨이브마다 전진하는 거리
const LEASH = 170;                 // 스쿼드 지점에서 이만큼 이상 떨어지지 않음 (근접은 +80)
const SLOTS = [{ x: 40, y: -60 }, { x: -50, y: -20 }, { x: -40, y: 60 }, { x: 50, y: 30 }]; // 대형 위치
const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

// 그림 파일이 있으면 그림, 없으면 색깔 상자
function makeBody(scene, def, w, h) {
  const key = 'img_' + def.id;
  if (scene.textures.exists(key)) {
    const img = scene.add.image(0, 0, key).setOrigin(0.5, 1);
    img.setScale(h / img.height);
    return img;
  }
  const g = scene.add.container(0, 0);
  g.add(scene.add.rectangle(0, -h / 2, w, h, def.color).setStrokeStyle(3, 0x111111));
  g.add(scene.add.rectangle(w * 0.22, -h * 0.82, w * 0.4, 6, 0xffffff)); // 앞쪽 표시(눈)
  return g;
}

// ------------------------------------------------------------- 타이틀
class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }
  preload() {
    this.load.on('loaderror', () => {}); // 그림이 없으면 조용히 넘어감
    const all = [...WARFRAMES, ...Object.entries(GRINEER).map(([id, d]) => ({ ...d, id }))];
    all.forEach(d => this.load.image('img_' + d.id, 'assets/' + d.image));
    this.load.image('img_background', 'assets/background.png');
  }
  create() {
    this.add.rectangle(0, 0, W, H, 0x0b0f1a).setOrigin(0);
    this.add.text(W / 2, 230, '내 말 듣고 있니, 텐노?', { fontFamily: FONT, fontSize: 64, color: '#e8f1ff', fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(W / 2, 300, 'Are You Listening, Tenno?  ·  전투 시험판', { fontFamily: FONT, fontSize: 24, color: '#8fb3d9' }).setOrigin(0.5);
    WARFRAMES.forEach((d, i) => {
      const b = makeBody(this, d, 40, 72);
      b.setPosition(W / 2 - 150 + i * 100, 450);
      this.add.text(W / 2 - 150 + i * 100, 465, d.name, { fontFamily: FONT, fontSize: 16, color: '#ccd' }).setOrigin(0.5, 0);
    });
    const btn = this.add.text(W / 2, 560, '  임무 시작  ', { fontFamily: FONT, fontSize: 30, color: '#0b0f1a', backgroundColor: '#7fd1ff', padding: { x: 16, y: 10 } })
      .setOrigin(0.5).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.scene.start('Battle'));
    this.input.keyboard.once('keydown-ENTER', () => this.scene.start('Battle'));
    this.add.text(W / 2, H - 24, '비공식 팬게임입니다. Digital Extremes 및 Warframe과 관련이 없습니다.', { fontFamily: FONT, fontSize: 14, color: '#667' }).setOrigin(0.5);
  }
}

// ------------------------------------------------------------- 전투 (쿼터뷰)
// 땅은 위에서 비스듬히 내려다본 평면입니다. 유닛은 (x, y) 위를 움직이고,
// z는 점프 높이입니다. 스쿼드는 웨이브를 막을 때마다 오른쪽으로 전진하고 카메라가 따라갑니다.
class BattleScene extends Phaser.Scene {
  constructor() { super('Battle'); }

  create() {
    this.timeMul = 1;
    this.units = [];
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.waveIndex = -1;
    this.waveDelay = 2.5;
    this.lotusPoints = RULES.lotusPoints;
    this.focusTarget = null;
    this.ended = false;
    this.elapsed = 0;
    this.objective = { x: 400, y: (FLOOR_TOP + FLOOR_BOTTOM) / 2 }; // 스쿼드가 지킬 지점
    this.anchor = { ...this.objective };

    this.drawWorld();
    this.cameras.main.setBounds(0, 0, WORLD_W, H);

    this.frames = WARFRAMES.map((d, i) => this.addUnit('tenno', d, 260 + SLOTS[i].x, this.objective.y + SLOTS[i].y));
    this.cameras.main.scrollX = 0;

    const before = this.children.list.length;
    this.buildHud();
    this.children.list.slice(before).forEach(o => o.setScrollFactor(0)); // 화면 위 정보는 카메라를 따라가지 않음
    this.say('로터스', '텐노, 그리너 시설 안으로 진입한다. 앞으로 나아가라.');
  }

  // ---------------- 바닥과 벽
  drawWorld() {
    if (this.textures.exists('img_background')) {
      const src = this.textures.get('img_background').getSourceImage();
      const bg = this.add.tileSprite(0, 0, WORLD_W, H, 'img_background').setOrigin(0).setDepth(-10);
      bg.setTileScale(H / src.height);
      return;
    }
    if (!this.textures.exists('floor_tile')) {
      const t = this.make.graphics({}, false);
      // 비스듬히 본 바닥 타일(마름모 무늬)
      t.fillStyle(0x3a3f47, 1).fillRect(0, 0, 128, 64);
      t.lineStyle(2, 0x4a515b, 1);
      t.beginPath(); t.moveTo(0, 32); t.lineTo(64, 0); t.lineTo(128, 32); t.lineTo(64, 64); t.closePath(); t.strokePath();
      t.fillStyle(0x434952, 1).fillRect(60, 28, 8, 8);
      t.generateTexture('floor_tile', 128, 64);
      t.clear();
      // 뒤쪽 벽
      t.fillStyle(0x232a38, 1).fillRect(0, 0, 256, FLOOR_TOP);
      t.fillStyle(0x2d3647, 1).fillRect(0, FLOOR_TOP - 40, 256, 40);
      t.fillStyle(0x1b2130, 1).fillRect(20, 40, 60, FLOOR_TOP - 90).fillRect(150, 60, 80, FLOOR_TOP - 110);
      t.fillStyle(0xff9f43, 0.6).fillRect(40, FLOOR_TOP - 30, 24, 6).fillRect(180, FLOOR_TOP - 30, 24, 6);
      t.generateTexture('wall_tile', 256, FLOOR_TOP);
      t.destroy();
    }
    this.add.tileSprite(0, 0, WORLD_W, FLOOR_TOP, 'wall_tile').setOrigin(0).setDepth(-10);
    this.add.tileSprite(0, FLOOR_TOP, WORLD_W, H - FLOOR_TOP, 'floor_tile').setOrigin(0).setDepth(-10);
    // 엄폐물(장식) — 그리너 상자와 기둥
    for (let x = 500; x < WORLD_W; x += 380 + (x * 7 % 160)) {
      const y = FLOOR_TOP + 60 + (x * 13 % (FLOOR_BOTTOM - FLOOR_TOP - 120));
      this.add.ellipse(x, y, 70, 22, 0x000000, 0.3).setDepth(y - 1);
      this.add.rectangle(x, y - 22, 60, 44, 0x5b4a36).setStrokeStyle(3, 0x2b2218).setDepth(y);
      this.add.rectangle(x, y - 44, 60, 14, 0x6e5a42).setDepth(y);
    }
  }

  // ---------------- 유닛 만들기
  addUnit(team, def, x, y) {
    const isT = team === 'tenno';
    const w = def.w || 40, h = def.h || 72;
    const u = {
      team, def, x, y, z: 0, w, h,
      hpMax: def.hp, hp: def.hp,
      shieldMax: def.shield || 0, shield: def.shield || 0,
      armor: def.armor, energy: isT ? 50 : 0,
      facing: isT ? 1 : -1, atkTimer: Math.random() * 0.5,
      cd: [0, 0], stun: 0, sinceHit: 99, jump: null, jumpCd: 0, escapeCd: 0, trailT: 0,
      buff: { speed: 0, roar: 0, focus: 0 }, ironSkin: 0,
      downed: false, dead: false, bleed: 0, reviveProg: 0,
      rangeFactor: isT ? 0.85 : 0.55 + Math.random() * 0.35,
      stats: { dmg: 0, kills: 0, downs: 0, revives: 0, casts: 0 },
    };
    u.shadow = this.add.ellipse(x, y, w * 1.3, w * 0.45, 0x000000, 0.35);
    u.view = this.add.container(x, y);
    u.body = makeBody(this, def, w, h);
    u.view.add(u.body);
    u.hpBar = this.add.rectangle(-w / 2, -h - 10, w, 4, isT ? 0x4cd964 : 0xff4b3e).setOrigin(0, 0.5);
    u.view.add(this.add.rectangle(-w / 2, -h - 10, w, 4, 0x000000, 0.6).setOrigin(0, 0.5));
    u.view.add(u.hpBar);
    if (isT) {
      u.shBar = this.add.rectangle(-w / 2, -h - 16, w, 4, 0x5ac8fa).setOrigin(0, 0.5);
      u.view.add(u.shBar);
      u.skinFx = this.add.rectangle(0, -h / 2, w + 10, h + 10).setStrokeStyle(3, 0xd4a017).setVisible(false);
      u.view.add(u.skinFx);
    }
    u.stunFx = this.add.text(0, -h - 34, '✦ 기절', { fontFamily: FONT, fontSize: 12, color: '#ffe066' }).setOrigin(0.5).setVisible(false);
    u.view.add(u.stunFx);
    u.label = this.add.text(0, -h - 30, '', { fontFamily: FONT, fontSize: 12, color: '#fff', backgroundColor: '#000a' }).setOrigin(0.5).setVisible(false);
    u.view.add(u.label);
    this.units.push(u);
    return u;
  }

  alive(team) { return this.units.filter(u => u.team === team && !u.dead && !u.downed); }
  dist(a, b) { return Math.hypot(a.x - b.x, (a.y - b.y) * 1.6); } // 세로는 비스듬히 본 만큼 멀게 계산
  nearest(u, list) {
    let best = null, bd = 1e9;
    for (const o of list) { const d = this.dist(u, o); if (d < bd) { bd = d; best = o; } }
    return best;
  }
  within(p, r, list) { return list.filter(o => this.dist(p, o) <= r); }

  // ---------------- 피해 처리
  hurt(target, amount, src, opts = {}) {
    if (target.dead || target.downed || this.ended) return;
    let dmg = amount;
    if (src && src.team === 'tenno') {
      if (src.buff.roar > 0) dmg *= 1.5;
      if (src.buff.focus > 0 && target === this.focusTarget) dmg *= 1.3;
    }
    let dealt = 0;
    if (target.team === 'tenno') {
      if (target.ironSkin > 0) { const a = Math.min(target.ironSkin, dmg); target.ironSkin -= a; dmg -= a; }
      const s = Math.min(target.shield, dmg); target.shield -= s; dmg -= s; dealt += s; // 실드는 방어력 무시
      const h = armorReduce(dmg, target.armor); target.hp -= h; dealt += h;
      target.sinceHit = 0;
    } else {
      const h = armorReduce(dmg, target.armor); target.hp -= h; dealt = h;
    }
    if (src) src.stats.dmg += dealt;
    if (dealt >= 1 && (opts.big || target.team === 'grineer')) this.floatText(target, Math.round(dealt), opts.big ? '#ffd23f' : '#ffffff', opts.big);
    if (target.hp <= 0) target.team === 'tenno' ? this.down(target) : this.kill(target, src);
  }

  down(u) {
    u.hp = 0; u.downed = true; u.jump = null; u.z = 0; u.bleed = RULES.bleedout; u.stats.downs++;
    u.body.setAngle(-90 * u.facing); u.body.setAlpha(0.7);
    this.say('오르디스', `${u.def.name}가 쓰러졌습니다! 누가 좀 일으켜 주세요!`);
    if (this.alive('tenno').length === 0) this.endMission('fail');
  }

  revive(u, by) {
    u.downed = false; u.hp = u.hpMax * RULES.reviveHpRatio; u.reviveProg = 0;
    u.body.setAngle(0); u.body.setAlpha(1); u.label.setVisible(false);
    if (by) { by.stats.revives++; this.say('오르디스', `${by.def.name}가 ${u.def.name}를 일으켰습니다.`); }
  }

  kill(u, src) {
    u.dead = true;
    if (src) src.stats.kills++;
    if (this.focusTarget === u) this.focusTarget = null;
    u.shadow.destroy();
    this.tweens.add({ targets: u.view, alpha: 0, duration: 300, onComplete: () => u.view.destroy() });
  }

  // ---------------- 연출
  tracer(a, b, color, width = 2) {
    const ln = this.add.line(0, 0, a.x + a.facing * a.w / 2, a.y - a.z - a.h * 0.6, b.x, b.y - b.z - b.h * 0.5, color).setOrigin(0).setLineWidth(width).setDepth(5000);
    this.tweens.add({ targets: ln, alpha: 0, duration: 120, onComplete: () => ln.destroy() });
  }

  ring(x, y, r, color) {
    const c = this.add.circle(x, y, 10, color, 0.2).setStrokeStyle(3, color).setScale(1, 0.6).setDepth(y - 2);
    this.tweens.add({ targets: c, radius: r, alpha: 0, duration: 450, onComplete: () => c.destroy() });
  }

  floatText(u, txt, color, big) {
    const t = this.add.text(u.x + (Math.random() - 0.5) * 20, u.y - u.z - u.h - 20, txt, { fontFamily: FONT, fontSize: big ? 20 : 13, color, fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(5100);
    this.tweens.add({ targets: t, y: t.y - 30, alpha: 0, duration: 700, onComplete: () => t.destroy() });
  }

  castText(u, name) {
    const t = this.add.text(u.x, u.y - u.z - u.h - 46, name, { fontFamily: FONT, fontSize: 16, color: '#7fd1ff', fontStyle: 'bold', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5).setDepth(5200);
    this.tweens.add({ targets: t, y: t.y - 20, alpha: 0, delay: 500, duration: 500, onComplete: () => t.destroy() });
  }

  swing(u, target) {
    const ang = Phaser.Math.RadToDeg(Math.atan2(target.y - u.y, target.x - u.x));
    const s = this.add.arc(u.x, u.y - u.z - u.h * 0.5, 40, ang - 60, ang + 60, false).setStrokeStyle(4, 0xbfe9ff).setDepth(5000);
    this.tweens.add({ targets: s, alpha: 0, duration: 150, onComplete: () => s.destroy() });
  }

  say(who, line) {
    this.sayBox.setText(`${who}: ${line}`).setAlpha(1);
    this.sayTimer = 4;
  }

  // ---------------- 움직임
  moveToward(u, tx, ty, mul, dt) {
    const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
    if (d < 1) return;
    const step = Math.min(d, u.def.speed * mul * dt);
    u.x += dx / d * step; u.y += dy / d * step;
    if (Math.abs(dx) > 2) u.facing = Math.sign(dx);
    this.clampFloor(u);
  }

  clampFloor(u) {
    u.x = Phaser.Math.Clamp(u.x, 20, WORLD_W - 20);
    u.y = Phaser.Math.Clamp(u.y, FLOOR_TOP + 20, FLOOR_BOTTOM);
  }

  // 같은 편끼리 겹치지 않게 살짝 밀어냄
  separate(u, list, dt) {
    for (const o of list) {
      if (o === u) continue;
      const dx = u.x - o.x, dy = u.y - o.y, d = Math.hypot(dx, dy);
      if (d > 0 && d < 34) { u.x += dx / d * 60 * dt; u.y += dy / d * 60 * dt; }
    }
  }

  // ---------------- 불릿 점프
  tryJump(u, tx, ty) {
    if (u.jumpCd > 0 || u.stun > 0) return false;
    const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
    if (d < 60) return false;
    const len = Math.min(d, 340);
    const toX = Phaser.Math.Clamp(u.x + dx / d * len, 20, WORLD_W - 20);
    const toY = Phaser.Math.Clamp(u.y + dy / d * len, FLOOR_TOP + 20, FLOOR_BOTTOM);
    u.facing = Math.sign(dx) || u.facing;
    u.jump = { t: 0, dur: 0.4 + len / 900, fromX: u.x, fromY: u.y, toX, toY, peak: 50 + len * 0.3 };
    u.jumpCd = 1.5;
    u.body.setAngle(u.facing * 18);
    return true;
  }

  updateJump(u, dt, enemies) {
    const j = u.jump;
    j.t = Math.min(1, j.t + dt / j.dur);
    u.x = j.fromX + (j.toX - j.fromX) * j.t;
    u.y = j.fromY + (j.toY - j.fromY) * j.t;
    u.z = Math.sin(Math.PI * j.t) * j.peak;
    u.trailT -= dt;
    if (u.trailT <= 0) {
      u.trailT = 0.04;
      const g = this.add.rectangle(u.x, u.y - u.z - u.h / 2, u.w, u.h, u.def.color, 0.35).setAngle(u.facing * 18).setDepth(u.y - 1);
      this.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
    }
    if (j.t >= 1) {
      u.jump = null; u.z = 0;
      u.body.setAngle(0);
      const d = this.add.ellipse(u.x, u.y, 20, 8, 0xcfd8e3, 0.6).setDepth(u.y - 1);
      this.tweens.add({ targets: d, scaleX: 3, scaleY: 3, alpha: 0, duration: 250, onComplete: () => d.destroy() });
      if (u.def.weapon.range < 100) { // 근접 프레임은 착지하며 내려찍기
        const hit = this.within(u, 90, enemies);
        if (hit.length) { this.ring(u.x, u.y, 90, 0xbfe9ff); hit.forEach(e => this.hurt(e, 45, u)); }
      }
    }
  }

  // ---------------- 능력
  tryAbilities(u, enemies) {
    const allies = this.alive('tenno');
    const has = (i) => u.cd[i] <= 0 && u.energy >= u.def.abilities[i].cost;
    const near = (r) => this.within(u, r, enemies);
    switch (u.def.id) {
      case 'excalibur': {
        if (has(1) && near(300).length >= 4) return this.cast(u, 1);
        const t = this.nearest(u, enemies);
        if (has(0) && this.dist(u, t) > 90 && this.dist(u, t) < 320 && this.dist(this.anchor, t) < this.leashOf(u) + 120) return this.cast(u, 0);
        break;
      }
      case 'mag':
        if (has(1) && allies.some(a => a.shield < a.shieldMax * 0.4)) return this.cast(u, 1);
        if (has(0) && near(450).length >= 3) return this.cast(u, 0);
        break;
      case 'volt':
        if (has(1) && enemies.length >= 6) return this.cast(u, 1);
        if (has(0) && near(500).length >= 1) return this.cast(u, 0);
        break;
      case 'rhino':
        if (has(0) && u.ironSkin <= 0 && (near(400).length >= 3 || u.hp < u.hpMax * 0.6)) return this.cast(u, 0);
        if (has(1) && enemies.length >= 5) return this.cast(u, 1);
        break;
    }
    return false;
  }

  cast(u, i, free = false) {
    const ab = u.def.abilities[i];
    if (!free) u.energy -= ab.cost;
    u.cd[i] = ab.cooldown;
    u.stats.casts++;
    this.castText(u, ab.name);
    const enemies = this.alive('grineer');
    const allies = this.alive('tenno');
    const near = (r) => this.within(u, r, enemies);
    switch (ab.id) {
      case 'slashDash': {
        const t = this.nearest(u, enemies); if (!t) break;
        const ang = Math.atan2(t.y - u.y, t.x - u.x);
        const len = Math.min(this.dist(u, t) + 40, 360);
        const from = { x: u.x, y: u.y }, to = { x: u.x + Math.cos(ang) * len, y: u.y + Math.sin(ang) * len };
        // 지나간 선 근처의 적을 모두 벰
        enemies.forEach(e => {
          const l2 = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
          const k = Phaser.Math.Clamp(((e.x - from.x) * (to.x - from.x) + (e.y - from.y) * (to.y - from.y)) / l2, 0, 1);
          if (Math.hypot(e.x - (from.x + k * (to.x - from.x)), e.y - (from.y + k * (to.y - from.y))) < 45) this.hurt(e, 160, u, { big: true });
        });
        const ln = this.add.line(0, 0, from.x, from.y - u.h / 2, to.x, to.y - u.h / 2, 0x7fd1ff).setOrigin(0).setLineWidth(10).setAlpha(0.7).setDepth(5000);
        this.tweens.add({ targets: ln, alpha: 0, duration: 300, onComplete: () => ln.destroy() });
        u.x = to.x; u.y = to.y; this.clampFloor(u);
        u.facing = Math.sign(to.x - from.x) || u.facing;
        break;
      }
      case 'radialBlind':
        this.ring(u.x, u.y, 350, 0xffffff);
        near(350).forEach(e => { e.stun = Math.max(e.stun, 5); });
        break;
      case 'pull':
        this.ring(u.x, u.y, 450, 0xe066c8);
        near(450).forEach(e => {
          const a = Math.atan2(e.y - u.y, e.x - u.x), r = 50 + Math.random() * 40;
          e.x = u.x + Math.cos(a) * r; e.y = u.y + Math.sin(a) * r * 0.6; this.clampFloor(e);
          e.stun = Math.max(e.stun, 1.5);
          this.hurt(e, 90, u, { big: true });
        });
        break;
      case 'polarize':
        this.ring(u.x, u.y, 400, 0x5ac8fa);
        allies.forEach(a => { a.shield = a.shieldMax; });
        near(400).forEach(e => this.hurt(e, 60, u, { big: true }));
        break;
      case 'shock': {
        const t = this.nearest(u, enemies); if (!t) break;
        const hit = [t]; let last = t;
        for (let k = 0; k < 3; k++) {
          const next = this.nearest(last, enemies.filter(e => !hit.includes(e) && this.dist(e, last) < 220));
          if (!next) break; hit.push(next); last = next;
        }
        let prev = u;
        hit.forEach(e => { this.tracer(prev, e, 0xfff275, 4); prev = e; e.stun = Math.max(e.stun, 1); this.hurt(e, 110, u, { big: true }); });
        break;
      }
      case 'speed':
        this.ring(u.x, u.y, 600, 0xf5d142);
        allies.forEach(a => { a.buff.speed = 8; });
        break;
      case 'ironSkin':
        u.ironSkin = 700;
        break;
      case 'roar':
        this.ring(u.x, u.y, 600, 0xd35400);
        allies.forEach(a => { a.buff.roar = 10; });
        break;
    }
    return true;
  }

  leashOf(u) { return u.def.weapon.range < 100 ? LEASH + 80 : LEASH; }

  // 스쿼드가 모일 곳: 쓰러진 동료가 있으면 그 자리, 아니면 지킬 지점
  squadAnchor() {
    const downed = this.frames.filter(f => f.downed);
    if (downed.length) { const d = downed.reduce((a, b) => (b.bleed < a.bleed ? b : a)); return { x: d.x, y: d.y }; }
    return this.objective;
  }

  // ---------------- 워프레임 생각하기
  thinkTenno(u, dt) {
    if (u.downed) {
      u.bleed -= dt;
      u.label.setVisible(true).setText(u.reviveProg > 0 ? `부활 중 ${Math.round(u.reviveProg / RULES.reviveTime * 100)}%` : `쓰러짐 ${Math.ceil(u.bleed)}초`);
      if (u.bleed <= 0) {
        u.downed = false; u.dead = true; u.label.setText('사망');
        u.body.setAlpha(0.3);
        this.say('로터스', `${u.def.name}를 잃었다…`);
      }
      return;
    }
    if (u.stun > 0 && !u.jump) return;

    const enemies = this.alive('grineer');
    const speedMul = u.buff.speed > 0 ? 1.5 : 1;
    u.jumpCd -= dt * speedMul;
    u.escapeCd -= dt;
    if (u.jump) this.updateJump(u, dt * speedMul, enemies);
    else this.separate(u, this.alive('tenno'), dt);

    // 1) 쓰러진 동료가 있으면 가장 가까운 사람이 걸어가서 부활
    for (const d of this.frames.filter(o => o.downed)) {
      if (this.nearest(d, this.alive('tenno')) !== u) continue;
      if (u.jump) return;
      if (this.dist(u, d) > 30) { this.moveToward(u, d.x, d.y, speedMul, dt); return; }
      d.reviveProg += dt;
      if (d.reviveProg >= RULES.reviveTime) this.revive(d, u);
      return;
    }

    const slot = SLOTS[WARFRAMES.indexOf(u.def)];
    if (enemies.length === 0) {
      // 전투가 없으면 다음 지점으로 전진 (멀면 20% 확률로 불릿 점프)
      if (u.jump) return;
      this.approach(u, this.anchor.x + slot.x, this.anchor.y + slot.y, speedMul, dt);
      return;
    }

    // 2) 능력
    if (!u.jump && this.tryAbilities(u, enemies)) return;

    // 3) 사격/근접
    const target = (this.focusTarget && !this.focusTarget.dead && u.buff.focus > 0) ? this.focusTarget : this.nearest(u, enemies);
    const dist = this.dist(u, target);
    const range = u.def.weapon.range;
    u.facing = Math.sign(target.x - u.x) || u.facing;

    if (!u.jump) {
      if (u.hp < u.hpMax * 0.3 && u.escapeCd <= 0 && dist < 130) {
        // 체력이 바닥인데 적이 붙어 있으면 반대쪽으로 불릿 점프해서 도망
        u.escapeCd = 5; u.jumpCd = 0;
        const a = Math.atan2(u.y - target.y, u.x - target.x);
        this.tryJump(u, u.x + Math.cos(a) * 320, u.y + Math.sin(a) * 320);
      } else {
        // 사거리 밖이면 적 쪽으로, 단 스쿼드 지점에서 너무 멀어지지 않게
        let want = dist > range * u.rangeFactor ? { x: target.x, y: target.y } : { x: u.x, y: u.y };
        const L = this.leashOf(u), ax = this.anchor.x + slot.x * 0.5, ay = this.anchor.y + slot.y * 0.5;
        const off = Math.hypot(want.x - ax, want.y - ay);
        if (off > L) want = { x: ax + (want.x - ax) / off * L, y: ay + (want.y - ay) / off * L };
        this.approach(u, want.x, want.y, speedMul, dt);
      }
    }

    if (dist <= range) {
      u.atkTimer -= dt * speedMul;
      if (u.atkTimer <= 0) {
        u.atkTimer = u.def.weapon.fireRate;
        if (range < 100) {
          this.within(target, 50, enemies).forEach(e => this.hurt(e, u.def.weapon.damage, u)); // 근접: 주변 적 여러 명을 벰
          this.swing(u, target);
        } else {
          this.tracer(u, target, u.def.color);
          this.hurt(target, u.def.weapon.damage * (0.9 + Math.random() * 0.2), u);
        }
      }
    }
  }

  // 목표 지점으로 이동. 멀리 가야 할 때는 처음 한 번 20% 확률로 불릿 점프
  approach(u, tx, ty, mul, dt) {
    const d = Math.hypot(tx - u.x, ty - u.y);
    if (d > 70) {
      if (u.approachJump === undefined) u.approachJump = Math.random() < RULES.approachJumpChance;
      if (u.approachJump && this.tryJump(u, tx, ty)) { u.approachJump = false; return; }
      this.moveToward(u, tx, ty, mul, dt);
    } else {
      u.approachJump = undefined;
      if (d > 8) this.moveToward(u, tx, ty, mul, dt);
    }
  }

  // ---------------- 그리너 생각하기
  thinkGrineer(u, dt) {
    if (u.stun > 0) return;
    const foes = this.alive('tenno');
    if (foes.length === 0) return;
    this.separate(u, this.alive('grineer'), dt);
    const target = this.nearest(u, foes);
    const dist = this.dist(u, target);
    const range = u.def.weapon.range;
    u.facing = Math.sign(target.x - u.x) || u.facing;
    const cam = this.cameras.main;
    const onScreen = u.x > cam.scrollX + 20 && u.x < cam.scrollX + W - 20;
    if (dist > range * u.rangeFactor || !onScreen) this.moveToward(u, target.x, target.y, 1, dt);
    if (dist <= range && onScreen) {
      u.atkTimer -= dt;
      if (u.atkTimer <= 0) {
        u.atkTimer = u.def.weapon.fireRate * (0.9 + Math.random() * 0.3);
        if (range < 100) {
          this.swing(u, target);
          if (target.z < 40) this.hurt(target, u.def.weapon.damage, u);
        } else if (Math.random() < (target.z > 10 ? 0.25 : 0.65)) { // 공중에 뜬 워프레임은 잘 안 맞음
          this.tracer(u, target, 0xff9f43, 1);
          this.hurt(target, u.def.weapon.damage, u);
        }
      }
    }
  }

  // ---------------- 웨이브
  nextWave() {
    this.waveIndex++;
    if (this.waveIndex >= WAVES.length) return this.endMission('win');
    if (this.waveIndex > 0) {
      // 다음 구역으로 전진
      this.objective = { x: Math.min(WORLD_W - 500, this.objective.x + ADVANCE), y: FLOOR_TOP + 120 + Math.random() * (FLOOR_BOTTOM - FLOOR_TOP - 200) };
    }
    WAVES[this.waveIndex].forEach(g => { for (let i = 0; i < g.count; i++) this.spawnQueue.push({ type: g.type, side: g.side || 'right' }); });
    Phaser.Utils.Array.Shuffle(this.spawnQueue);
    this.spawnTimer = this.waveIndex > 0 ? 2.5 : 0; // 전진할 시간
    this.waveText.setText(`웨이브 ${this.waveIndex + 1} / ${WAVES.length}`);
    const lines = ['그리너 병력 접근 중.', '앞으로 나아가라. 적 증원이다.', '뒤쪽에서도 온다! 조심해라.', '헤비 거너 확인. 방어력이 높다.', '마지막 물결이다, 텐노.'];
    this.say('로터스', lines[this.waveIndex] || '적이 온다.');
  }

  spawnOne(s) {
    const def = { ...GRINEER[s.type], id: s.type };
    const x = s.side === 'left' ? this.objective.x - W / 2 - 80 : this.objective.x + W / 2 + 80;
    const y = FLOOR_TOP + 30 + Math.random() * (FLOOR_BOTTOM - FLOOR_TOP - 30);
    this.addUnit('grineer', def, Phaser.Math.Clamp(x, 10, WORLD_W - 10), y);
  }

  // ---------------- 로터스 개입
  lotus(cmd) {
    if (this.ended) return;
    if (cmd === 'retreat') return this.endMission('retreat');
    if (this.lotusPoints <= 0) { this.say('로터스', '더는 지원할 수 없다. 알아서 버텨라.'); return; }
    const frames = this.frames.filter(f => !f.dead);
    if (cmd === 'focus') {
      const enemies = this.alive('grineer');
      if (!enemies.length) return;
      this.focusTarget = enemies.reduce((a, b) => (b.hp > a.hp ? b : a));
      frames.forEach(f => { f.buff.focus = 8; });
      this.say('로터스', `${this.focusTarget.def.name}를 먼저 처리해라. …내 말 듣고 있니, 텐노?`);
    } else if (cmd === 'supply') {
      frames.forEach(f => {
        if (f.downed) this.revive(f, null);
        f.hp = f.hpMax; f.shield = f.shieldMax; f.energy = Math.min(f.def.energyMax, f.energy + 50);
      });
      this.ring(this.anchor.x, this.anchor.y, 600, 0x4cd964);
      this.say('로터스', '보급품을 투하했다. 쓰러진 자도 일으켜라.');
    } else if (cmd === 'ult') {
      this.alive('tenno').forEach(f => { f.energy = f.def.energyMax; f.cd = [0, 0]; this.cast(f, 1, true); });
      this.say('로터스', '지금이다, 텐노. 전부 쏟아부어라!');
    }
    this.lotusPoints--;
    this.refreshLotusButtons();
  }

  // ---------------- 화면 위 정보
  buildHud() {
    this.hud = this.frames.map((f, i) => {
      const x = 16 + i * 230, y = 12;
      this.add.rectangle(x, y, 220, 78, 0x000000, 0.55).setOrigin(0).setStrokeStyle(2, f.def.color).setDepth(9000);
      const name = this.add.text(x + 8, y + 4, f.def.name, { fontFamily: FONT, fontSize: 16, color: '#fff', fontStyle: 'bold' }).setDepth(9001);
      const state = this.add.text(x + 212, y + 6, '', { fontFamily: FONT, fontSize: 12, color: '#ffd23f' }).setOrigin(1, 0).setDepth(9001);
      const bar = (yy, col) => {
        this.add.rectangle(x + 8, y + yy, 204, 10, 0x222222).setOrigin(0).setDepth(9001);
        return this.add.rectangle(x + 8, y + yy, 204, 10, col).setOrigin(0).setDepth(9002);
      };
      return { name, state, sh: bar(28, 0x5ac8fa), hp: bar(42, 0x4cd964), en: bar(56, 0x9b59b6) };
    });
    this.waveText = this.add.text(W - 16, 14, '준비 중', { fontFamily: FONT, fontSize: 22, color: '#fff', fontStyle: 'bold' }).setOrigin(1, 0).setDepth(9000);
    this.speedBtn = this.add.text(W - 16, 48, '속도 x1', { fontFamily: FONT, fontSize: 16, color: '#0b0f1a', backgroundColor: '#cfd8e3', padding: { x: 8, y: 4 } })
      .setOrigin(1, 0).setDepth(9000).setInteractive({ useHandCursor: true });
    this.speedBtn.on('pointerdown', () => {
      this.timeMul = this.timeMul >= 3 ? 1 : this.timeMul + 1;
      this.tweens.timeScale = this.timeMul;
      this.speedBtn.setText('속도 x' + this.timeMul);
    });

    this.sayBox = this.add.text(W / 2, 100, '', { fontFamily: FONT, fontSize: 18, color: '#e8f1ff', backgroundColor: '#0b0f1acc', padding: { x: 12, y: 6 } }).setOrigin(0.5, 0).setDepth(9000);

    const cmds = [['focus', '집중 공격'], ['supply', '긴급 보급'], ['ult', '궁극기 발동'], ['retreat', '후퇴']];
    this.add.rectangle(0, H - 64, W, 64, 0x000000, 0.5).setOrigin(0).setDepth(8999);
    this.add.text(16, H - 52, '로터스 개입', { fontFamily: FONT, fontSize: 14, color: '#8fb3d9' }).setDepth(9000);
    this.pointsText = this.add.text(16, H - 32, '', { fontFamily: FONT, fontSize: 18, color: '#7fd1ff', fontStyle: 'bold' }).setDepth(9000);
    this.lotusBtns = cmds.map(([id, label], i) => {
      const b = this.add.text(160 + i * 170, H - 32, `${i + 1}. ${label}`, { fontFamily: FONT, fontSize: 18, color: '#0b0f1a', backgroundColor: id === 'retreat' ? '#e0a0a0' : '#7fd1ff', padding: { x: 12, y: 8 } })
        .setOrigin(0, 0.5).setDepth(9000).setInteractive({ useHandCursor: true });
      b.on('pointerdown', () => this.lotus(id));
      this.input.keyboard.on('keydown-' + ['ONE', 'TWO', 'THREE', 'FOUR'][i], () => this.lotus(id));
      b.cmd = id;
      return b;
    });
    this.add.text(W - 16, H - 20, '비공식 팬게임 · Digital Extremes와 무관', { fontFamily: FONT, fontSize: 12, color: '#889' }).setOrigin(1, 0.5).setDepth(9000);
    this.refreshLotusButtons();
  }

  refreshLotusButtons() {
    this.pointsText.setText('◆'.repeat(this.lotusPoints) + '◇'.repeat(RULES.lotusPoints - this.lotusPoints));
    this.lotusBtns.forEach(b => { if (b.cmd !== 'retreat') b.setAlpha(this.lotusPoints > 0 ? 1 : 0.4); });
  }

  updateHud() {
    this.frames.forEach((f, i) => {
      const h = this.hud[i];
      h.sh.width = 204 * (f.shield / f.shieldMax);
      h.hp.width = 204 * Math.max(0, f.hp / f.hpMax);
      h.en.width = 204 * (f.energy / f.def.energyMax);
      const tags = [];
      if (f.dead) tags.push('사망');
      else if (f.downed) tags.push(`쓰러짐 ${Math.ceil(f.bleed)}`);
      if (f.ironSkin > 0) tags.push('아이언 스킨');
      if (f.buff.speed > 0) tags.push('스피드');
      if (f.buff.roar > 0) tags.push('로어');
      h.state.setText(tags.join(' · '));
      h.name.setAlpha(f.dead ? 0.4 : 1);
    });
  }

  // ---------------- 매 프레임
  update(_t, delta) {
    if (this.ended) return;
    const dt = Math.min(delta / 1000, 0.05) * this.timeMul;
    this.elapsed += dt;

    if (this.sayTimer > 0) { this.sayTimer -= dt; if (this.sayTimer <= 0) this.tweens.add({ targets: this.sayBox, alpha: 0, duration: 400 }); }

    if (this.spawnQueue.length) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) { this.spawnOne(this.spawnQueue.shift()); this.spawnTimer = 0.3; }
    } else if (this.alive('grineer').length === 0) {
      this.waveDelay -= dt;
      if (this.waveDelay <= 0) { this.waveDelay = 3; this.nextWave(); if (this.ended) return; }
    }

    this.anchor = this.squadAnchor();
    for (const u of this.units) {
      if (u.dead && u.team === 'grineer') continue;
      u.stun = Math.max(0, u.stun - dt);
      u.cd = u.cd.map(c => Math.max(0, c - dt));
      for (const k in u.buff) u.buff[k] = Math.max(0, u.buff[k] - dt);
      if (u.team === 'tenno' && !u.dead && !u.downed) {
        u.sinceHit += dt;
        u.energy = Math.min(u.def.energyMax, u.energy + RULES.energyRegen * dt);
        if (u.sinceHit > RULES.shieldRegenDelay) u.shield = Math.min(u.shieldMax, u.shield + u.shieldMax * RULES.shieldRegenRate * dt);
      }
      if (u.team === 'tenno') { if (!u.dead) this.thinkTenno(u, dt); } else this.thinkGrineer(u, dt);
      if (this.ended) return;

      // 그리기: 그림자는 땅에, 몸은 점프 높이만큼 위로. 아래쪽에 있을수록 앞에 그림
      u.shadow.setPosition(u.x, u.y).setDepth(u.y - 1).setScale(1 - Math.min(u.z, 150) / 300);
      u.view.setPosition(u.x, u.y - u.z).setDepth(u.y);
      if (!u.downed && !u.dead) u.body.setScale(Math.abs(u.body.scaleX) * u.facing, u.body.scaleY);
      u.hpBar.width = u.w * Math.max(0, u.hp / u.hpMax);
      if (u.shBar) u.shBar.width = u.w * (u.shield / u.shieldMax);
      if (u.skinFx) u.skinFx.setVisible(u.ironSkin > 0);
      u.stunFx.setVisible(u.stun > 0 && !u.dead);
    }
    this.units = this.units.filter(u => !(u.dead && u.team === 'grineer'));

    // 카메라는 스쿼드 가운데를 부드럽게 따라감
    const up = this.frames.filter(f => !f.dead);
    if (up.length) {
      const cx = up.reduce((s, f) => s + f.x, 0) / up.length;
      const cam = this.cameras.main;
      cam.scrollX += (cx - W / 2 - cam.scrollX) * Math.min(1, dt * 2);
    }
    this.updateHud();
  }

  // ---------------- 끝
  endMission(result) {
    if (this.ended) return;
    this.ended = true;
    this.updateHud();
    this.time.delayedCall(600, () => this.scene.start('Result', { result, frames: this.frames, wave: this.waveIndex, time: this.elapsed, used: RULES.lotusPoints - this.lotusPoints }));
  }
}

// ------------------------------------------------------------- 결과 보고서
class ResultScene extends Phaser.Scene {
  constructor() { super('Result'); }
  create(data) {
    this.add.rectangle(0, 0, W, H, 0x0b0f1a).setOrigin(0);
    const titles = { win: ['임무 성공', '#7fd1ff', '잘했다, 텐노. 이번엔 내 말을 들었구나.'],
                     fail: ['임무 실패', '#ff6b6b', '스쿼드가 전멸했다. 장비를 다시 생각해 봐라.'],
                     retreat: ['후퇴', '#e0a0a0', '살아남는 것도 임무다. 다음엔 준비를 더 하자.'] };
    const [title, col, line] = titles[data.result];
    this.add.text(W / 2, 70, title, { fontFamily: FONT, fontSize: 52, color: col, fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(W / 2, 130, `로터스: ${line}`, { fontFamily: FONT, fontSize: 20, color: '#cfd8e3' }).setOrigin(0.5);
    const waves = data.result === 'win' ? WAVES.length : Math.max(0, data.wave);
    this.add.text(W / 2, 170, `막아낸 웨이브 ${waves}/${WAVES.length} · 전투 시간 ${Math.round(data.time)}초 · 로터스 개입 ${data.used}회`, { fontFamily: FONT, fontSize: 16, color: '#8fb3d9' }).setOrigin(0.5);

    const cols = ['워프레임', '준 피해', '처치', '능력 사용', '쓰러짐', '부활시킴', '상태'];
    const xs = [240, 420, 540, 660, 790, 910, 1040];
    cols.forEach((c, i) => this.add.text(xs[i], 230, c, { fontFamily: FONT, fontSize: 18, color: '#8fb3d9' }).setOrigin(0.5));
    const best = Math.max(...data.frames.map(f => f.stats.dmg));
    data.frames.forEach((f, r) => {
      const y = 285 + r * 56;
      this.add.rectangle(W / 2, y, 980, 46, 0x1a2233).setStrokeStyle(2, f.def.color);
      const s = f.stats;
      const vals = [f.def.name, Math.round(s.dmg) + (s.dmg === best ? ' ★' : ''), s.kills, s.casts, s.downs, s.revives, f.dead ? '사망' : '생존'];
      vals.forEach((v, i) => this.add.text(xs[i], y, String(v), { fontFamily: FONT, fontSize: 20, color: '#fff' }).setOrigin(0.5));
    });

    const again = this.add.text(W / 2, 560, '  다시 출격  ', { fontFamily: FONT, fontSize: 28, color: '#0b0f1a', backgroundColor: '#7fd1ff', padding: { x: 16, y: 10 } })
      .setOrigin(0.5).setInteractive({ useHandCursor: true });
    again.on('pointerdown', () => this.scene.start('Battle'));
    this.add.text(W / 2, H - 24, '비공식 팬게임입니다. Digital Extremes 및 Warframe과 관련이 없습니다.', { fontFamily: FONT, fontSize: 14, color: '#667' }).setOrigin(0.5);
  }
}

window.game = new Phaser.Game({
  type: Phaser.AUTO,
  width: W, height: H,
  parent: 'game',
  backgroundColor: '#0b0f1a',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [TitleScene, BattleScene, ResultScene],
});
