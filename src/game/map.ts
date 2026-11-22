export const TILE = 32;
export const W = 120;
export const H = 80;
export const RESET_MS = 5 * 60 * 1000;   // loot-ul se reseteaza la fiecare minut
export const epochNow = () => Math.floor(Date.now() / RESET_MS);   // shortcut: ceasul clientului, abaterea de cateva secunde e tolerata

export type Zone = 'green' | 'yellow' | 'red';
export type WallKind = 'wall' | 'tree' | 'crate' | 'fence' | 'car' | 'lock' | 'shelf' | 'pump' | 'counter' | 'water';
export type Ground = 'floor' | 'grass' | 'paved' | 'tile' | 'road_h' | 'road_v' | 'dirt' | 'sidewalk' | 'cross_h' | 'cross_v';
export type Wall = [number, number, WallKind?];
export type ItemDef = { item_type: string; name: string; rarity: string; slots: number; stackable: boolean; search_time_ms: number };
export type Loot = { item_type: string; quantity: number };
// vip = cladire incuiata: loot mai bun; tag = loot tematic (ammo / med); px,py = pozitia exacta (drop-uri de la jucatori morti)
export type Container = { x: number; y: number; zone: Zone; items: Loot[]; vip?: boolean; tag?: string; px?: number; py?: number };
// Usa incuiata: toate usile aceleiasi cladiri au acelasi id; `key` = ce item o deschide (vezi `door` in items.ts)
export type Lock = { x: number; y: number; key: string; id: string };
export type Vehicle = { x: number; y: number; a: number };   // tile + unghi (radiani)
// Magazin cu vanzator: x,y = tile-ul din stanga al tejghelei (tejgheaua ocupa x si x+1)
export type ShopKind = 'arms' | 'ammo' | 'med' | 'gear';
export type Shop = { x: number; y: number; kind: ShopKind };
export const SHOP_INFO: Record<ShopKind, { name: string; color: number; hex: string }> = {
  arms: { name: 'ARMURERIE', color: 0xef5350, hex: '#ef5350' },
  ammo: { name: 'MUNITII', color: 0xffca28, hex: '#ffca28' },
  med: { name: 'FARMACIE', color: 0x66bb6a, hex: '#66bb6a' },
  gear: { name: 'ECHIPAMENT & RUCSACURI', color: 0x42a5f5, hex: '#42a5f5' },
};
export type GameMap = {
  walls: Wall[];                                // toate blocheaza miscarea
  ground: [number, number, Ground][];           // doar decor (podea, iarba, asfalt)
  containers: Container[];
  extract: { x: number; y: number; w: number; h: number }[];
  locks: Lock[];
  vehicles: Vehicle[];
  shops: Shop[];
};

// Doar peretii, copacii, lazile si usile incuiate blocheaza vederea; gardurile, masinile, rafturile si pompele nu
export const blocksView = (k: WallKind = 'wall') => k === 'wall' || k === 'tree' || k === 'crate' || k === 'lock';

// Zone = inele concentrice dupa distanta fata de centrul hartii (conteaza DOAR pentru calitatea loot-ului, nu si pentru aspectul terenului)
export function zoneAt(tx: number, ty: number): Zone {
  const d = Math.max(Math.abs(tx - W / 2) / (W / 2), Math.abs(ty - H / 2) / (H / 2));
  return d < 0.3 ? 'red' : d < 0.65 ? 'yellow' : 'green';
}

const WEIGHTS: Record<Zone, [string, number][]> = {
  green: [['common', 82], ['uncommon', 17], ['rare', 1]],
  yellow: [['common', 40], ['uncommon', 35], ['rare', 20], ['epic', 5]],
  red: [['uncommon', 25], ['rare', 50], ['epic', 22], ['legendary', 3]],
};

// Ce fel de loc apare intr-o celula, dupa zona
const VIP: [string, number][] = [['rare', 62], ['epic', 34], ['legendary', 4]];

