export const TILE = 32;
export const W = 104;
export const H = 72;
export const NX = 12;   // celule pe orizontala (8x8 tiles fiecare)
export const NY = 8;    // celule pe verticala
export const RESET_MS = 60 * 1000;   // loot-ul se reseteaza la fiecare minut
export const epochNow = () => Math.floor(Date.now() / RESET_MS);   // shortcut: ceasul clientului, abaterea de cateva secunde e tolerata

export type Zone = 'green' | 'yellow' | 'red';
export type WallKind = 'wall' | 'tree' | 'crate' | 'fence' | 'car' | 'lock' | 'shelf' | 'pump' | 'counter' | 'water';
export type Ground = 'floor' | 'grass' | 'paved' | 'tile' | 'road_h' | 'road_v' | 'dirt';
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

// Zone = inele concentrice dupa distanta fata de centrul hartii
export function zoneAt(tx: number, ty: number): Zone {
  const d = Math.max(Math.abs(tx - W / 2) / (W / 2), Math.abs(ty - H / 2) / (H / 2));
  return d < 0.3 ? 'red' : d < 0.65 ? 'yellow' : 'green';
}

const WEIGHTS: Record<Zone, [string, number][]> = {
  green: [['common', 70], ['uncommon', 30]],
  yellow: [['uncommon', 25], ['rare', 60], ['epic', 15]],
  red: [['rare', 20], ['epic', 55], ['legendary', 25]],
};

// Ce fel de loc apare intr-o celula, dupa zona
const VIP: [string, number][] = [['rare', 40], ['epic', 45], ['legendary', 15]];

const CELLS: Record<Zone, [string, number][]> = {
  green: [['house', 24], ['park', 10], ['parking', 8], ['plaza', 6], ['yard', 12], ['shop', 10], ['gas', 8], ['clinic', 8], ['lake', 8], ['market', 6]],
  yellow: [['house', 12], ['warehouse', 18], ['ruins', 10], ['yard', 6], ['parking', 6], ['plaza', 4], ['park', 6], ['shop', 10], ['gas', 8], ['clinic', 8], ['lake', 4], ['camp', 10], ['market', 4]],
  red: [['warehouse', 26], ['ruins', 28], ['house', 10], ['plaza', 6], ['shop', 6], ['clinic', 10], ['camp', 14]],
};

