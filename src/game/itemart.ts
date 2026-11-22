import { dims, spec, type Def } from './items.ts';

// Every item has its own illustration, drawn in code as SVG (no asset files).
// The rarity colour tints the accents; armor/backpacks get more detail with each tier.

type Pal = { m: string; l: string; d: string };
const PALS: Record<string, Pal> = {
  common: { m: '#9aa1a9', l: '#d0d5da', d: '#515860' },
  uncommon: { m: '#3fae5e', l: '#93e2a8', d: '#1d6a34' },
  rare: { m: '#3d8fe0', l: '#a0cbf6', d: '#1c4e8b' },
  epic: { m: '#a653c4', l: '#d89fe8', d: '#5b2373' },
  legendary: { m: '#f0951a', l: '#ffd47e', d: '#8a4c00' },
};
const TIER: Record<string, number> = { common: 0, uncommon: 0, rare: 1, epic: 2, legendary: 3 };

const MET = '#4b525c', MET_L = '#808997', MET_D = '#3a414c';
const WOOD = '#7b4f2c', WOOD_D = '#4a2d17', WOOD_L = '#a8723f';
const BRASS = '#d3a73c', BRASS_D = '#8f6d1c';

const r = (x: number, y: number, w: number, h: number, f: string, rx = 0, x2 = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${f}" ${x2}/>`;
const p = (d: string, f: string, x2 = '') => `<path d="${d}" fill="${f}" ${x2}/>`;
const c = (cx: number, cy: number, rr: number, f: string, x2 = '') => `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="${f}" ${x2}/>`;
const ln = (d: string, s: string, w: number, x2 = '') =>
  `<path d="${d}" fill="none" stroke="${s}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${x2}/>`;
const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" aria-hidden="true">${body}</svg>`;

// ---------------- weapons ----------------
const revolver = (a: Pal) => svg(128, 64,
  p('M60 19H119V30H60Z', MET) + r(60, 16, 59, 4, MET_L, 2) + r(114, 11, 6, 6, MET_D, 1) + r(60, 28, 58, 3, MET_D) +
  r(40, 13, 24, 24, MET_D, 5) + [0, 1, 2].map((i) => r(45 + i * 6, 15, 3, 20, MET, 1)).join('') +
  p('M18 17H44V38H34L30 40H18Z', MET) + r(18, 15, 22, 4, MET_L, 2) +
  p('M20 36H42L40 50L36 58Q33 61 27 60L18 58Q14 56 16 50Z', WOOD) +
  ln('M22 42L36 42M21 48L34 48M20 54L32 54', WOOD_D, 1.5) +
  ln('M44 38Q47 50 37 49', MET_D, 3) + p('M18 15L10 8L17 6L24 13Z', MET_D) + r(24, 22, 12, 4, a.m, 1));

const pistol = (a: Pal) => svg(128, 64,
  r(26, 14, 88, 17, MET, 3) + r(26, 14, 88, 4, MET_L, 2) + r(110, 17, 10, 10, MET_D, 2) +
  r(34, 11, 6, 5, MET_D) + r(100, 10, 5, 5, MET_D) + r(60, 20, 26, 5, MET_D, 1) +
  p('M34 31H74L76 38H68L62 57Q60 61 54 61H42Q37 61 37 56Z', MET_D) +
  ln('M42 42H58M41 48H56M40 54H54', MET, 1.5) + ln('M70 38Q68 50 58 47', MET_D, 3) + r(40, 21, 16, 4, a.m, 1));

const smg = (a: Pal) => svg(192, 128,
  ln('M54 48H22L12 66L24 74H54', MET_L, 4) + r(52, 34, 102, 28, MET, 5) + r(52, 34, 102, 6, MET_L, 3) +
  r(60, 27, 70, 7, MET_D, 1) + r(132, 21, 8, 9, MET_D, 1) + r(66, 21, 10, 9, MET_D, 1) +
  r(152, 38, 30, 20, MET_D, 3) + [158, 166, 174].map((x) => c(x, 48, 3, '#0b0c0e')).join('') +
  r(88, 42, 22, 6, MET_D, 1) + p('M92 62H112L117 114H97Z', MET_D) + r(92, 62, 20, 5, MET, 1) +
  p('M62 62H80L76 100Q75 105 70 105H64Q60 105 61 100Z', MET_D) + ln('M84 62Q86 78 98 73', MET_D, 3) + r(58, 44, 26, 5, a.m, 1));

const shotgun = (a: Pal) => svg(256, 128,
  p('M16 56L72 44V72L28 98Q18 103 12 96Z', WOOD) + ln('M20 60L68 52', WOOD_L, 2) +
  r(70, 40, 44, 28, MET, 4) + r(70, 40, 44, 5, MET_L, 2) + r(112, 42, 134, 10, MET, 3) + r(112, 42, 134, 3, MET_L, 1.5) +
  r(112, 55, 118, 9, MET_D, 3) + r(243, 37, 5, 6, MET_D, 1) +
  r(138, 51, 52, 19, WOOD, 5) + ln('M146 55V67M154 55V67M162 55V67M170 55V67M178 55V67', WOOD_D, 1.5) +
  p('M84 68H104L98 96Q96 100 90 100H84Z', WOOD_D) + ln('M82 68Q80 86 94 83', MET_D, 3) + r(78, 49, 24, 4, a.m, 1));

const rifle = (a: Pal) => svg(320, 128,
  p('M96 50L34 56L24 92Q24 98 32 98H44L98 70Z', MET_D) + r(24, 88, 12, 12, '#111418', 3) +
  r(92, 44, 72, 26, MET, 4) + r(92, 44, 72, 5, MET_L, 2) +
  r(160, 48, 76, 22, MET_D, 3) + [168, 180, 192, 204, 216].map((x) => r(x, 52, 6, 14, '#0b0c0e', 2)).join('') +
  r(236, 53, 44, 7, MET, 2) + r(278, 49, 18, 15, MET_D, 3) + ln('M284 50V63M290 50V63', '#0b0c0e', 2) +
  r(100, 36, 90, 8, MET_D, 1) + r(228, 34, 5, 16, MET_D, 1) + r(104, 29, 10, 8, MET_D, 1) +
  p('M124 70H150L159 113Q150 117 142 113L124 80Z', MET_D) + ln('M130 82L148 102', MET, 2) +
  p('M98 70H114L110 102Q109 107 104 107H98Q94 107 95 102Z', MET_D) + r(110, 54, 26, 5, a.m, 1));

const sniper = (a: Pal) => svg(384, 128,
  p('M104 54L36 58L24 98Q24 104 34 104H48L104 78Z', WOOD) + ln('M40 64L100 58', WOOD_L, 2) +
  r(100, 50, 108, 22, MET, 4) + r(100, 50, 108, 4, MET_L, 2) +
  r(206, 56, 140, 8, MET_D, 2) + r(206, 57, 140, 2, MET_L) + r(344, 51, 30, 18, MET_D, 4) + ln('M352 52V68M360 52V68M368 52V68', '#0b0c0e', 2) +
  r(116, 24, 96, 18, '#1a1d22', 8) + r(112, 21, 16, 24, '#2c3138', 6) + r(200, 21, 18, 24, '#2c3138', 6) +
  c(114, 33, 7, '#5aa6d6') + c(218, 33, 8, '#5aa6d6') + c(112, 31, 2, '#d8f0ff') + r(136, 42, 6, 10, MET_D) + r(180, 42, 6, 10, MET_D) +
  ln('M176 60L184 74', MET_L, 4) + c(186, 76, 4, MET_L) + r(150, 72, 22, 22, MET_D, 3) +
  ln('M280 64L268 102M300 64L314 102', MET_L, 3) + r(112, 60, 30, 4, a.m, 1));

// ---------------- armor (tier 0..3) ----------------
const helmet = (a: Pal, t: number) => svg(128, 128,
  p('M18 82C16 40 40 16 64 16C88 16 112 40 110 82V90H18Z', a.m) +
  ln('M32 62C34 40 48 28 64 26', a.l, 5, 'opacity=".55"') +
  (t >= 1 ? r(59, 16, 10, 62, a.d, 3) + r(61, 17, 3, 58, a.l, 1) : '') +
  (t >= 2 ? r(52, 5, 24, 14, '#2a2f36', 3) + c(64, 12, 4, '#6fe0a0') : '') +
  (t >= 3 ? p('M50 18L64 0L78 18Z', a.l) + ln('M18 78H110', a.l, 4) + c(22, 68, 8, a.l) + c(106, 68, 8, a.l) + c(22, 68, 3, a.d) + c(106, 68, 3, a.d) : '') +
  r(12, 86, 104, 12, a.d, 6) + r(14, 87, 100, 3, a.l, 1.5, 'opacity=".4"') +
  (t >= 2 ? p('M26 98H102V108Q64 126 26 108Z', '#16202a') + ln('M36 106L62 116', '#6fb3e6', 3, 'opacity=".8"')
    : ln('M26 100V116M102 100V116', a.d, 5) + r(46, 104, 36, 8, a.d, 3)));

const vest = (a: Pal, t: number) => svg(100, 100,
  p('M28 8L40 16Q50 26 60 16L72 8L94 24L86 46L76 40V92Q76 96 72 96H28Q24 96 24 92V40L14 46L6 24Z', a.m) +
  p('M40 16Q50 28 60 16L56 10H44Z', a.d) + ln('M30 14L11 26', a.l, 3, 'opacity=".5"') +
  (t === 0
    ? [38, 50, 62, 74].map((y) => ln(`M26 ${y}H74`, a.d, 1.5)).join('') + [36, 48, 60].map((x) => ln(`M${x} 30V92`, a.d, 1.5)).join('') + r(24, 80, 52, 6, a.d, 2)
    : r(33, 32, 34, 40, a.d, 5) + r(37, 36, 26, 32, a.m, 3) + ln('M40 44H60M40 52H60M40 60H60', a.d, 1.5) +
      r(27, 76, 15, 15, a.d, 2) + r(58, 76, 15, 15, a.d, 2) + r(29, 78, 11, 3, a.l, 1) + r(60, 78, 11, 3, a.l, 1)) +
  (t >= 2 ? p('M6 24L28 8L34 22L13 38Z', a.d) + p('M94 24L72 8L66 22L87 38Z', a.d) + ln('M10 26L26 14M90 26L74 14', a.l, 2) : '') +
  (t >= 3 ? ln('M33 32H67V72H33Z', a.l, 2) + p('M50 38L53 46L61 46L55 51L57 59L50 54L43 59L45 51L39 46L47 46Z', a.l) +
    ln('M24 40V92M76 40V92', a.l, 2) : ''));

const backpack = (a: Pal, t: number) => svg(100, 100,
  (t >= 2 ? r(22, 5, 56, 14, a.l, 7) + ln('M34 5V19M50 5V19M66 5V19', a.d, 2) : ln('M42 16Q50 6 58 16', a.d, 3)) +
  p('M24 28Q50 8 76 28L82 88Q82 96 74 96H26Q18 96 18 88Z', a.m) +
  p('M24 28Q50 8 76 28L78 50Q50 60 22 50Z', a.d) + ln('M28 30Q50 14 72 30', a.l, 2, 'opacity=".5"') +
  ln('M40 50V70M60 50V70', a.d, 4) + r(44, 46, 12, 11, a.l, 2) + r(47, 49, 6, 5, a.d, 1) +
  r(30, 62, 40, 28, a.d, 5) + ln('M33 68H67', a.l, 1.5) + r(46, 70, 8, 6, a.l, 2) +
  (t >= 1 ? r(8, 56, 13, 32, a.d, 4) + r(79, 56, 13, 32, a.d, 4) + ln('M11 64H18M82 64H89', a.l, 1.5) : '') +
  (t >= 3 ? [34, 40, 46].map((y) => ln(`M30 ${y}H70`, a.l, 1.5, 'opacity=".6"')).join('') + c(50, 36, 6, a.l) + c(50, 36, 2.5, a.d) +
    ln('M33 62V90M67 62V90', a.l, 1.5, 'opacity=".5"') : ''));

// ---------------- healing ----------------
const bandage = (a: Pal) => svg(64, 64,
  c(28, 34, 21, '#e8e3d3') + c(28, 34, 15, '#d2cbb6') + c(28, 34, 9, '#e8e3d3') + c(28, 34, 4, '#111') +
  p('M44 42L62 50L58 60L40 52Z', '#f3efe3') + ln('M44 44L58 51', '#cfc8b4', 1.5) +
  r(6, 30, 44, 5, a.m, 0, 'opacity=".85"') + p('M44 6H50V12H56V18H50V24H44V18H38V12H44Z', '#d32f2f'));

const medkit = (a: Pal) => svg(128, 64,
  r(48, 6, 32, 12, '#6f1717', 5) + r(54, 10, 20, 5, '#3a0b0b', 2) +
  r(10, 16, 108, 42, '#c62828', 7) + r(10, 16, 108, 12, '#df4040', 6) + r(10, 52, 108, 6, '#8e1b1b', 3) +
  c(64, 38, 15, '#f4f4f4') + p('M60 28H68V34H74V42H68V48H60V42H54V34H60Z', '#c62828') +
  r(18, 34, 10, 10, a.m, 2) + r(100, 34, 10, 10, a.m, 2) + ln('M34 22H94', '#ffffff', 1.5, 'opacity=".35"'));

const stim = (a: Pal) => svg(64, 128,
  r(22, 4, 20, 7, MET_L, 3) + r(30, 11, 4, 16, MET, 1) + r(14, 25, 36, 6, MET_L, 3) +
  r(20, 30, 24, 58, '#d6eef6', 6, 'opacity=".85"') + r(22, 52, 20, 34, a.m, 4) + r(22, 52, 20, 5, a.l, 2) +
  ln('M24 38H30M24 44H30M24 50H30', '#546', 1.2) + r(25, 32, 4, 50, '#ffffff', 2, 'opacity=".35"') +
  r(26, 88, 12, 9, MET_D, 2) + p('M30 97H34V120L32 126L30 120Z', MET_L));

// ---------------- keys ----------------
const key = (body: string, a: Pal, big: boolean) => svg(64, 64,
  '<g transform="rotate(-38 32 32)">' +
  c(15, 32, big ? 13 : 11, body) + c(15, 32, 5, '#0b0c0e') +
  r(24, 29, big ? 36 : 32, 6, body, 2) + r(big ? 46 : 42, 35, 5, 10, body, 1) + r(big ? 54 : 50, 35, 4, 7, body, 1) +
  r(24, 29, 30, 2, '#ffffff', 1, 'opacity=".35"') + '</g>' +
  r(24, 44, 18, 12, a.m, 2) + c(29, 50, 2.5, '#0b0c0e') + ln('M33 50H38', '#0b0c0e', 1.5));

const keycard = (a: Pal) => svg(128, 64,
  r(10, 12, 108, 42, '#17212c', 6) + r(10, 12, 108, 5, a.m, 3) + r(10, 24, 108, 9, '#07090c') +
  r(20, 38, 18, 13, BRASS, 2) + ln('M20 44H38M29 38V51', BRASS_D, 1) +
  r(70, 40, 38, 3, a.l, 1, 'opacity=".7"') + r(70, 46, 24, 3, a.l, 1, 'opacity=".4"') + ln('M20 18H26', a.l, 1.5));

// ---------------- ammo ----------------
const AMMO: Record<string, { w: number; h: number; tip: string; body: string; label: string; shell?: boolean }> = {
  ammo_pistol: { w: 7, h: 12, tip: '#c9773d', body: BRASS, label: '9MM' },
  ammo_smg: { w: 7, h: 14, tip: '#e0c04a', body: BRASS, label: 'SMG' },
  ammo_rifle: { w: 7, h: 20, tip: '#b9794a', body: BRASS, label: '5.56' },
  ammo_shotgun: { w: 11, h: 17, tip: '#c62828', body: '#c62828', label: '12G', shell: true },
  ammo_sniper: { w: 9, h: 22, tip: '#8f98a3', body: BRASS, label: '.308' },
};
const ammo = (a: Pal, type: string) => {
  const k = AMMO[type] ?? AMMO.ammo_rifle;
  const bullets = [14, 28, 42].map((x) => {
    const top = 36 - k.h;
    return k.shell
      ? r(x, top, k.w, k.h, k.body, 2) + r(x, 36 - 5, k.w, 5, BRASS, 1) + r(x + 1, top, 2, k.h - 5, '#ff8a80', 1, 'opacity=".5"')
      : r(x, top + 5, k.w, k.h - 5, k.body, 1) + p(`M${x} ${top + 5}Q${x + k.w / 2} ${top - 4} ${x + k.w} ${top + 5}Z`, k.tip) + r(x + 1, top + 7, 2, k.h - 9, '#fff', 1, 'opacity=".35"');
  }).join('');
  return svg(64, 64, bullets + r(6, 36, 52, 22, '#3a4048', 3) + r(6, 36, 52, 4, '#555d68', 2) + r(10, 42, 44, 13, a.m, 2) +
    `<text x="32" y="52" font-size="10" text-anchor="middle" fill="#0d0f12" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="700">${k.label}</text>`);
};

const crate = (a: Pal) => svg(64, 64,
  r(8, 12, 48, 44, WOOD, 3) + r(11, 15, 42, 38, WOOD_L, 2) + ln('M11 15L53 53M53 15L11 53', WOOD_D, 3) + r(8, 12, 48, 5, a.l, 2, 'opacity=".35"') + r(28, 28, 8, 8, a.m, 2));


// ---------------- extra weapons / armor ----------------
const makarov = (a: Pal) => svg(128, 64,
  p('M26 15H108Q116 15 116 21V28H26Z', MET) + r(26, 15, 90, 4, MET_L, 2) + r(110, 18, 8, 8, MET_D, 2) +
  r(34, 12, 6, 4, MET_D) + r(60, 20, 22, 4, MET_D, 1) +
  p('M30 28H70L72 36H66L62 56Q60 61 54 61H42Q37 61 36 56Z', WOOD) + ln('M42 40H58M41 46H56M40 52H54', WOOD_D, 1.5) +
  c(48, 46, 5, a.m) + ln('M68 36Q66 48 56 45', MET_D, 3) + r(40, 21, 14, 4, a.m, 1));

const m4 = (a: Pal) => svg(320, 128,
  ln('M92 52H44L30 70L40 80H92', MET_L, 5) + r(36, 62, 14, 22, MET_D, 3) +
  r(90, 44, 74, 26, MET, 4) + r(90, 44, 74, 5, MET_L, 2) + r(100, 35, 80, 7, MET_D, 1) +
  r(104, 22, 26, 14, '#1a1d22', 5) + c(117, 29, 4, a.m) + r(160, 28, 8, 8, MET_D, 1) +
  r(162, 47, 82, 18, MET_D, 3) + [172, 184, 196, 208, 220].map((x) => c(x, 56, 3.5, '#0b0c0e')).join('') +
  r(244, 52, 38, 6, MET, 2) + r(280, 48, 16, 14, MET_D, 3) + r(236, 36, 5, 14, MET_D, 1) +
  p('M122 70H148L154 112Q146 116 138 112L122 80Z', MET_D) + ln('M128 82L145 102', MET, 2) +
  p('M96 70H112L108 102Q107 107 102 107H96Q92 107 93 102Z', MET_D) + r(108, 54, 26, 5, a.m, 1));

const exo = (a: Pal) => svg(100, 100,
  p('M26 10H74L90 26V50L76 62V92H24V62L10 50V26Z', MET) + p('M26 10H74L90 26H10Z', MET_L) +
  r(14, 28, 14, 30, a.d, 4) + r(72, 28, 14, 30, a.d, 4) + c(21, 62, 7, a.m) + c(79, 62, 7, a.m) +
  r(34, 28, 32, 34, '#14181d', 6) + c(50, 45, 11, a.m) + c(50, 45, 5, a.l) + ln('M34 70H66M34 78H66M34 86H66', a.m, 2.5) +
  ln('M26 12L12 26M74 12L88 26', a.l, 2.5) + ln('M24 62V92M76 62V92', a.l, 2, 'opacity=".6"'));

// ---------------- materials ----------------
const fuelCan = (a: Pal) => svg(64, 128,
  p('M16 34H48Q54 34 54 40V112Q54 120 46 120H18Q10 120 10 112V40Q10 34 16 34Z', '#c0392b') +
  p('M10 40Q10 34 16 34H48Q54 34 54 40Z', '#e05a4a') + ln('M24 14H40Q44 14 44 20V34H20V20Q20 14 24 14Z', '#7a1f16', 4) +
  r(38, 24, 14, 12, '#222', 3) + c(45, 24, 5, '#222') + ln('M20 50L44 104M44 50L20 104', '#8f261a', 4) +
  r(16, 62, 32, 24, '#f0e4c8', 2) + r(16, 62, 32, 5, a.m, 1) + ln('M22 76H42M22 81H36', '#444', 1.5));

const bolts = (a: Pal) => svg(64, 64,
  '<g transform="rotate(-30 32 32)">' + r(24, 12, 16, 8, '#9aa3ad', 1) + r(26, 20, 12, 36, '#c5cbd2', 1) +
  [24, 29, 34, 39, 44, 49].map((y) => ln(`M26 ${y}L38 ${y + 3}`, '#6d757e', 1.5)).join('') + r(27, 21, 3, 33, '#fff', 1, 'opacity=".45"') + '</g>' +
  '<g transform="rotate(40 32 32)">' + p('M42 40L48 36L54 40V48L48 52L42 48Z', '#9aa3ad') + c(48, 44, 3, '#22262c') + '</g>' +
  r(6, 50, 22, 5, a.m, 1));

const cannedFood = (a: Pal) => svg(64, 64,
  r(14, 16, 36, 40, '#cfd3d8', 4) + r(14, 16, 36, 40, 'none', 4, 'stroke="#8a929c" stroke-width="1.5"') +
  `<ellipse cx="32" cy="16" rx="18" ry="6" fill="#e6e9ed"/><ellipse cx="32" cy="16" rx="12" ry="3.5" fill="#aab1ba"/>` +
  r(14, 26, 36, 20, a.m, 0) + r(14, 26, 36, 3, a.l, 0, 'opacity=".5"') + c(32, 36, 6, '#f4f1e6') + ln('M28 36H36M32 32V40', '#b0392b', 2) +
  `<ellipse cx="32" cy="56" rx="18" ry="4" fill="#9aa1a9"/>`);

const gunParts = (a: Pal) => svg(64, 64,
  [0, 45, 90, 135].map((g) => `<g transform="rotate(${g} 24 38)">${r(21, 20, 6, 36, '#aab2bc', 1)}</g>`).join('') +
  c(24, 38, 13, '#c5ccd4') + c(24, 38, 6, '#20242a') + c(24, 38, 2.5, a.m) +
  r(38, 12, 22, 7, MET, 2) + r(54, 10, 5, 11, MET_D, 1) + ln('M40 26Q56 26 54 36Q52 46 44 44', '#d2d8de', 3) + r(36, 50, 22, 4, a.m, 1));

// ---------------- valuables ----------------
const watch = (a: Pal) => svg(64, 64,
  r(24, 4, 16, 18, '#3a2a1c', 3) + r(24, 42, 16, 18, '#3a2a1c', 3) + c(32, 32, 16, '#b8bec6') + c(32, 32, 13, '#f5f2e8') +
  [0, 90, 180, 270].map((g) => `<g transform="rotate(${g} 32 32)">${r(31, 21, 2, 4, '#333')}</g>`).join('') +
  ln('M32 32V24M32 32L38 35', '#222', 2) + c(32, 32, 1.8, a.m) + r(47, 30, 4, 4, '#b8bec6', 1));

const phone = (a: Pal) => svg(64, 64,
  r(18, 5, 28, 54, '#1b1f25', 5) + r(20, 10, 24, 42, '#2d7fd0', 2) + p('M20 10H44V30L20 42Z', '#5aa8f0', 'opacity=".55"') +
  r(27, 6.5, 10, 1.8, '#444', 1) + c(32, 55.5, 1.8, '#555') + r(22, 14, 10, 3, '#fff', 1, 'opacity=".7"') + r(22, 20, 16, 3, a.l, 1, 'opacity=".7"'));

const accessCard = (a: Pal) => svg(64, 64,
  '<g transform="rotate(-18 32 32)">' + r(6, 16, 52, 32, '#20303f', 4) + r(6, 16, 52, 5, a.m, 3) + r(6, 26, 52, 6, '#07090c') +
  r(12, 36, 12, 9, BRASS, 2) + r(30, 38, 22, 2.5, a.l, 1, 'opacity=".7"') + r(30, 43, 14, 2.5, a.l, 1, 'opacity=".4"') + '</g>');

const laptop = (a: Pal) => svg(128, 64,
  r(26, 6, 76, 40, '#2b3038', 4) + r(30, 10, 68, 32, '#16202b', 2) + p('M30 10H98V22L30 36Z', '#3a8fd8', 'opacity=".5"') +
  ln('M38 18H62M38 24H54', a.l, 2, 'opacity=".8"') + c(64, 8, 1.5, '#555') +
  p('M14 48H114L120 56Q120 58 117 58H11Q8 58 8 56Z', '#9aa1a9') + r(14, 48, 100, 3, '#c9cfd6', 1) + r(52, 53, 24, 3, '#6f7782', 1.5));

const goldBar = (a: Pal) => svg(64, 64,
  p('M12 48L20 26H44L52 48Z', '#f2c230') + p('M20 26H44L47 32H17Z', '#ffe27a') + p('M12 48H52L54 54H10Z', '#b8860b') +
  ln('M24 31L20 44', '#fff', 2, 'opacity=".5"') + `<text x="32" y="44" font-size="8" text-anchor="middle" fill="#8a6200" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="700">999.9</text>` + r(12, 55, 40, 2, a.m, 1));

const prototype = (a: Pal) => svg(128, 64,
  r(10, 8, 108, 48, '#17623a', 5) + [20, 34, 48].map((y) => ln(`M16 ${y}H48L56 ${y - 6}H100`, '#86e0a8', 1.5, 'opacity=".7"')).join('') +
  r(18, 14, 22, 18, '#22262c', 2) + r(20, 18, 18, 2, '#888') + r(20, 23, 18, 2, '#888') +
  r(84, 14, 24, 18, '#22262c', 2) + c(64, 36, 13, '#0e1216') + c(64, 36, 9, a.m) + c(64, 36, 4, a.l) +
  r(18, 42, 12, 8, BRASS, 1) + r(34, 42, 12, 8, BRASS, 1) + c(100, 46, 3, '#e53935') + c(108, 46, 3, '#43a047'));

const diamond = (a: Pal) => svg(64, 64,
  p('M18 20H46L58 32L32 58L6 32Z', '#7fd6f2') + p('M18 20H46L40 32H24Z', '#d6f6ff') + p('M6 32H24L32 58Z', '#4fb3d6') + p('M58 32H40L32 58Z', '#3d9cc2') +
  p('M24 32H40L32 58Z', '#a8e6fa') + ln('M18 20L24 32M46 20L40 32M6 32H58', '#e9fbff', 1.2, 'opacity=".8"') + r(8, 58, 48, 3, a.m, 1));

const server = (a: Pal) => svg(128, 128,
  r(20, 10, 88, 108, '#232830', 6) + [18, 44, 70, 96].map((y) => r(26, y, 76, 20, '#14181d', 3) + [0, 1, 2, 3, 4].map((i) => r(32 + i * 8, y + 5, 5, 10, '#2a313b', 1)).join('') + c(94, y + 10, 3, y % 2 ? a.m : '#43a047')).join('') +
  r(44, 52, 40, 36, '#e6b422', 5) + ln('M52 52V44Q52 30 64 30Q76 30 76 44V52', '#c9cdd3', 5) + c(64, 68, 6, '#3a2a00') + r(62, 70, 4, 10, '#3a2a00', 1) + r(20, 10, 88, 5, a.l, 3, 'opacity=".35"'));

const ART: Record<string, (a: Pal) => string> = {
  makarov, assault_rifle: m4, exo_armor: exo, fuel_can: fuelCan, bolts, canned_food: cannedFood, gun_parts: gunParts,
  cheap_watch: watch, phone, keycard: accessCard, laptop, gold_bar: goldBar, prototype_tech: prototype, bank_diamond: diamond, encrypted_server: server,
};

// ---------------- selection ----------------
const GUNS: Record<string, (a: Pal) => string> = { revolver, pistol, smg, shotgun, rifle, sniper };

export function itemArt(d: Def): string {
  const a = PALS[d.rarity] ?? PALS.common;
  const t = TIER[d.rarity] ?? 0;
  const s = spec(d.item_type);
  const [w] = dims(d);
  const tag = `${d.item_type} ${d.name}`.toLowerCase();
  if (ART[d.item_type]) return ART[d.item_type](a);

  if (s?.gun) {
    const am = s.gun.ammo;
    const kind = am === 'ammo_smg' ? 'smg' : am === 'ammo_shotgun' ? 'shotgun' : am === 'ammo_rifle' ? 'rifle' : am === 'ammo_sniper' ? 'sniper' : s.gun.mag <= 6 ? 'revolver' : 'pistol';
    return GUNS[kind](a);
  }
  if (s?.slot === 'head') return helmet(a, t);
  if (s?.slot === 'body') return vest(a, t);
  if (s?.slot === 'back') return backpack(a, t);
  if (s?.heal) return w >= 2 ? medkit(a) : dims(d)[1] >= 2 ? stim(a) : bandage(a);
  if (s?.door || /key|cheie/.test(tag)) {
    if (/bank|banca|card/.test(tag)) return keycard(a);
    return key(/warehouse|depozit|storage/.test(tag) ? '#aeb7c2' : BRASS, a, /warehouse|depozit|storage/.test(tag));
  }
  if (/^ammo_/.test(d.item_type)) return ammo(a, d.item_type);
  return crate(a);
}