const CELLS: Record<Zone, [string, number][]> = {
  green: [['house', 24], ['park', 10], ['parking', 8], ['plaza', 6], ['yard', 12], ['shop', 10], ['gas', 8], ['clinic', 8], ['lake', 8], ['market', 6]],
  yellow: [['house', 12], ['warehouse', 18], ['ruins', 10], ['yard', 6], ['parking', 6], ['plaza', 4], ['park', 6], ['shop', 10], ['gas', 8], ['clinic', 8], ['lake', 4], ['camp', 10], ['market', 4]],
  red: [['warehouse', 26], ['ruins', 28], ['house', 10], ['plaza', 6], ['shop', 6], ['clinic', 10], ['camp', 14]],
};

// Loturi mici (cel putin o latura sub 6 tiles): doar lucruri care incap pe 5x5
const SMALL: Record<Zone, [string, number][]> = {
  green: [['house', 45], ['park', 20], ['parking', 20], ['plaza', 15]],
  yellow: [['house', 30], ['ruins', 25], ['parking', 20], ['plaza', 10], ['park', 15]],
  red: [['ruins', 50], ['house', 20], ['parking', 20], ['plaza', 10]],
};

// Loot tematic: magazinele dau gloante / medicamente / rucsacuri (doar daca exista in item_defs)
const TAGS: Record<string, RegExp> = {
  ammo: /^ammo_/,
  med: /bandage|medkit|stim|bandaj|trusa|firstaid|first_aid|pastil|painkill|morfin/,
  pack: /backpack|rucsac|ghiozdan/,
};

function pick(r: number, table: [string, number][]) {
  let t = r * table.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of table) if ((t -= w) < 0) return k;
  return table[0][0];
}

