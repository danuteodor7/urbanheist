import type { ItemDef } from './map';

export type Slot = 'head' | 'body' | 'weapon' | 'back';
// Inventarul de baza (fara rucsac echipat): buzunare
export const BASE_BAG = { w: 6, h: 4 };
export type Def = ItemDef & { base_value?: number };
// x,y = celula stanga-sus in grid; r = rotit 90°; found = gasit in raid (nu adus din stash)
export type Item = { id: string; type: string; qty: number; x: number; y: number; r: boolean; found?: boolean };

export type Gun = {
  dmg: number; fire: number; spread: number; pellets: number; speed: number; life: number;
  mag: number;          // marimea incarcatorului
  reload: number;       // ms
  ammo?: string;        // tipul de item-gloante (lipsa = gloante infinite)
  range?: number;       // raza de vedere (sniper)
  fov?: number;         // unghiul conului de vedere (radiani)
};
export type Spec = {
  w: number; h: number; slot?: Slot;
  gun?: Gun;                              // arma
  red?: number;                           // armura: fractia de damage redusa
  heal?: { hp: number; ms: number };      // consumabil
  door?: string;                          // cheie: numele cladirii pe care o deschide
  pack?: { w: number; h: number };        // rucsac: dimensiunea gridului de inventar cand e echipat
};

// Pistolul e arma implicita: nu e item in baza de date, il ai mereu cand slotul de arma e gol (gloante infinite, dar se reincarca)
export const PISTOL: Gun = { dmg: 20, fire: 300, spread: 0.04, pellets: 1, speed: 520, life: 1100, mag: 12, reload: 900 };

export const AMMO_TYPES = ['ammo_pistol', 'ammo_smg', 'ammo_rifle', 'ammo_shotgun', 'ammo_sniper'];

const G = {
  revolver: { dmg: 40, fire: 700, spread: 0.02, pellets: 1, speed: 560, life: 1200, mag: 6, ammo: 'ammo_pistol', reload: 1800 },
  pistol2: { dmg: 24, fire: 260, spread: 0.035, pellets: 1, speed: 540, life: 1100, mag: 15, ammo: 'ammo_pistol', reload: 1200 },
  smg: { dmg: 12, fire: 90, spread: 0.12, pellets: 1, speed: 540, life: 1000, mag: 30, ammo: 'ammo_smg', reload: 1700 },
  shotgun: { dmg: 11, fire: 900, spread: 0.28, pellets: 6, speed: 480, life: 600, mag: 6, ammo: 'ammo_shotgun', reload: 2400 },
  rifle: { dmg: 28, fire: 160, spread: 0.05, pellets: 1, speed: 720, life: 1400, mag: 30, ammo: 'ammo_rifle', reload: 2000 },
  sniper: { dmg: 90, fire: 1400, spread: 0.005, pellets: 1, speed: 1000, life: 1800, mag: 5, ammo: 'ammo_sniper', reload: 2600, range: 780, fov: (55 * Math.PI) / 180 },
} satisfies Record<string, Gun>;

// Itemele cunoscute. Orice alt item din baza de date e recunoscut dupa nume/tip de `registerDefs` (vezi mai jos).
export const CATALOG: Record<string, Spec> = {
  revolver: { w: 2, h: 1, slot: 'weapon', gun: G.revolver },
  smg: { w: 3, h: 2, slot: 'weapon', gun: G.smg },
  shotgun: { w: 4, h: 2, slot: 'weapon', gun: G.shotgun },
  rifle: { w: 5, h: 2, slot: 'weapon', gun: G.rifle },
  sniper: { w: 6, h: 2, slot: 'weapon', gun: G.sniper },
  helmet_light: { w: 2, h: 2, slot: 'head', red: 0.1 },
  helmet_heavy: { w: 2, h: 2, slot: 'head', red: 0.2 },
  vest_light: { w: 2, h: 3, slot: 'body', red: 0.2 },
  vest_heavy: { w: 3, h: 3, slot: 'body', red: 0.4 },
  bandage: { w: 1, h: 1, heal: { hp: 20, ms: 1500 } },
  medkit: { w: 2, h: 1, heal: { hp: 50, ms: 3000 } },
  stim: { w: 1, h: 2, heal: { hp: 70, ms: 1200 } },
  key_warehouse: { w: 1, h: 1, door: 'Depozit' },
  keycard_bank: { w: 2, h: 1, door: 'Banca' },
  key_house: { w: 1, h: 1, door: 'Casa' },
  backpack_small: { w: 2, h: 2, slot: 'back', pack: { w: 7, h: 5 } },
  backpack_medium: { w: 3, h: 3, slot: 'back', pack: { w: 8, h: 7 } },
  backpack_large: { w: 3, h: 4, slot: 'back', pack: { w: 10, h: 8 } },
  backpack_military: { w: 4, h: 4, slot: 'back', pack: { w: 12, h: 9 } },
};

// Rucsacuri necunoscute din baza de date: dimensiunea dupa raritate
const PACKS: Record<string, [number, number, { w: number; h: number }]> = {
  common: [2, 2, { w: 7, h: 5 }], uncommon: [2, 2, { w: 7, h: 5 }], rare: [3, 3, { w: 8, h: 7 }],
  epic: [3, 4, { w: 10, h: 8 }], legendary: [4, 4, { w: 12, h: 9 }],
};

