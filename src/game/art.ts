import Phaser from 'phaser';
import { TILE as T, rngFrom } from './map';

type G = Phaser.GameObjects.Graphics;

// Toate texturile sunt desenate din cod (zero fisiere de asset) si create o singura data per joc
const tex = (s: Phaser.Scene, key: string, w: number, h: number, draw: (g: G) => void) => {
  const g = s.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
};

// Zgomot determinist peste culoarea de baza (aceeasi textura la fiecare rulare)
const speckle = (g: G, key: string, colors: number[], n: number) => {
  const r = rngFrom(key);
  for (let i = 0; i < n; i++) {
    g.fillStyle(colors[i % colors.length], 0.2 + r() * 0.25)
      .fillRect(Math.floor(r() * T), Math.floor(r() * T), 1 + Math.floor(r() * 3), 1 + Math.floor(r() * 2));
  }
};

const ASPHALT = [0x2b2e33, 0x3d4148];   // asfalt gri, la fel peste tot (zonele de loot nu mai sunt colorate)

export function makeTextures(s: Phaser.Scene) {
  if (s.textures.exists('player')) return;

  // ---- teren: 3 variante de asfalt + podea/iarba/pavaj/trotuar ----
  for (let v = 0; v < 3; v++) {
    const key = `t_road_${v}`;
    tex(s, key, T, T, (g) => {
      g.fillStyle(ASPHALT[0]).fillRect(0, 0, T, T);
      speckle(g, key, [ASPHALT[1], 0x000000, 0xffffff], 30);
    });
  }
  tex(s, 'g_floor', T, T, (g) => {
    g.fillStyle(0x6a5a4b).fillRect(0, 0, T, T);
    for (let y = 0; y < T; y += 8) g.fillStyle(0x000000, 0.28).fillRect(0, y + 7, T, 1).fillStyle(0x000000, 0.2).fillRect((y * 5 + 11) % T, y, 1, 8);
    speckle(g, 'g_floor', [0xffffff, 0x000000], 14);
  });
  tex(s, 'g_grass', T, T, (g) => {
    g.fillStyle(0x2f6b34).fillRect(0, 0, T, T);
    speckle(g, 'g_grass', [0x5cae5f, 0x1d4a22, 0x7bc67e], 44);
  });
  tex(s, 'g_paved', T, T, (g) => {
    g.fillStyle(0x6e7078).fillRect(0, 0, T, T);
    g.fillStyle(0x000000, 0.3).fillRect(0, 15, T, 1).fillRect(0, 31, T, 1).fillRect(15, 0, 1, T).fillRect(31, 0, 1, T);
    speckle(g, 'g_paved', [0xffffff, 0x000000], 22);
  });
  tex(s, 'g_road_v', T, T, (g) => { g.fillStyle(0xe0c341, 0.55).fillRect(T - 2, 6, 2, 20); });
  tex(s, 'g_road_h', T, T, (g) => { g.fillStyle(0xe0c341, 0.55).fillRect(6, T - 2, 20, 2); });
  tex(s, 'g_sidewalk', T, T, (g) => {
    g.fillStyle(0x8a8d93).fillRect(0, 0, T, T);
    g.fillStyle(0x000000, 0.22).fillRect(15, 0, 1, T).fillRect(0, 15, T, 1);
    g.fillStyle(0xffffff, 0.12).fillRect(0, 0, T, 1).fillRect(0, 0, 1, T);
    speckle(g, 'g_sidewalk', [0xffffff, 0x000000], 12);
  });
  // zebra: dungi albe paralele cu sensul masinilor
  tex(s, 'g_cross_v', T, T, (g) => { g.fillStyle(0xe8e8e8, 0.7); for (const x of [3, 14, 25]) g.fillRect(x, 5, 5, 22); });
  tex(s, 'g_cross_h', T, T, (g) => { g.fillStyle(0xe8e8e8, 0.7); for (const y of [3, 14, 25]) g.fillRect(5, y, 22, 5); });
  tex(s, 'g_dirt', T, T, (g) => {
    g.fillStyle(0x7a6246).fillRect(0, 0, T, T);
    speckle(g, 'g_dirt', [0x9b7f5c, 0x4f3d29, 0xb59b78], 36);
  });
  tex(s, 'extract', T, T, (g) => {
    g.fillStyle(0x00e676, 0.22).fillRect(0, 0, T, T);
    g.lineStyle(3, 0x00e676, 0.4);
    for (let i = -T; i < T; i += 16) g.lineBetween(i, T, i + T, 0);
    g.lineStyle(1, 0x69f0ae, 0.6).strokeRect(0.5, 0.5, T - 1, T - 1);
  });

  // ---- obstacole (partea de jos mai inchisa = efect de volum) ----
  tex(s, 'w_wall', T, T, (g) => {
    g.fillStyle(0x8a9099).fillRect(0, 0, T, T - 6);
    g.fillStyle(0x4b5058).fillRect(0, T - 6, T, 6);
    g.fillStyle(0x000000, 0.18);
    for (let y = 0; y < T - 6; y += 8) {
      g.fillRect(0, y + 7, T, 1);
      for (let x = ((y / 8) % 2) * 8; x < T; x += 16) g.fillRect(x, y, 1, 7);
    }
    g.fillStyle(0xffffff, 0.25).fillRect(0, 0, T, 2);
  });
  tex(s, 'w_crate', T, T, (g) => {
    g.fillStyle(0x6b4e2f).fillRect(1, 1, T - 2, T - 2);
    g.fillStyle(0xb48d60).fillRect(4, 4, T - 8, T - 8);
    g.lineStyle(3, 0x7d5c38).lineBetween(5, 5, T - 5, T - 5).lineBetween(T - 5, 5, 5, T - 5);
    g.fillStyle(0x000000, 0.3).fillRect(0, T - 3, T, 3);
  });
  tex(s, 'w_fence', T, T, (g) => {
    g.fillStyle(0x000000, 0.25).fillRect(0, 21, T, 3);
    g.fillStyle(0x8d6e63).fillRect(0, 11, T, 3).fillRect(0, 19, T, 3);
    g.fillStyle(0x5d4037);
    for (const x of [2, 14, 26]) g.fillRect(x, 6, 4, 20);
  });
  tex(s, 'g_tile', T, T, (g) => {
    g.fillStyle(0xcfd8dc).fillRect(0, 0, T, T);
    g.fillStyle(0x90a4ae, 0.55).fillRect(0, 15, T, 1).fillRect(15, 0, 1, T);
    speckle(g, 'g_tile', [0xffffff, 0x000000], 10);
  });
  tex(s, 'w_shelf', T, T, (g) => {
    g.fillStyle(0x000000, 0.3).fillRect(1, 25, 30, 4);
    g.fillStyle(0x5d4037).fillRect(1, 5, 30, 20);
    g.fillStyle(0x8d6e63).fillRect(2, 7, 28, 5).fillRect(2, 16, 28, 5);
    [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047].forEach((c, i) => g.fillStyle(c).fillRect(4 + i * 7, 8, 5, 3).fillRect(5 + i * 7, 17, 5, 3));
  });
  tex(s, 'w_pump', T, T, (g) => {
    g.fillStyle(0x000000, 0.3).fillRect(8, 24, 18, 5);
    g.fillStyle(0xd32f2f).fillRect(8, 4, 16, 22);
    g.fillStyle(0xeeeeee).fillRect(10, 7, 12, 7);
    g.fillStyle(0x263238).fillRect(11, 8, 10, 5);
    g.fillStyle(0x37474f).fillRect(24, 12, 3, 12);
  });
  tex(s, 'w_water', T, T, (g) => {
    g.fillStyle(0x1b5c8f).fillRect(0, 0, T, T);
    speckle(g, 'w_water', [0x4aa3df, 0x0d3b63, 0xffffff], 26);
    g.fillStyle(0xffffff, 0.14).fillRect(4, 9, 10, 1).fillRect(18, 22, 9, 1).fillRect(7, 27, 7, 1);
  });
  // tejghea: baza deschisa la culoare, se coloreaza (tint) dupa tipul magazinului
  tex(s, 'w_counter', T, T, (g) => {
    g.fillStyle(0x000000, 0.3).fillRect(0, 25, T, 5);
    g.fillStyle(0xbdbdbd).fillRect(0, 12, T, 14);
    g.fillStyle(0xf5f5f5).fillRect(0, 6, T, 8);
    g.fillStyle(0x000000, 0.18).fillRect(0, 14, T, 1).fillRect(0, 25, T, 1);
    g.fillStyle(0x37474f).fillRect(20, 2, 9, 8);
    g.fillStyle(0x80cbc4).fillRect(22, 3, 5, 3);
    g.fillStyle(0xffd54f).fillCircle(8, 9, 2.5).fillCircle(13, 10, 2.5);
  });
  tex(s, 'w_tree', T, T, (g) => {
    g.fillStyle(0x000000, 0.3).fillCircle(18, 19, 13);
    g.fillStyle(0x1f5a28).fillCircle(16, 16, 14);
    g.fillStyle(0x2e7d32).fillCircle(14, 14, 11);
    g.fillStyle(0x43a047).fillCircle(12, 11, 6);
    g.fillStyle(0x66bb6a, 0.6).fillCircle(10, 9, 3);
  });
  [0x3f6fb5, 0xb5413f, 0xcfd3d8].forEach((c, i) => tex(s, `w_car${i}`, T, T, (g) => {
    g.fillStyle(0x000000, 0.3).fillRoundedRect(2, 8, 28, 20, 6);
    g.fillStyle(c).fillRoundedRect(1, 5, 29, 20, 6);
    g.fillStyle(0x1b2733).fillRoundedRect(8, 8, 15, 14, 3);
    g.fillStyle(c).fillRoundedRect(11, 10, 9, 10, 2);
    g.fillStyle(0xffeb3b).fillRect(28, 8, 2, 4).fillRect(28, 18, 2, 4);
    g.fillStyle(0xd32f2f).fillRect(1, 8, 2, 4).fillRect(1, 18, 2, 4);
  }));

  // ---- containere ----
  const crate = (key: string, wood: number, trim: number) => tex(s, key, 24, 24, (g) => {
    g.fillStyle(0x000000, 0.35).fillRoundedRect(2, 4, 22, 20, 3);
    g.fillStyle(0x2b1d10).fillRoundedRect(0, 0, 22, 22, 3);
    g.fillStyle(wood).fillRoundedRect(2, 2, 18, 18, 2);
    g.fillStyle(0x000000, 0.2).fillRect(2, 10, 18, 2);
    g.fillStyle(trim).fillRect(9, 8, 4, 6);
    g.fillStyle(0xffffff, 0.25).fillRect(3, 3, 16, 2);
  });
  crate('box', 0xb0804a, 0xffd54f);
  crate('box_empty', 0x555555, 0x333333);
  tex(s, 'drop', 24, 24, (g) => {
    g.fillStyle(0x000000, 0.35).fillEllipse(13, 14, 20, 16);
    g.fillStyle(0x8b2a2a).fillEllipse(12, 12, 20, 16);
    g.fillStyle(0xffffff, 0.8).fillRect(4, 11, 16, 2);
    g.fillStyle(0x3b0f0f).fillCircle(12, 12, 3);
  });

  // ---- personaje (privite de sus, orientate spre +x) ----
  const actor = (key: string, body: number, head: number) => tex(s, key, T, T, (g) => {
    g.fillStyle(0x000000, 0.3).fillCircle(17, 18, 11);
    g.fillStyle(body).fillEllipse(15, 16, 12, 22);
    g.fillStyle(0x000000, 0.25).fillEllipse(12, 16, 5, 18);
    g.fillStyle(head).fillCircle(17, 16, 6);
    g.fillStyle(0xffffff, 0.35).fillCircle(16, 14, 2);
    g.fillStyle(0x23272e).fillRect(22, 17, 9, 3);
    g.fillStyle(0x4a4f58).fillRect(18, 16, 7, 5);
  });
  actor('player', 0xd9dde3, 0x2b2f36);
  actor('remote', 0x4fc3f7, 0x1a3a4a);
  actor('trader', 0xeeeeee, 0x2b2f36);

  // ---- usa incuiata (tint dupa cheie), sange, cadavru ----
  tex(s, 'w_lock', T, T, (g) => {
    g.fillStyle(0xdfe3e8).fillRect(0, 0, T, T - 6);
    g.fillStyle(0x6b7078).fillRect(0, T - 6, T, 6);
    g.lineStyle(2, 0x000000, 0.35).strokeRect(2, 2, T - 4, T - 10);
    g.fillStyle(0x37474f).fillRect(10, 14, 12, 9);
    g.lineStyle(3, 0x37474f).strokeCircle(16, 13, 4);
    g.fillStyle(0xffffff, 0.3).fillRect(0, 0, T, 2);
  });
  tex(s, 'blood', 16, 16, (g) => {
    g.fillStyle(0x8b0000, 0.9).fillCircle(8, 8, 5).fillCircle(3, 6, 2).fillCircle(12, 11, 3).fillCircle(11, 3, 2);
    g.fillStyle(0xb71c1c, 0.8).fillCircle(7, 7, 3);
  });
  tex(s, 'bloodw', 10, 18, (g) => {
    g.fillStyle(0x7f0000, 0.85).fillRect(3, 0, 4, 14).fillCircle(5, 15, 3);
    g.fillStyle(0xb71c1c, 0.7).fillCircle(5, 3, 4);
  });
  tex(s, 'corpse', T, T, (g) => {
    g.fillStyle(0x000000, 0.3).fillEllipse(17, 18, 26, 14);
    g.fillStyle(0x7f1d1d, 0.85).fillEllipse(16, 17, 24, 13);
    g.fillStyle(0x6e7681).fillEllipse(15, 16, 20, 10);
    g.fillStyle(0x23272e).fillCircle(26, 16, 5);
    g.fillStyle(0xb71c1c, 0.7).fillCircle(14, 17, 4);
  });

  // ---- efecte ----
  tex(s, 'bullet', 14, 4, (g) => {
    for (let i = 0; i < 14; i++) g.fillStyle(0xffffff, (i + 1) / 14).fillRect(i, 1, 1, 2);
    g.fillStyle(0xffffff).fillRect(11, 0, 3, 4);
  });
  tex(s, 'dot', 4, 4, (g) => { g.fillStyle(0xffffff).fillCircle(2, 2, 2); });

  // vignetta fixa pe ecran (jocul are 960x600, scalat FIT)
  const v = s.textures.createCanvas('vignette', 960, 600)!;
  const ctx = v.getContext();
  const grad = ctx.createRadialGradient(480, 300, 220, 480, 300, 580);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 960, 600);
  v.refresh();
}