// Acelasi seed (codul sesiunii) => aceeasi harta si acelasi loot la toti jucatorii
export function rngFrom(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const qtyOf = (rng: () => number, d: ItemDef) =>
  d.item_type.startsWith('ammo_') ? 8 + Math.floor(rng() * 23) : d.stackable ? 1 + Math.floor(rng() * 3) : 1;

// Chei: NU mai cad ca iteme normale, ci au o sansa proprie (per item rulat dintr-un container)
const isKey = (t: string) => /key|cheie/.test(t);
const keyKind = (t: string): 'bank' | 'warehouse' | 'house' =>
  /bank|banca/.test(t) ? 'bank' : /warehouse|depozit|storage/.test(t) ? 'warehouse' : 'house';
const KEY_CHANCE = { house: 0.015, warehouse: 0.006, bank: 0.0015 };   // bank = doar in containere VIP

export function rollItems(rng: () => number, zone: Zone, defs: ItemDef[], vip = false, tag?: string): Loot[] {
  const int = (n: number) => Math.floor(rng() * n);
  const keys = defs.filter((d) => isKey(d.item_type.toLowerCase()));
  const normal = defs.filter((d) => !isKey(d.item_type.toLowerCase()));
  const tagPool = tag && TAGS[tag] ? normal.filter((d) => TAGS[tag].test(d.item_type.toLowerCase())) : [];
  return Array.from({ length: 1 + int(3) + (vip ? 1 : 0) }, () => {
    for (const k of keys) {
      const kind = keyKind(k.item_type.toLowerCase());
      if (kind === 'bank' && !vip) continue;
      if (rng() < KEY_CHANCE[kind]) return { item_type: k.item_type, quantity: 1 };
    }
    if (tagPool.length && rng() < 0.5) {
      const def = tagPool[int(tagPool.length)];
      return { item_type: def.item_type, quantity: qtyOf(rng, def) };
    }
    const rarity = pick(rng(), vip ? VIP : WEIGHTS[zone]);
    const pool = normal.filter((d) => d.rarity === rarity);
    const safe = pool.length ? pool : normal.filter((d) => d.rarity !== 'legendary');
    const def = safe[int(safe.length)];
    return { item_type: def.item_type, quantity: qtyOf(rng, def) };
  });
}

// Loot nou pe aceleasi containere; acelasi epoch => acelasi loot la toti jucatorii, fara retea
export function rerollLoot(map: GameMap, epoch: number, defs: ItemDef[], n = map.containers.length) {
  for (let i = 0; i < n; i++) {
    const c = map.containers[i];
    c.items = rollItems(rngFrom(`${epoch}:${i}`), c.zone, defs, c.vip, c.tag);
  }
}

type Rect = { x: number; y: number; w: number; h: number };

export function generateMap(seed: string, defs: ItemDef[]): GameMap {
  const rng = rngFrom(seed);
  const int = (n: number) => Math.floor(rng() * n);
  const walls: Wall[] = [];
  const groundAt = new Map<number, Ground>();   // ultimul strat castiga: un tile are un singur teren (mai putine imagini in joc)
  const solid = new Set<number>();
  const key = (x: number, y: number) => y * 1000 + x;

  const wall = (x: number, y: number, k: WallKind = 'wall') => {
    if (solid.has(key(x, y))) return;
    solid.add(key(x, y));
    walls.push([x, y, k]);
  };
  const lay = (x0: number, y0: number, w: number, h: number, g: Ground) => {
    for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) groundAt.set(key(x, y), g);
  };
  // Un obstacol fara vecini solizi (8 directii) nu poate sigila niciodata un pasaj sau un container
  const isolated = (x: number, y: number) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (solid.has(key(x + dx, y + dy))) return false;
    return true;
  };

  // ---------- reteaua de strazi ----------
  // Blocuri de 10..17 tiles separate de strazi de 2 tiles (cate 1-2 artere late de 4); un bloc e rezervat bancii (mereu in treimea din mijloc, dar nu fix in centru)
  type Axis = { blocks: [number, number][]; streets: [number, number][]; bank: number };
  const layoutAxis = (len: number, avenues: number, bankSize: number): Axis => {
    const n = Math.round((len + 2) / 15);
    const sw: number[] = Array(n - 1).fill(2);
    for (let a = avenues; a > 0; a--) {
      const i = int(n - 1);
      if (sw[i] === 2 && sw[i - 1] !== 4 && sw[i + 1] !== 4) sw[i] = 4;
    }
    const mids: number[] = [];
    for (let i = 0; i < n; i++) if ((i + 0.5) / n >= 0.3 && (i + 0.5) / n <= 0.7) mids.push(i);
    const bank = mids[int(mids.length)];
    const rest = len - sw.reduce((s, v) => s + v, 0) - bankSize;
    const base = Math.floor(rest / (n - 1));
    let extra = rest - base * (n - 1);
    const size: number[] = [];
    for (let i = 0; i < n; i++) size.push(i === bank ? bankSize : base + (extra-- > 0 ? 1 : 0));
    for (let t = 0; t < 80; t++) {   // blocuri de marimi diferite
      const a = int(n), b = int(n), d = 1 + int(2);
      if (a === b || a === bank || b === bank) continue;
      if (size[a] - d >= 10 && size[b] + d <= 17) { size[a] -= d; size[b] += d; }
    }
    const blocks: [number, number][] = [], streets: [number, number][] = [];
    let p = 5;
    for (let i = 0; i < n; i++) {
      blocks.push([p, size[i]]);
      p += size[i];
      if (i < n - 1) { streets.push([p, sw[i]]); p += sw[i]; }
    }
    return { blocks, streets, bank };
  };
  const BANK_W = 13, BANK_H = 14;
  const AX = layoutAxis(W - 10, 1 + int(2), BANK_W + 4);
  const AY = layoutAxis(H - 10, 1, BANK_H + 4);
  const inStreet = (streets: [number, number][], v: number) => streets.some(([s, w]) => v >= s && v < s + w);

  // Marcaje: linie intrerupta pe mijlocul strazilor, in afara intersectiilor; zebre la fiecare intersectie
  for (const [s, w] of AX.streets) for (let y = 1; y < H - 1; y++) if (!inStreet(AY.streets, y)) lay(s + w / 2 - 1, y, 1, 1, 'road_v');
  for (const [s, w] of AY.streets) for (let x = 1; x < W - 1; x++) if (!inStreet(AX.streets, x)) lay(x, s + w / 2 - 1, 1, 1, 'road_h');
  for (const [vx, vw] of AX.streets) for (const [hy, hh] of AY.streets) {
    lay(vx, hy - 1, vw, 1, 'cross_v'); lay(vx, hy + hh, vw, 1, 'cross_v');
    lay(vx - 1, hy, 1, hh, 'cross_h'); lay(vx + vw, hy, 1, hh, 'cross_h');
  }

  for (let x = 0; x < W; x++) { wall(x, 0); wall(x, H - 1); }
  for (let y = 1; y < H - 1; y++) { wall(0, y); wall(W - 1, y); }

  // Cladire: pereti pe margine, usi = tile-uri lipsa, ruine = spargeri aleatoare
  const building = (bx: number, by: number, w: number, h: number, doors: [number, number][], breach = 0) => {
    lay(bx + 1, by + 1, w - 2, h - 2, 'floor');
    for (let x = bx; x < bx + w; x++) {
      for (let y = by; y < by + h; y++) {
        if (x !== bx && x !== bx + w - 1 && y !== by && y !== by + h - 1) continue;
        const corner = (x === bx || x === bx + w - 1) && (y === by || y === by + h - 1);
        if (doors.some(([dx, dy]) => dx === x && dy === y) || (!corner && rng() < breach)) continue;
        wall(x, y);
      }
    }
  };
  const door = (bx: number, by: number, w: number, h: number): [number, number] => {
    const side = int(4);
    return side < 2
      ? [bx + 1 + int(w - 2), side ? by + h - 1 : by]
      : [side === 2 ? bx : bx + w - 1, by + 1 + int(h - 2)];
  };

  const containers: Container[] = [];
  const locks: Lock[] = [];
  const lock = (x: number, y: number, k: string, id: string) => { wall(x, y, 'lock'); locks.push({ x, y, key: k, id }); };
  // Pune pana la n containere in dreptunghiul dat, pe tile-uri libere
  const addBox = (x0: number, y0: number, w: number, h: number, zone: Zone, n: number, vip = false, tag?: string) => {
    for (; n > 0; n--) {
      const x = x0 + int(w), y = y0 + int(h);
      if (solid.has(key(x, y)) || containers.some((c) => c.x === x && c.y === y)) continue;
      containers.push({ x, y, zone, items: rollItems(rng, zone, defs, vip, tag), vip, tag });
    }
  };
  const vspots: [number, number][] = [];   // locuri pentru masini (benzinarii)
  const shops: Shop[] = [];

  // ---------- blocuri si loturi ----------
  // Fiecare bloc: trotuar pe margine, apoi interiorul impartit in 1-4 loturi (separate de alei de 1 tile, deci mereu ocolibile)
  const lots: Rect[] = [];
  const subdivide = (r: Rect) => {
    const cv = r.w >= 11, ch = r.h >= 11;
    if ((cv || ch) && rng() < 0.85) {
      const vertical = cv && (!ch || r.w > r.h || (r.w === r.h && rng() < 0.5));
      if (vertical) {
        const a = 5 + int(r.w - 10);
        subdivide({ x: r.x, y: r.y, w: a, h: r.h });
        subdivide({ x: r.x + a + 1, y: r.y, w: r.w - a - 1, h: r.h });
      } else {
        const a = 5 + int(r.h - 10);
        subdivide({ x: r.x, y: r.y, w: r.w, h: a });
        subdivide({ x: r.x, y: r.y + a + 1, w: r.w, h: r.h - a - 1 });
      }
      return;
    }
    lots.push(r);
  };
  const ring: [number, number][] = [];   // tile-uri de trotuar (pentru copaci stradali)
  let bankBlock: Rect = { x: 0, y: 0, w: 0, h: 0 };
  AX.blocks.forEach(([bx, bw], i) => AY.blocks.forEach(([by, bh], j) => {
    lay(bx, by, bw, bh, 'sidewalk');
    for (let x = bx + 1; x < bx + bw - 1; x++) ring.push([x, by], [x, by + bh - 1]);
    for (let y = by + 1; y < by + bh - 1; y++) ring.push([bx, y], [bx + bw - 1, y]);
    if (i === AX.bank && j === AY.bank) bankBlock = { x: bx, y: by, w: bw, h: bh };
    else subdivide({ x: bx + 1, y: by + 1, w: bw - 2, h: bh - 2 });
  }));

  // Comerciantii: 8 loturi din zona verde, cat mai departe unul de altul; cele doua magazine de acelasi fel sunt si ele departe
  const zoneOf = (r: Rect) => zoneAt(r.x + (r.w >> 1), r.y + (r.h >> 1));
  const dist = (a: Rect, b: Rect) => Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2);
  const traderOf = new Map<number, ShopKind>();
  {
    const big = lots.map((_, i) => i).filter((i) => lots[i].w >= 6 && lots[i].h >= 6);
    let cand = big.filter((i) => zoneOf(lots[i]) === 'green');
    if (cand.length < 8) cand = big;
    const picked = [cand[int(cand.length)]];
    while (picked.length < 8) {
      let best = -1, bd = -1;
      for (const i of cand) {
        if (picked.includes(i)) continue;
        const d = Math.min(...picked.map((p) => dist(lots[i], lots[p])));
        if (d > bd) { bd = d; best = i; }
      }
      picked.push(best);
    }
    const kinds: ShopKind[] = ['arms', 'ammo', 'med', 'gear'];
    for (let i = kinds.length - 1; i > 0; i--) { const j = int(i + 1); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
    const first = new Map<ShopKind, number>();
    kinds.forEach((k, n) => { traderOf.set(picked[n], k); first.set(k, picked[n]); });
    const left = [...kinds];
    for (const p of picked.slice(4)) {
      let best = 0, bd = -1;
      left.forEach((k, n) => { const d = dist(lots[p], lots[first.get(k)!]); if (d > bd) { bd = d; best = n; } });
      traderOf.set(p, left.splice(best, 1)[0]);
    }
  }

  lots.forEach((L, li) => {
    const { x: lx, y: ly, w: lw, h: lh } = L;
    const zone = zoneOf(L);
    const trader = traderOf.get(li);
    const kind = trader ? 'trader' : pick(rng(), Math.min(lw, lh) < 6 ? SMALL[zone] : CELLS[zone]);
    const area = lw * lh;

    if (kind === 'trader') {
      // comerciant: cladire deschisa 6x6, podea alba, tejghea de 2 tiles (nu sigileaza interiorul 4x4)
      const bx = lx + int(lw - 5), by = ly + int(lh - 5);
      lay(lx, ly, lw, lh, 'paved');
      building(bx, by, 6, 6, [door(bx, by, 6, 6)]);
      lay(bx + 1, by + 1, 4, 4, 'tile');
      wall(bx + 2, by + 2, 'counter');
      wall(bx + 3, by + 2, 'counter');
      shops.push({ x: bx + 2, y: by + 2, kind: trader! });
    } else if (kind === 'house' || kind === 'ruins') {
      // casa pe gazon (sau ruina pe pamant), mai mare daca incape; peste 7 tiles latime are un perete interior cu trecere
      const hw = Math.min(lw, 5 + int(4)), hh = Math.min(lh, 5 + int(3));
      const bx = lx + int(lw - hw + 1), by = ly + int(lh - hh + 1);
      lay(lx, ly, lw, lh, kind === 'house' ? 'grass' : 'dirt');
      const part = kind === 'house' && hw >= 7 ? bx + 3 : -1;
      let d = door(bx, by, hw, hh);
      while (d[0] === part && (d[1] === by || d[1] === by + hh - 1)) d = door(bx, by, hw, hh);
      const locked = kind === 'house' && rng() < 0.45;   // case incuiate: cheia se gaseste in loot, dar si loot-ul e mai bun
      building(bx, by, hw, hh, [d], kind === 'ruins' ? 0.35 : 0);
      if (part >= 0) { const gap = by + 1 + int(hh - 2); for (let y = by + 1; y < by + hh - 1; y++) if (y !== gap) wall(part, y); }
      if (locked) lock(d[0], d[1], 'Casa', `h${li}`);
      addBox(bx + 1, by + 1, hw - 2, hh - 2, zone, 1 + int(2) + (hw * hh > 40 ? 1 : 0), locked);
      for (let n = kind === 'house' ? int(3) + (area > 70 ? 2 : 0) : 2 + int(3); n > 0; n--) {
        const x = lx + int(lw), y = ly + int(lh);
        if (isolated(x, y) && !containers.some((c) => c.x === x && c.y === y)) wall(x, y, kind === 'house' ? 'tree' : 'crate');
      }
    } else if (kind === 'warehouse') {
      // depozit mare, doua usi opuse, lazi in interior pe o grila rara (nu ating peretii: interiorul ramane strabatabil)
      const bw = Math.min(lw, 6 + int(5)), bh = Math.min(lh, 6 + int(3));
      const bx = lx + int(lw - bw + 1), by = ly + int(lh - bh + 1);
      lay(lx, ly, lw, lh, 'paved');
      const doors: [number, number][] = [[bx, by + 1 + int(bh - 2)], [bx + bw - 1, by + 1 + int(bh - 2)]];
      building(bx, by, bw, bh, doors);
      for (const [dx, dy] of doors) lock(dx, dy, 'Depozit', `w${li}`);   // depozitele sunt incuiate
      for (let ox = 2; ox <= bw - 3; ox += 2) for (let oy = 2; oy <= bh - 3; oy += 2) if (rng() < 0.45) wall(bx + ox, by + oy, 'crate');
      addBox(bx + 1, by + 1, bw - 2, bh - 2, zone, 2 + int(2) + (bw * bh > 50 ? 1 : 0), true);
    } else if (kind === 'shop' || kind === 'clinic') {
      // magazin / farmacie: usa deschisa, podea alba, 1-2 randuri de rafturi (nu ating peretii)
      const bw = Math.min(lw, 6 + int(3)), bh = Math.min(lh, 6 + int(2));
      const bx = lx + int(lw - bw + 1), by = ly + int(lh - bh + 1);
      lay(lx, ly, lw, lh, 'paved');
      building(bx, by, bw, bh, [door(bx, by, bw, bh)]);
      lay(bx + 1, by + 1, bw - 2, bh - 2, 'tile');
      for (let x = bx + 2; x <= bx + bw - 3; x++) { wall(x, by + 2, 'shelf'); if (bh === 7) wall(x, by + 4, 'shelf'); }
      addBox(bx + 1, by + 1, bw - 2, bh - 2, zone, 2 + int(2), false, kind === 'clinic' ? 'med' : (['ammo', 'med', 'pack'] as const)[int(3)]);
    } else if (kind === 'gas') {
      // benzinarie: pavaj, magazin mic 3x3 in colt, doua pompe, o masina parcata
      lay(lx, ly, lw, lh, 'paved');
      building(lx, ly, 3, 3, [[lx + 1, ly + 2]]);
      wall(lx + lw - 1, ly + 1, 'pump');
      wall(lx + lw - 1, ly + lh - 2, 'pump');
      addBox(lx + 1, ly + 1, 1, 1, zone, 1, false, 'ammo');
      addBox(lx + 3, ly + 3, lw - 3, lh - 3, zone, 1);
      vspots.push([lx + 3, ly + lh - 2]);
    } else if (kind === 'park') {
      lay(lx, ly, lw, lh, 'grass');
      if (area >= 49) { lay(lx, ly + (lh >> 1), lw, 1, 'paved'); lay(lx + (lw >> 1), ly, 1, lh, 'paved'); }   // alei
      for (let n = Math.floor(area / 4.5) + int(4); n > 0; n--) {
        const x = lx + int(lw), y = ly + int(lh);
        if (groundAt.get(key(x, y)) !== 'paved' && isolated(x, y)) wall(x, y, 'tree');
      }
      addBox(lx, ly, lw, lh, zone, 1 + int(2) + (area > 80 ? 1 : 0));
    } else if (kind === 'parking') {
      lay(lx, ly, lw, lh, 'paved');
      for (const oy of [1, lh - 2]) {
        for (let ox = 0; ox + 1 < lw; ox += 3) if (rng() < 0.7) { wall(lx + ox, ly + oy, 'car'); wall(lx + ox + 1, ly + oy, 'car'); }
      }
      addBox(lx, ly, lw, lh, zone, 1 + (area > 70 ? 1 : 0));
    } else if (kind === 'plaza') {
      lay(lx, ly, lw, lh, 'paved');
      if (lw >= 7 && lh >= 7) {   // fantana in mijloc
        const fx = lx + (lw >> 1) - 1, fy = ly + (lh >> 1) - 1;
        for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) wall(fx + dx, fy + dy, 'water');
      }
      for (let n = 3 + int(3); n > 0; n--) {
        const x = lx + 1 + int(lw - 2), y = ly + 1 + int(lh - 2);
        if (isolated(x, y)) wall(x, y, 'crate');
      }
      addBox(lx + 1, ly + 1, lw - 2, lh - 2, zone, 1 + (area > 80 ? 1 : 0));
    } else if (kind === 'lake') {
      // lac cu colturile rotunjite, mal liber pe margine (se poate ocoli), copaci in colturi
      lay(lx, ly, lw, lh, 'grass');
      const ww = Math.min(lw - 2, 9), wh = Math.min(lh - 2, 9);
      const wx = lx + 1 + int(lw - 2 - ww + 1), wy = ly + 1 + int(lh - 2 - wh + 1);
      for (let x = 0; x < ww; x++) for (let y = 0; y < wh; y++) {
        if ((x === 0 || x === ww - 1) && (y === 0 || y === wh - 1)) continue;
        wall(wx + x, wy + y, 'water');
      }
      for (const [ox, oy] of [[0, 0], [lw - 1, 0], [0, lh - 1], [lw - 1, lh - 1]]) if (rng() < 0.7 && isolated(lx + ox, ly + oy)) wall(lx + ox, ly + oy, 'tree');
      addBox(lx, ly, lw, lh, zone, 2 + int(2));
    } else if (kind === 'camp') {
      // tabara militara: gard cu 4 porti, pamant batut, cateva lazi (corturi), loot tematic cu gloante
      lay(lx, ly, lw, lh, 'dirt');
      const gT = lx + 1 + int(lw - 2), gB = lx + 1 + int(lw - 2), gL = ly + 1 + int(lh - 2), gR = ly + 1 + int(lh - 2);
      for (let i = 0; i < lw; i++) {
        if (lx + i !== gT) wall(lx + i, ly, 'fence');
        if (lx + i !== gB) wall(lx + i, ly + lh - 1, 'fence');
      }
      for (let i = 0; i < lh; i++) {
        if (ly + i !== gL) wall(lx, ly + i, 'fence');
        if (ly + i !== gR) wall(lx + lw - 1, ly + i, 'fence');
      }
      for (let n = 2 + (area > 60 ? 2 : 0); n > 0; n--) {
        const x = lx + 2 + int(lw - 4), y = ly + 2 + int(lh - 4);
        if (isolated(x, y)) wall(x, y, 'crate');
      }
      addBox(lx + 1, ly + 1, lw - 2, lh - 2, zone, 2 + int(2), zone === 'red', 'ammo');
    } else if (kind === 'market') {
      // piata: randuri de taraba (rafturi) pe pavaj; marginile raman libere
      lay(lx, ly, lw, lh, 'paved');
      for (const oy of lh >= 9 ? [1, lh >> 1, lh - 2] : [1, lh - 2])
        for (let ox = 1; ox + 1 <= lw - 2; ox += 2) if (rng() < 0.85) { wall(lx + ox, ly + oy, 'shelf'); wall(lx + ox + 1, ly + oy, 'shelf'); }
      addBox(lx, ly, lw, lh, zone, 2 + int(2), false, rng() < 0.5 ? 'med' : 'ammo');
    } else {
      // curte: gard cu doua porti, casa in coltul stanga-sus, coridor liber pe dreapta si jos
      lay(lx, ly, lw, lh, 'grass');
      const hw = Math.min(lw - 3, 3 + int(3)), hh = Math.min(lh - 3, 3 + int(3));
      const gateA = ly + 1 + int(lh - 2), gateB = lx + 1 + int(lw - 2);
      for (let i = 0; i < lw; i++) { wall(lx + i, ly, 'fence'); if (lx + i !== gateB) wall(lx + i, ly + lh - 1, 'fence'); }
      for (let i = 0; i < lh; i++) { wall(lx, ly + i, 'fence'); if (ly + i !== gateA) wall(lx + lw - 1, ly + i, 'fence'); }
      building(lx + 1, ly + 1, hw, hh, [[lx + hw, ly + 2]]);
      addBox(lx + 2, ly + 2, hw - 2, hh - 2, zone, 1);
      addBox(lx + 1, ly + hh + 1, lw - 2, 1, zone, 1);
    }
  });

  // Banca: intr-un bloc din mijlocul hartii, cu pozitie aleatoare in bloc; trei camere late, pereti interiori cu treceri decalate, doua usi
  const BW = BANK_W, BH = BANK_H;
  const BX = bankBlock.x + 1 + int(bankBlock.w - 2 - BW + 1), BY = bankBlock.y + 1 + int(bankBlock.h - 2 - BH + 1);
  lay(bankBlock.x + 1, bankBlock.y + 1, bankBlock.w - 2, bankBlock.h - 2, 'paved');
  building(BX, BY, BW, BH, [[BX, BY + 2], [BX + BW - 1, BY + BH - 3]]);
  for (let x = BX + 1; x < BX + BW - 1; x++) {
    if (x !== BX + 3 && x !== BX + 9) wall(x, BY + 4);
    if (x !== BX + 2 && x !== BX + 10) wall(x, BY + 9);
  }
  lock(BX, BY + 2, 'Banca', 'bank');
  lock(BX + BW - 1, BY + BH - 3, 'Banca', 'bank');
  addBox(BX + 1, BY + 1, BW - 2, BH - 2, 'red', 10, true);

  // Copaci pe trotuare
  for (const [x, y] of ring) if (rng() < 0.1 && isolated(x, y) && !containers.some((c) => c.x === x && c.y === y)) wall(x, y, 'tree');

  // Masini abandonate si lazi, mai ales pe strazi
  const onStreet = (): [number, number] => {
    if (rng() < 0.5) { const [s, w] = AX.streets[int(AX.streets.length)]; return [s + int(w), 4 + int(H - 8)]; }
    const [s, w] = AY.streets[int(AY.streets.length)];
    return [4 + int(W - 8), s + int(w)];
  };
  for (let n = 170; n > 0; n--) {
    const [x, y] = rng() < 0.7 ? onStreet() : [4 + int(W - 8), 4 + int(H - 8)];
    if (isolated(x, y) && !containers.some((c) => c.x === x && c.y === y)) wall(x, y, rng() < 0.65 ? 'car' : 'crate');
  }

  const extract = [
    { x: 1, y: H / 2 - 2, w: 3, h: 4 }, { x: W - 4, y: H / 2 - 2, w: 3, h: 4 },
    { x: W / 2 - 2, y: 1, w: 4, h: 3 }, { x: W / 2 - 2, y: H - 4, w: 4, h: 3 },
    { x: 1, y: 1, w: 3, h: 3 }, { x: W - 4, y: 1, w: 3, h: 3 },
    { x: 1, y: H - 4, w: 3, h: 3 }, { x: W - 4, y: H - 4, w: 3, h: 3 },
  ];

  // Vehicule conductibile: benzinarii + strazi (loc liber 3x3, departe de zonele de extractie)
  const vehicles: Vehicle[] = [];
  const tryV = (x: number, y: number) => {
    if (x < 2 || y < 2 || x > W - 3 || y > H - 3) return;
    if (extract.some((r) => x >= r.x - 2 && x <= r.x + r.w + 1 && y >= r.y - 2 && y <= r.y + r.h + 1)) return;
    if (x >= BX - 1 && x <= BX + BW && y >= BY - 1 && y <= BY + BH) return;   // nu in banca
    if (!isolated(x, y) || containers.some((c) => Math.abs(c.x - x) <= 1 && Math.abs(c.y - y) <= 1)) return;
    if (vehicles.some((v) => Math.abs(v.x - x) < 4 && Math.abs(v.y - y) < 4)) return;
    vehicles.push({ x, y, a: rng() < 0.5 ? 0 : Math.PI / 2 });
  };
  for (const [x, y] of vspots) tryV(x, y);
  for (let n = 0; vehicles.length < 34 && n < 3000; n++) {
    const [x, y] = onStreet();
    tryV(x, y);
  }

  const ground = [...groundAt].map(([k, g]) => [k % 1000, Math.floor(k / 1000), g] as [number, number, Ground]);
  return { walls, ground, containers, extract, locks, vehicles, shops };
}