const RED: Record<string, number> = { common: 0.1, uncommon: 0.2, rare: 0.3, epic: 0.4, legendary: 0.5 };
const HEAL: Record<string, [number, number]> = { common: [20, 1500], uncommon: [35, 2000], rare: [50, 3000], epic: [70, 2500], legendary: [100, 2000] };

// Ghiceste ce poate face un item din baza de date dupa nume / tip / raritate
function infer(d: Def): Spec | undefined {
  const s = `${d.item_type} ${d.name}`.toLowerCase();
  const w = Math.ceil(Math.sqrt(d.slots || 1)), h = Math.ceil((d.slots || 1) / w);
  if (/ammo|gloant|munit|cartus/.test(s)) return undefined;

  if (/rucsac|backpack|ghiozdan|rucksack/.test(s)) {
    const [pw, ph, pack] = PACKS[d.rarity] ?? PACKS.common;
    return { w: pw, h: ph, slot: 'back', pack };
  }

  if (/key|cheie|keycard/.test(s)) {
    const n = /bank|banca/.test(s) ? 'Banca' : /depozit|warehouse|storage/.test(s) ? 'Depozit' : /casa|house|home|apart/.test(s) ? 'Casa' : /magazin|shop|store/.test(s) ? 'Magazin' : undefined;
    return n ? { w, h, door: n } : undefined;
  }

  const red = RED[d.rarity] ?? 0.2;
  if (/exo/.test(s)) return { w, h, slot: 'body', red: 0.6 };
  if (/helm|casc|casq/.test(s)) return { w, h, slot: 'head', red: Math.min(0.3, red * 0.6) };
  if (/vest|vesta|antiglont|bulletproof|kevlar|armor|armur|plate|jacket|jachet/.test(s)) return { w, h, slot: 'body', red: Math.min(0.55, red + 0.1) };

  const gun = (k: keyof typeof G, gw: number, gh: number): Spec => ({ w: gw, h: gh, slot: 'weapon', gun: G[k] });
  if (/sniper|dragunov|awp|lunet/.test(s)) return gun('sniper', 6, 2);
  if (/shotgun|pompa|sacal|spas|remington/.test(s)) return gun('shotgun', 4, 2);
  if (/smg|uzi|mp5|mp7|vector|mitralier|thompson|kriss/.test(s)) return gun('smg', 3, 2);
  if (/rifle|\bak|\bm4|ar-?15|carabin|pusca|scar|famas|g36|galil/.test(s)) return gun('rifle', 5, 2);
  if (/revolver|magnum/.test(s)) return gun('revolver', 2, 1);
  if (/pistol|glock|handgun|beretta|colt|deagle|desert/.test(s)) return gun('pistol2', 2, 1);

  if (/bandaj|bandage|medkit|trusa|first.?aid|stim|pastil|painkill|analgez|morfin|morphine|seringa|syringe|adrenal|antibiot|medic/.test(s)) {
    const [hp, ms] = HEAL[d.rarity] ?? [30, 2000];
    return { w, h, heal: { hp, ms } };
  }
  return undefined;
}

// Apeleaza o data dupa ce ai incarcat item_defs (hub si raid): itemele necunoscute devin utilizabile
export function registerDefs(defs: Iterable<Def>) {
  for (const d of defs) {
    let sp = CATALOG[d.item_type] ?? infer(d);
    if (!sp) continue;
    // vesta legendara = 4x4, ca rucsacul legendar
    if (sp.slot === 'body' && d.rarity === 'legendary') sp = { ...sp, w: 4, h: 4 };
    CATALOG[d.item_type] = sp;
  }
}

export const spec = (type: string): Spec | undefined => CATALOG[type];

export function dims(d: Def, r = false): [number, number] {
  const s = CATALOG[d.item_type];
  const w = s ? s.w : Math.ceil(Math.sqrt(d.slots || 1));
  const h = s ? s.h : Math.ceil((d.slots || 1) / w);
  return r ? [h, w] : [w, h];
}

export function tip(d: Def, qty: number): string {
  const s = CATALOG[d.item_type];
  const [w, h] = dims(d);
  const l = [`${d.name}${qty > 1 ? ` x${qty}` : ''}`, `${d.rarity}, ${w}x${h}${d.base_value ? `, $${d.base_value}` : ''}`];
  if (s?.gun) {
    l.push(`Damage ${s.gun.dmg}${s.gun.pellets > 1 ? `x${s.gun.pellets}` : ''}, ${(1000 / s.gun.fire).toFixed(1)} focuri/s`);
    l.push(`Incarcator ${s.gun.mag}, gloante: ${s.gun.ammo ?? 'infinite'} (R = reincarca)`);
    if (s.gun.range) l.push('Viziune extinsa (luneta)');
  }
  if (s?.red) l.push(`Reduce damage-ul cu ${Math.round(s.red * 100)}%`);
  if (s?.heal) l.push(`+${s.heal.hp} HP in ${s.heal.ms / 1000}s (clic dreapta sau H)`);
  if (s?.pack) l.push(`Rucsac: ${s.pack.w}x${s.pack.h} celule de inventar (${s.pack.w * s.pack.h})`);
  if (s?.door) l.push(`Deschide: ${s.door} (apasa E langa usa)`);
  if (s?.slot) l.push('Clic dreapta: echipeaza');
  return l.join('\n');
}