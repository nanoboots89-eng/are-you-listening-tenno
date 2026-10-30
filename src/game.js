// =============================================================
//  전투 시험판 — 색깔 상자 버전
//  워프레임 4기가 알아서 싸우고, 플레이어(로터스)는 3번 개입합니다.
// =============================================================

const W = 1280, H = 720;
const GROUND_Y = 600;              // 발이 닿는 높이
const LANES = [588, 604, 620, 636]; // 워프레임별 서 있는 줄(겹치지 않게)
const LEASH = 150;                 // 스쿼드 중심에서 이만큼 이상 떨어지지 않음 (근접은 +80)
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

// ------------------------------------------------------------- 전투
class BattleScene extends Phaser.Scene {
  constructor() { super('Battle'); }

  create() {
    this.timeMul = 1;
    this.anchorX = 200;
    this.units = [];
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.waveIndex = -1;
    this.waveDelay = 2.5;
    this.lotusPoints = RULES.lotusPoints;
    this.focusTarget = null;
    this.ended = false;
    this.elapsed = 0;

    this.drawBackground();

    this.frames = WARFRAMES.map((d, i) => this.addUnit('tenno', d, 120 + i * 50, LANES[i]));
    this.buildHud();
    this.say('로터스', '텐노, 그리너가 몰려온다. 이 구역을 지켜라.');
  }

  drawBackground() {
    if (this.textures.exists('img_background')) {
      this.add.image(0, 0, 'img_background').setOrigin(0).setDisplaySize(W, H).setDepth(-10);
      return;
    }
    const g = this.add.graphics().setDepth(-10);
    g.fillGradientStyle(0x1a2233, 0x1a2233, 0x2e3a4f, 0x2e3a4f, 1);
    g.fillRect(0, 0, W, GROUND_Y - 30);
    for (let i = 0; i < 9; i++) g.fillStyle(0x253047, 1).fillRect(i * 150 + 20, 250 + (i % 3) * 40, 90, GROUND_Y - 280 - (i % 3) * 40);
    g.fillStyle(0x3b3f45, 1).fillRect(0, GROUND_Y - 30, W, H - GROUND_Y + 30);
    g.lineStyle(2, 0x555b63).lineBetween(0, GROUND_Y - 30, W, GROUND_Y - 30);
  }