// Celule rezervate pentru comercianti (mereu in zona verde, aproape de extractii): "cx,cy" -> tip magazin
const TRADERS: Record<string, ShopKind> = {
  '1,1': 'arms', '10,6': 'arms', '10,1': 'ammo', '1,6': 'ammo',
  '5,0': 'med', '6,7': 'med', '1,3': 'gear', '10,4': 'gear',
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

export function rollItems(rng: () => number, zone: Zone, defs: ItemDef[], vip = false, tag?: string): Loot[] {
  const int = (n: number) => Math.floor(rng() * n);
  const tagPool = tag && TAGS[tag] ? defs.filter((d) => TAGS[tag].test(d.item_type.toLowerCase())) : [];
  return Array.from({ length: 1 + int(3) + (vip ? 1 : 0) }, () => {
    if (tagPool.length && rng() < 0.5) {
      const def = tagPool[int(tagPool.length)];
      return { item_type: def.item_type, quantity: qtyOf(rng, def) };
    }
    const rarity = pick(rng(), vip ? VIP : WEIGHTS[zone]);
    const pool = defs.filter((d) => d.rarity === rarity);
    const def = pool[int(pool.length)];
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

export function generateMap(seed: string, defs: ItemDef[]): GameMap {
  const rng = rngFrom(seed);
  const int = (n: number) => Math.floor(rng() * n);
  const walls: Wall[] = [];
  const ground: [number, number, Ground][] = [];
  const solid = new Set<number>();
  const key = (x: number, y: number) => y * 100 + x;

  const wall = (x: number, y: number, k: WallKind = 'wall') => {
    if (solid.has(key(x, y))) return;
    solid.add(key(x, y));
    walls.push([x, y, k]);
  };
  const lay = (x0: number, y0: number, w: number, h: number, g: Ground) => {
    for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) ground.push([x, y, g]);
  };
  // Un obstacol fara vecini solizi (8 directii) nu poate sigila niciodata un pasaj sau un container
  const isolated = (x: number, y: number) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (solid.has(key(x + dx, y + dy))) return false;
    return true;
  };

  // Marcaje pe strazi (decor): linie intrerupta pe mijlocul fiecarei strazi de 2 tiles
  for (let k = 0; k < NX - 1; k++) for (let y = 1; y < H - 1; y++) ground.push([11 + 8 * k, y, 'road_v']);
  for (let k = 0; k < NY - 1; k++) for (let x = 1; x < W - 1; x++) ground.push([x, 11 + 8 * k, 'road_h']);

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
  // 12x8 celule de 8x8 tiles, strazi de 2 tiles intre ele; fiecare celula primeste un tip de loc
  for (let cx = 0; cx < NX; cx++) {
    for (let cy = 0; cy < NY; cy++) {
      if ((cx === 5 || cx === 6) && (cy === 3 || cy === 4)) continue; // aici e banca
      const bx = 5 + cx * 8, by = 5 + cy * 8;
      const zone = zoneAt(bx + 3, by + 3);
      const trader = TRADERS[`${cx},${cy}`];
      const r0 = rng();
      const kind = trader ? 'trader' : pick(r0, CELLS[zone]);

      if (kind === 'trader') {
        // comerciant: cladire deschisa, podea alba, tejghea de 2 tiles (doua tile-uri solide, nu sigileaza interiorul 4x4)
        building(bx, by, 6, 6, [door(bx, by, 6, 6)]);
        lay(bx + 1, by + 1, 4, 4, 'tile');
        wall(bx + 2, by + 2, 'counter');
        wall(bx + 3, by + 2, 'counter');
        shops.push({ x: bx + 2, y: by + 2, kind: trader });
      } else if (kind === 'house' || kind === 'ruins') {
        const w = 5 + int(2), h = 5 + int(2);
        const d = door(bx, by, w, h);
        const locked = kind === 'house' && rng() < 0.45;   // case incuiate: cheia se gaseste in loot, dar si loot-ul e mai bun
        building(bx, by, w, h, [d], kind === 'ruins' ? 0.35 : 0);
        if (locked) lock(d[0], d[1], 'Casa', `h${cx}_${cy}`);
        addBox(bx + 1, by + 1, w - 2, h - 2, zone, 1 + int(2), locked);
      } else if (kind === 'warehouse') {
        // doua usi opuse, lazi in interior (doar pe pozitii pare: niciodata doua alaturate)
        const doors: [number, number][] = [[bx, by + 1 + int(4)], [bx + 5, by + 1 + int(4)]];
        building(bx, by, 6, 6, doors);
        for (const [dx, dy] of doors) lock(dx, dy, 'Depozit', `w${cx}_${cy}`);   // depozitele sunt incuiate
        for (const [ox, oy] of [[2, 2], [4, 2], [2, 4], [4, 4]]) if (rng() < 0.5) wall(bx + ox, by + oy, 'crate');
        addBox(bx + 1, by + 1, 4, 4, zone, 2 + int(2), true);
      } else if (kind === 'shop' || kind === 'clinic') {
        // magazin / farmacie: usa deschisa, podea alba, raft in mijloc (nu sigileaza niciodata interiorul 4x4)
        building(bx, by, 6, 6, [door(bx, by, 6, 6)]);
        lay(bx + 1, by + 1, 4, 4, 'tile');
        wall(bx + 2, by + 2, 'shelf');
        wall(bx + 3, by + 2, 'shelf');
        addBox(bx + 1, by + 1, 4, 4, zone, 2 + int(2), false, kind === 'clinic' ? 'med' : (['ammo', 'med', 'pack'] as const)[int(3)]);
      } else if (kind === 'gas') {
        // benzinarie: pavaj, magazin mic 3x3 in colt, doua pompe, o masina parcata
        lay(bx, by, 6, 6, 'paved');
        building(bx, by, 3, 3, [[bx + 1, by + 2]]);
        wall(bx + 5, by + 1, 'pump');
        wall(bx + 5, by + 4, 'pump');
        addBox(bx + 1, by + 1, 1, 1, zone, 1, false, 'ammo');
        addBox(bx + 3, by + 3, 3, 3, zone, 1);
        vspots.push([bx + 3, by + 4]);
      } else if (kind === 'park') {
        lay(bx, by, 6, 6, 'grass');
        for (let n = 8 + int(5); n > 0; n--) {
          const x = bx + int(6), y = by + int(6);
          if (isolated(x, y)) wall(x, y, 'tree');
        }
        addBox(bx, by, 6, 6, zone, 1 + int(2));
      } else if (kind === 'parking') {
        lay(bx, by, 6, 6, 'paved');
        for (const oy of [1, 4]) {
          for (const ox of [0, 3]) if (rng() < 0.7) { wall(bx + ox, by + oy, 'car'); wall(bx + ox + 1, by + oy, 'car'); }
        }
        addBox(bx, by, 6, 6, zone, 1);
      } else if (kind === 'plaza') {
        lay(bx, by, 6, 6, 'paved');
        for (let n = 3 + int(3); n > 0; n--) {
          const x = bx + 1 + int(4), y = by + 1 + int(4);
          if (isolated(x, y)) wall(x, y, 'crate');
        }
        addBox(bx + 2, by + 2, 2, 2, zone, 1);
      } else if (kind === 'lake') {
        // lac: apa 4x4 cu colturile rotunjite, mal liber pe margine (se poate ocoli), copaci in colturi
        lay(bx, by, 6, 6, 'grass');
        for (let x = 1; x < 5; x++) for (let y = 1; y < 5; y++) {
          if ((x === 1 || x === 4) && (y === 1 || y === 4)) continue;
          wall(bx + x, by + y, 'water');
        }
        for (const [ox, oy] of [[0, 0], [5, 0], [0, 5], [5, 5]]) if (rng() < 0.7 && isolated(bx + ox, by + oy)) wall(bx + ox, by + oy, 'tree');
        addBox(bx, by, 6, 6, zone, 2 + int(2));
      } else if (kind === 'camp') {
        // tabara militara: gard cu 4 porti, pamant batut, cateva lazi (corturi), loot tematic cu gloante
        lay(bx, by, 6, 6, 'dirt');
        const gT = bx + 1 + int(4), gB = bx + 1 + int(4), gL = by + 1 + int(4), gR = by + 1 + int(4);
        for (let i = 0; i < 6; i++) {
          if (bx + i !== gT) wall(bx + i, by, 'fence');
          if (bx + i !== gB) wall(bx + i, by + 5, 'fence');
          if (by + i !== gL) wall(bx, by + i, 'fence');
          if (by + i !== gR) wall(bx + 5, by + i, 'fence');
        }
        for (let n = 2; n > 0; n--) {
          const x = bx + 2 + int(2), y = by + 2 + int(2);
          if (isolated(x, y)) wall(x, y, 'crate');
        }
        addBox(bx + 1, by + 1, 4, 4, zone, 2 + int(2), zone === 'red', 'ammo');
      } else if (kind === 'market') {
        // piata: doua randuri de taraba (rafturi) pe pavaj; nu sigileaza nimic (mereu trecere pe margini)
        lay(bx, by, 6, 6, 'paved');
        for (const oy of [1, 4]) for (const ox of [1, 3]) if (rng() < 0.85) { wall(bx + ox, by + oy, 'shelf'); wall(bx + ox + 1, by + oy, 'shelf'); }
        addBox(bx, by, 6, 6, zone, 2 + int(2), false, rng() < 0.5 ? 'med' : 'ammo');
      } else {
        // yard: gard cu doua porti, casa 3x3 in coltul stanga-sus, coridor liber pe dreapta si jos
        lay(bx, by, 6, 6, 'grass');
        const gateA = by + 1 + int(3), gateB = bx + 1 + int(3);
        for (let i = 0; i < 6; i++) {
          wall(bx + i, by, 'fence');
          wall(bx, by + i, 'fence');
          if (bx + i !== gateB) wall(bx + i, by + 5, 'fence');
          if (by + i !== gateA) wall(bx + 5, by + i, 'fence');
        }
        building(bx + 1, by + 1, 3, 3, [[bx + 3, by + 2]]);
        addBox(bx + 2, by + 2, 1, 1, zone, 1);
        addBox(bx + 1, by + 4, 4, 1, zone, 1);
      }
    }
  }

  // Banca in centru (zona rosie): trei camere late, pereti interiori cu treceri decalate, doua usi
  const BX = 46, BY = 30, BW = 13, BH = 14;
  building(BX, BY, BW, BH, [[BX, BY + 2], [BX + BW - 1, BY + BH - 3]]);
  for (let x = BX + 1; x < BX + BW - 1; x++) {
    if (x !== BX + 3 && x !== BX + 9) wall(x, BY + 4);
    if (x !== BX + 2 && x !== BX + 10) wall(x, BY + 9);
  }
  lock(BX, BY + 2, 'Banca', 'bank');
  lock(BX + BW - 1, BY + BH - 3, 'Banca', 'bank');
  addBox(BX + 1, BY + 1, BW - 2, BH - 2, 'red', 10, true);

  // Masini si lazi imprastiate pe strazi, pentru acoperire
  for (let n = 130; n > 0; n--) {
    const x = 4 + int(W - 8), y = 4 + int(H - 8);
    if (isolated(x, y) && !containers.some((c) => c.x === x && c.y === y)) wall(x, y, rng() < 0.5 ? 'car' : 'crate');
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
  for (let n = 0; vehicles.length < 28 && n < 2000; n++) {
    if (rng() < 0.5) tryV(11 + 8 * int(NX - 1) + int(2), 3 + int(H - 6));
    else tryV(3 + int(W - 6), 11 + 8 * int(NY - 1) + int(2));
  }

  return { walls, ground, containers, extract, locks, vehicles, shops };
}