  // ---------------- 유닛 만들기
  addUnit(team, def, x, y) {
    const isT = team === 'tenno';
    const w = def.w || 40, h = def.h || 72;
    const u = {
      team, def, x, y, w, h,
      hpMax: def.hp, hp: def.hp,
      shieldMax: def.shield || 0, shield: def.shield || 0,
      armor: def.armor, energy: isT ? 50 : 0,
      facing: isT ? 1 : -1, atkTimer: Math.random() * 0.5,
      cd: [0, 0], stun: 0, sinceHit: 99, z: 0, jump: null, jumpCd: 1 + Math.random(), trailT: 0,
      buff: { speed: 0, roar: 0, focus: 0 }, ironSkin: 0,
      downed: false, dead: false, bleed: 0, reviveProg: 0,
      rangeFactor: isT ? 0.85 : 0.55 + Math.random() * 0.35,
      stats: { dmg: 0, kills: 0, downs: 0, revives: 0, casts: 0 },
    };
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

  nearest(u, list) {
    let best = null, bd = 1e9;
    for (const o of list) { const d = Math.abs(o.x - u.x); if (d < bd) { bd = d; best = o; } }
    return best;
  }

  within(x, r, list) { return list.filter(o => Math.abs(o.x - x) <= r); }

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

  heal(u, amt) { u.hp = Math.min(u.hpMax, u.hp + amt); }

  down(u) {
    u.hp = 0; u.downed = true; u.jump = null; u.z = 0; u.bleed = RULES.bleedout; u.stats.downs++;
    u.body.setAngle(-90 * u.facing); u.body.setAlpha(0.7);
    this.say('오르디스', `${u.def.name}가 쓰러졌습니다! 누가 좀 일으켜 주세요!`);
    const up = this.alive('tenno');
    if (up.length === 0) this.endMission('fail');
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
    this.tweens.add({ targets: u.view, alpha: 0, y: u.y + 10, duration: 300, onComplete: () => u.view.destroy() });
  }

  // ---------------- 연출
  tracer(a, b, color, width = 2) {
    const ln = this.add.line(0, 0, a.x + a.facing * a.w / 2, a.y - a.z - a.h * 0.6, b.x, b.y - b.z - b.h * 0.5, color).setOrigin(0).setLineWidth(width).setDepth(900);
    this.tweens.add({ targets: ln, alpha: 0, duration: 120, onComplete: () => ln.destroy() });
  }

  ring(x, y, r, color) {
    const c = this.add.circle(x, y - 36, 10, color, 0.25).setStrokeStyle(3, color).setDepth(900);
    this.tweens.add({ targets: c, radius: r, alpha: 0, duration: 450, onComplete: () => c.destroy() });
  }

  floatText(u, txt, color, big) {
    const t = this.add.text(u.x + (Math.random() - 0.5) * 20, u.y - u.h - 20, txt, { fontFamily: FONT, fontSize: big ? 20 : 13, color, fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(950);
    this.tweens.add({ targets: t, y: t.y - 30, alpha: 0, duration: 700, onComplete: () => t.destroy() });
  }

  castText(u, name) {
    const t = this.add.text(u.x, u.y - u.h - 46, name, { fontFamily: FONT, fontSize: 16, color: '#7fd1ff', fontStyle: 'bold', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5).setDepth(960);
    this.tweens.add({ targets: t, y: t.y - 20, alpha: 0, delay: 500, duration: 500, onComplete: () => t.destroy() });
  }

  say(who, line) {
    this.sayBox.setText(`${who}: ${line}`).setAlpha(1);
    this.sayTimer = 4;
  }

  // ---------------- 능력
  tryAbilities(u, enemies) {
    const allies = this.alive('tenno');
    const has = (i) => u.cd[i] <= 0 && u.energy >= u.def.abilities[i].cost;
    const near = (r) => this.within(u.x, r, enemies);
    switch (u.def.id) {
      case 'excalibur':
        if (has(1) && near(300).length >= 4) return this.cast(u, 1);
        if (has(0)) {
          const t = this.nearest(u, enemies);
          if (Math.abs(t.x - u.x) > 90 && Math.abs(t.x - u.x) < 320 && Math.abs(t.x - this.anchorX) < this.leashOf(u) + 120) return this.cast(u, 0);
        }
        break;
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
    if (!free) { u.energy -= ab.cost; }
    u.cd[i] = ab.cooldown;
    u.stats.casts++;
    this.castText(u, ab.name);
    const enemies = this.alive('grineer');
    const allies = this.alive('tenno');
    const near = (r) => this.within(u.x, r, enemies);
    switch (ab.id) {
      case 'slashDash': {
        const t = this.nearest(u, enemies); if (!t) break;
        const dir = Math.sign(t.x - u.x) || u.facing;
        const reach = this.leashOf(u) + 120;
        const from = u.x, to = Phaser.Math.Clamp(t.x + dir * 40, Math.max(30, this.anchorX - reach), Math.min(W - 30, this.anchorX + reach));
        enemies.filter(e => (e.x - from) * dir >= -10 && (e.x - to) * dir <= 10).forEach(e => this.hurt(e, 160, u, { big: true }));
        const ghost = this.add.rectangle(Math.min(from, to), u.y - u.h / 2, Math.abs(to - from), 10, 0x7fd1ff, 0.7).setOrigin(0, 0.5).setDepth(900);
        this.tweens.add({ targets: ghost, alpha: 0, duration: 300, onComplete: () => ghost.destroy() });
        u.x = to; u.facing = dir;
        break;
      }
      case 'radialBlind':
        this.ring(u.x, u.y, 350, 0xffffff);
        near(350).forEach(e => { e.stun = Math.max(e.stun, 5); });
        break;
      case 'pull':
        this.ring(u.x, u.y, 450, 0xe066c8);
        near(450).forEach(e => {
          const side = Math.sign(e.x - u.x) || 1;
          e.x = u.x + side * (50 + Math.random() * 40);
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
        let t = this.nearest(u, enemies); if (!t) break;
        const hit = [t]; let last = t;
        for (let k = 0; k < 3; k++) {
          const next = this.nearest(last, enemies.filter(e => !hit.includes(e) && Math.abs(e.x - last.x) < 220));
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
    if (u.jump) this.updateJump(u, dt * speedMul, enemies);

    // 1) 쓰러진 동료가 있으면 가장 가까운 사람이 부활하러 감
    const downed = this.units.filter(o => o.team === 'tenno' && o.downed);
    for (const d of downed) {
      const helper = this.nearest(d, this.alive('tenno'));
      if (helper === u) {
        const dx = d.x - u.x;
        if (u.jump) return;
        if (Math.abs(dx) > 30) { if (!this.tryJump(u, d.x, true)) this.moveToward(u, d.x, speedMul, dt); return; }
        d.reviveProg += dt;
        if (d.reviveProg >= RULES.reviveTime) this.revive(d, u);
        return;
      }
    }

    if (enemies.length === 0) {
      const home = 160 + WARFRAMES.indexOf(u.def) * 50;
      if (u.jump) return;
      if (Math.abs(home - u.x) > 10) this.moveToward(u, home, 1, dt); else u.facing = 1;
      return;
    }

    // 2) 능력
    if (!u.jump && this.tryAbilities(u, enemies)) return;

    // 3) 사격/근접
    const target = (this.focusTarget && !this.focusTarget.dead && u.buff.focus > 0) ? this.focusTarget : this.nearest(u, enemies);
    const dist = Math.abs(target.x - u.x);
    const range = u.def.weapon.range;
    u.facing = Math.sign(target.x - u.x) || u.facing;
    // 혼자 튀어나가지 않게: 스쿼드 중심 근처에서만 움직임
    const L = this.leashOf(u);
    let want = dist > range * u.rangeFactor ? target.x : u.x;
    want = Phaser.Math.Clamp(want, this.anchorX - L, this.anchorX + L);
    if (!u.jump) {
      if (Math.abs(want - u.x) > 70) {
        if (!this.tryJump(u, want, true)) this.moveToward(u, want, speedMul, dt);
      } else if (Math.abs(want - u.x) > 8) {
        this.moveToward(u, want, speedMul, dt);
      } else if (dist <= range) {
        // 싸우는 중에도 가만히 있지 않고 짧게 점프하며 자리를 바꿈 (공중에선 잘 안 맞음)
        const hop = Phaser.Math.Clamp(u.x + (Math.random() - 0.5) * 300, this.anchorX - L, this.anchorX + L);
        if (Math.abs(hop - u.x) > 60) this.tryJump(u, hop, false);
      }
    }
    if (dist <= range) {
      u.atkTimer -= dt * speedMul;
      if (u.atkTimer <= 0) {
        u.atkTimer = u.def.weapon.fireRate;
        if (range < 100) {
          // 근접: 앞쪽 적 여러 명을 벰
          this.within(u.x + u.facing * 35, 45, enemies).forEach(e => this.hurt(e, u.def.weapon.damage, u));
          this.swing(u);
        } else {
          this.tracer(u, target, u.def.color);
          this.hurt(target, u.def.weapon.damage * (0.9 + Math.random() * 0.2), u);
        }
      }
    }
  }

  // ---------------- 불릿 점프
  tryJump(u, tx, far) {
    if (u.jumpCd > 0 || u.stun > 0) return false;
    const dist = Phaser.Math.Clamp(Math.abs(tx - u.x), 0, far ? 320 : 200);
    if (dist < 40) return false;
    const dir = Math.sign(tx - u.x);
    const toX = Phaser.Math.Clamp(u.x + dir * dist, 30, W - 30);
    u.jump = { t: 0, dur: 0.4 + dist / 900, fromX: u.x, toX, peak: 50 + dist * 0.35, dir };
    u.jumpCd = 1.2 + Math.random() * 1.6;
    if (!u.downed) u.body.setAngle(dir * 18);
    return true;
  }

  updateJump(u, dt, enemies) {
    const j = u.jump;
    j.t = Math.min(1, j.t + dt / j.dur);
    u.x = j.fromX + (j.toX - j.fromX) * j.t;
    u.z = Math.sin(Math.PI * j.t) * j.peak;
    u.trailT -= dt;
    if (u.trailT <= 0) {
      u.trailT = 0.04;
      const g = this.add.rectangle(u.x, u.y - u.z - u.h / 2, u.w, u.h, u.def.color, 0.35).setAngle(j.dir * 18).setDepth(u.y - 1);
      this.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
    }
    if (j.t >= 1) {
      u.jump = null; u.z = 0;
      if (!u.downed) u.body.setAngle(0);
      this.dust(u.x, u.y);
      // 근접 프레임은 착지하며 내려찍기
      if (u.def.weapon.range < 100) {
        const hit = this.within(u.x, 90, enemies);
        if (hit.length) { this.ring(u.x, u.y + 30, 90, 0xbfe9ff); hit.forEach(e => this.hurt(e, 45, u)); }
      }
    }
  }

  dust(x, y) {
    const d = this.add.ellipse(x, y, 20, 6, 0xcfd8e3, 0.6).setDepth(y - 1);
    this.tweens.add({ targets: d, scaleX: 3, alpha: 0, duration: 250, onComplete: () => d.destroy() });
  }

  swing(u) {
    const s = this.add.arc(u.x + u.facing * 30, u.y - u.z - u.h * 0.55, 34, u.facing > 0 ? -60 : 120, u.facing > 0 ? 60 : 240, false).setStrokeStyle(4, 0xbfe9ff).setDepth(900);
    this.tweens.add({ targets: s, alpha: 0, duration: 150, onComplete: () => s.destroy() });
  }

  moveToward(u, tx, mul, dt) {
    const dir = Math.sign(tx - u.x);
    u.facing = dir || u.facing;
    u.x += dir * (u.def.speed) * mul * dt;
    u.x = Phaser.Math.Clamp(u.x, 30, W - 30);
  }

  // ---------------- 그리너 생각하기
  thinkGrineer(u, dt) {
    if (u.stun > 0) return;
    const foes = this.alive('tenno');
    if (foes.length === 0) return;
    const target = this.nearest(u, foes);
    const dist = Math.abs(target.x - u.x);
    const range = u.def.weapon.range;
    u.facing = Math.sign(target.x - u.x) || u.facing;
    const onScreen = u.x > 20 && u.x < W - 20;
    if (dist > range * u.rangeFactor || !onScreen) {
      u.x += u.facing * u.def.speed * dt;
    }
    if (dist <= range && onScreen) {
      u.atkTimer -= dt;
      if (u.atkTimer <= 0) {
        u.atkTimer = u.def.weapon.fireRate * (0.9 + Math.random() * 0.3);
        if (range < 100) {
          this.swing(u);
          if (target.z < 40) this.hurt(target, u.def.weapon.damage, u);
        } else if (Math.random() < (target.z > 10 ? 0.25 : 0.65)) {
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
    const wave = WAVES[this.waveIndex];
    wave.forEach(g => { for (let i = 0; i < g.count; i++) this.spawnQueue.push({ type: g.type, side: g.side || 'right' }); });
    Phaser.Utils.Array.Shuffle(this.spawnQueue);
    this.waveText.setText(`웨이브 ${this.waveIndex + 1} / ${WAVES.length}`);
    const lines = ['그리너 병력 접근 중.', '적 증원이다. 대열을 유지해라.', '뒤쪽에서도 온다! 조심해라.', '헤비 거너 확인. 방어력이 높다.', '마지막 물결이다, 텐노.'];
    this.say('로터스', lines[this.waveIndex] || '적이 온다.');
  }

  spawnOne(s) {
    const def = { ...GRINEER[s.type], id: s.type };
    const x = s.side === 'left' ? -30 : W + 30;
    this.addUnit('grineer', def, x, 584 + Math.random() * 56);
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
      this.ring(W / 2, GROUND_Y, 700, 0x4cd964);
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
      this.add.rectangle(x, y, 220, 78, 0x000000, 0.55).setOrigin(0).setStrokeStyle(2, f.def.color).setDepth(1000);
      const name = this.add.text(x + 8, y + 4, f.def.name, { fontFamily: FONT, fontSize: 16, color: '#fff', fontStyle: 'bold' }).setDepth(1001);
      const state = this.add.text(x + 212, y + 6, '', { fontFamily: FONT, fontSize: 12, color: '#ffd23f' }).setOrigin(1, 0).setDepth(1001);
      const bar = (yy, col) => {
        this.add.rectangle(x + 8, y + yy, 204, 10, 0x222222).setOrigin(0).setDepth(1001);
        return this.add.rectangle(x + 8, y + yy, 204, 10, col).setOrigin(0).setDepth(1002);
      };
      return { name, state, sh: bar(28, 0x5ac8fa), hp: bar(42, 0x4cd964), en: bar(56, 0x9b59b6) };
    });
    this.waveText = this.add.text(W - 16, 14, '준비 중', { fontFamily: FONT, fontSize: 22, color: '#fff', fontStyle: 'bold' }).setOrigin(1, 0).setDepth(1000);
    this.speedBtn = this.add.text(W - 16, 48, '속도 x1', { fontFamily: FONT, fontSize: 16, color: '#0b0f1a', backgroundColor: '#cfd8e3', padding: { x: 8, y: 4 } })
      .setOrigin(1, 0).setDepth(1000).setInteractive({ useHandCursor: true });
    this.speedBtn.on('pointerdown', () => {
      this.timeMul = this.timeMul >= 3 ? 1 : this.timeMul + 1;
      this.tweens.timeScale = this.timeMul;
      this.speedBtn.setText('속도 x' + this.timeMul);
    });

    this.sayBox = this.add.text(W / 2, 110, '', { fontFamily: FONT, fontSize: 18, color: '#e8f1ff', backgroundColor: '#0b0f1acc', padding: { x: 12, y: 6 } }).setOrigin(0.5, 0).setDepth(1000);

    // 로터스 버튼
    const cmds = [['focus', '집중 공격'], ['supply', '긴급 보급'], ['ult', '궁극기 발동'], ['retreat', '후퇴']];
    this.add.text(16, H - 52, '로터스 개입', { fontFamily: FONT, fontSize: 14, color: '#8fb3d9' }).setDepth(1000);
    this.pointsText = this.add.text(16, H - 32, '', { fontFamily: FONT, fontSize: 18, color: '#7fd1ff', fontStyle: 'bold' }).setDepth(1000);
    this.lotusBtns = cmds.map(([id, label], i) => {
      const b = this.add.text(160 + i * 170, H - 44, `${i + 1}. ${label}`, { fontFamily: FONT, fontSize: 18, color: '#0b0f1a', backgroundColor: id === 'retreat' ? '#e0a0a0' : '#7fd1ff', padding: { x: 12, y: 8 } })
        .setOrigin(0, 0.5).setDepth(1000).setInteractive({ useHandCursor: true });
      b.on('pointerdown', () => this.lotus(id));
      this.input.keyboard.on('keydown-' + ['ONE', 'TWO', 'THREE', 'FOUR'][i], () => this.lotus(id));
      b.cmd = id;
      return b;
    });
    this.add.text(W - 16, H - 20, '비공식 팬게임 · Digital Extremes와 무관', { fontFamily: FONT, fontSize: 12, color: '#889' }).setOrigin(1, 0.5).setDepth(1000);
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

  // 스쿼드가 모일 위치: 쓰러진 동료가 있으면 그 자리로 다 같이, 아니면 서로의 가운데
  squadAnchor() {
    const downed = this.frames.filter(f => f.downed);
    if (downed.length) return downed.reduce((a, b) => (b.bleed < a.bleed ? b : a)).x;
    const up = this.alive('tenno');
    if (!up.length) return W / 2;
    const avg = up.reduce((s, f) => s + f.x, 0) / up.length;
    return Phaser.Math.Clamp(avg, 200, 640);
  }

  leashOf(u) { return u.def.weapon.range < 100 ? LEASH + 80 : LEASH; }

  // ---------------- 매 프레임
  update(_t, delta) {
    if (this.ended) return;
    const dt = Math.min(delta / 1000, 0.05) * this.timeMul;
    this.elapsed += dt;

    if (this.sayTimer > 0) { this.sayTimer -= dt; if (this.sayTimer <= 0) this.tweens.add({ targets: this.sayBox, alpha: 0, duration: 400 }); }

    // 웨이브 진행
    if (this.spawnQueue.length) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) { this.spawnOne(this.spawnQueue.shift()); this.spawnTimer = 0.3; }
    } else if (this.alive('grineer').length === 0) {
      this.waveDelay -= dt;
      if (this.waveDelay <= 0) { this.waveDelay = 3; this.nextWave(); if (this.ended) return; }
    }

    this.anchorX = this.squadAnchor();
    for (const u of this.units) {
      if (u.dead && u.team === 'grineer') continue;
      // 타이머
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

      // 그리기
      u.view.setPosition(u.x, u.y - u.z).setDepth(u.y);
      if (!u.downed && !u.dead) u.body.setScale(Math.abs(u.body.scaleX) * u.facing, u.body.scaleY);
      u.hpBar.width = u.w * Math.max(0, u.hp / u.hpMax);
      if (u.shBar) u.shBar.width = u.w * (u.shield / u.shieldMax);
      if (u.skinFx) u.skinFx.setVisible(u.ironSkin > 0);
      u.stunFx.setVisible(u.stun > 0 && !u.dead);
    }
    this.units = this.units.filter(u => !(u.dead && u.team === 'grineer'));
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
