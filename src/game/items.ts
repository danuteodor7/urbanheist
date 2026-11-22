import type { ItemDef } from './map';

// Prices: you sell la SELL_PCT% din base_value, cumperi (magazinul din raid) la BUY_MULT x base_value.
// SELL_PCT trebuie sa fie identic cu cel din SQL (sell_item, vezi supabase/changes.sql)
export const SELL_PCT = 40;
export const BUY_MULT = 2;
export const sellPrice = (d: { base_value?: number }, qty: number) => Math.floor(((d.base_value ?? 0) * qty * SELL_PCT) / 100);

export type Slot = 'head' | 'body' | 'weapon' | 'back';
// Inventarul de baza (fara rucsac echipat): buzunare
export const BASE_BAG = { w: 6, h: 4 };
export type Def = ItemDef & { base_value?: number };
// x,y = top-left cell in the grid; found = looted in raid (not brought from the stash). Items never rotate.
export type Item = { id: string; type: string; qty: number; x: number; y: number; found?: boolean };

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
  m4: { dmg: 30, fire: 130, spread: 0.045, pellets: 1, speed: 740, life: 1400, mag: 30, ammo: 'ammo_rifle', reload: 1800 },
  sniper: { dmg: 90, fire: 1400, spread: 0.005, pellets: 1, speed: 1000, life: 1800, mag: 5, ammo: 'ammo_sniper', reload: 2600, range: 780, fov: (55 * Math.PI) / 180 },
} satisfies Record<string, Gun>;

// Itemele cunoscute. Orice alt item din baza de date e recunoscut dupa nume/tip de `registerDefs` (vezi mai jos).
export const CATALOG: Record<string, Spec> = {
  revolver: { w: 2, h: 1, slot: 'weapon', gun: G.revolver },
  makarov: { w: 2, h: 1, slot: 'weapon', gun: G.pistol2 },
  smg: { w: 3, h: 2, slot: 'weapon', gun: G.smg },
  assault_rifle: { w: 5, h: 2, slot: 'weapon', gun: G.m4 },
  body_armor: { w: 2, h: 3, slot: 'body', red: 0.25 },
  exo_armor: { w: 4, h: 4, slot: 'body', red: 0.6 },
  fuel_can: { w: 1, h: 2 },
  laptop: { w: 2, h: 1 },
  prototype_tech: { w: 2, h: 1 },
  encrypted_server: { w: 2, h: 2 },
  shotgun: { w: 4, h: 2, slot: 'weapon', gun: G.shotgun },
  rifle: { w: 5, h: 2, slot: 'weapon', gun: G.rifle },
  sniper: { w: 6, h: 2, slot: 'weapon', gun: G.sniper },
  helmet_common: { w: 2, h: 2, slot: 'head', red: 0.1 },
  helmet_rare: { w: 2, h: 2, slot: 'head', red: 0.2 },
  helmet_epic: { w: 2, h: 2, slot: 'head', red: 0.28 },
  helmet_legendary: { w: 2, h: 2, slot: 'head', red: 0.38 },
  vest_common: { w: 2, h: 3, slot: 'body', red: 0.15 },
  vest_rare: { w: 3, h: 3, slot: 'body', red: 0.28 },
  vest_epic: { w: 3, h: 3, slot: 'body', red: 0.4 },
  vest_legendary: { w: 4, h: 4, slot: 'body', red: 0.55 },
  bandage: { w: 1, h: 1, heal: { hp: 20, ms: 1500 } },
  medkit: { w: 2, h: 1, heal: { hp: 50, ms: 3000 } },
  stim: { w: 1, h: 2, heal: { hp: 70, ms: 1200 } },
  key_warehouse: { w: 1, h: 1, door: 'Warehouse' },
  keycard_bank: { w: 2, h: 1, door: 'Bank' },
  key_house: { w: 1, h: 1, door: 'House' },
  backpack_common: { w: 2, h: 2, slot: 'back', pack: { w: 7, h: 5 } },
  backpack_rare: { w: 3, h: 3, slot: 'back', pack: { w: 8, h: 7 } },
  backpack_epic: { w: 3, h: 4, slot: 'back', pack: { w: 10, h: 8 } },
  backpack_legendary: { w: 4, h: 4, slot: 'back', pack: { w: 12, h: 9 } },
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
    const n = /bank|banca/.test(s) ? 'Bank' : /depozit|warehouse|storage/.test(s) ? 'Warehouse' : /casa|house|home|apart/.test(s) ? 'House' : /magazin|shop|store/.test(s) ? 'Shop' : undefined;
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
// English display names for every known item (the database may still hold old names)
const NAMES: Record<string, string> = {
  revolver: 'Revolver', smg: 'SMG', shotgun: 'Shotgun', rifle: 'Assault Rifle', sniper: 'Sniper Rifle',
  helmet_common: 'Scout Helmet', helmet_rare: 'Combat Helmet', helmet_epic: 'Assault Helmet', helmet_legendary: 'Warlord Helmet',
  vest_common: 'Padded Vest', vest_rare: 'Plate Carrier', vest_epic: 'Heavy Plate Vest', vest_legendary: 'Titan Armor',
  backpack_common: 'Day Pack', backpack_rare: 'Hiking Backpack', backpack_epic: 'Tactical Backpack', backpack_legendary: 'Military Backpack',
  makarov: 'Makarov Pistol', assault_rifle: 'M4A1', body_armor: 'Ballistic Vest', exo_armor: 'Exoskeleton Armor',
  fuel_can: 'Fuel Can', bolts: 'Bolts', canned_food: 'Canned Food', gun_parts: 'Gun Parts',
  cheap_watch: 'Cheap Watch', phone: 'Phone', keycard: 'Access Card', laptop: 'Laptop', gold_bar: 'Gold Bar',
  prototype_tech: 'Prototype Tech', bank_diamond: 'Bank Diamond', encrypted_server: 'Encrypted Server',
  bandage: 'Bandage', medkit: 'Medkit', stim: 'Combat Stim',
  key_warehouse: 'Warehouse Key', keycard_bank: 'Bank Keycard', key_house: 'House Key',
  ammo_pistol: 'Pistol Ammo', ammo_smg: 'SMG Ammo', ammo_rifle: 'Rifle Ammo', ammo_shotgun: 'Shotgun Shells', ammo_sniper: 'Sniper Ammo',
};
const SET_RE = /^(helmet|vest|backpack)_(common|rare|epic|legendary)$/;

export function registerDefs(defs: Iterable<Def>) {
  for (const d of defs) {
    if (NAMES[d.item_type]) d.name = NAMES[d.item_type];
    const set = d.item_type.match(SET_RE);
    if (set) d.rarity = set[2]; // armor sets: the rarity is part of the item type
    let sp = CATALOG[d.item_type] ?? infer(d);
    if (!sp) continue;
    // vesta legendara = 4x4, ca rucsacul legendar
    if (sp.slot === 'body' && d.rarity === 'legendary') sp = { ...sp, w: 4, h: 4 };
    CATALOG[d.item_type] = sp;
  }
}

export const spec = (type: string): Spec | undefined => CATALOG[type];

// Cat se stackuieste un item intr-un singur slot. Armele, armurile, rucsacurile si cheile NU se stackuiesc (1).
// Gloantele: tabelul de mai jos (cele care nu apar au ammoDefault). Alte iteme stackabile: otherDefault.
const STACK_MAX: Record<string, number> = { ammo_pistol: 60, ammo_shotgun: 60, ammo_sniper: 40 };
const AMMO_STACK = 360, OTHER_STACK = 10;
export function stackMax(d: Def): number {
  const s = CATALOG[d.item_type];
  if (s?.gun || s?.slot || s?.red || s?.door || /key|cheie/i.test(d.item_type)) return 1;
  if (!d.stackable) return 1;
  if (STACK_MAX[d.item_type]) return STACK_MAX[d.item_type];
  return /^ammo_/.test(d.item_type) ? AMMO_STACK : OTHER_STACK;
}

export function dims(d: Def): [number, number] {
  const s = CATALOG[d.item_type];
  const w = s ? s.w : Math.ceil(Math.sqrt(d.slots || 1));
  const h = s ? s.h : Math.ceil((d.slots || 1) / w);
  return [w, h];
}

export function tip(d: Def, qty: number): string {
  const s = CATALOG[d.item_type];
  const [w, h] = dims(d);
  const l = [`${d.name}${qty > 1 ? ` x${qty}` : ''}`, `${d.rarity}, ${w}x${h}${d.base_value ? `, sells for $${sellPrice(d, 1)}` : ''}`];
  if (s?.gun) {
    l.push(`Damage ${s.gun.dmg}${s.gun.pellets > 1 ? `x${s.gun.pellets}` : ''}, ${(1000 / s.gun.fire).toFixed(1)} shots/s`);
    l.push(`Magazine ${s.gun.mag}, ammo: ${s.gun.ammo ? (NAMES[s.gun.ammo] ?? s.gun.ammo) : 'infinite'} (R = reload)`);
    if (s.gun.range) l.push('Extended vision (scope)');
  }
  if (s?.red) l.push(`Reduces damage by ${Math.round(s.red * 100)}%`);
  if (s?.heal) l.push(`Heals ${s.heal.hp} HP over ${s.heal.ms / 1000}s (right-click or H)`);
  if (s?.pack) l.push(`Backpack: ${s.pack.w}x${s.pack.h} inventory cells (${s.pack.w * s.pack.h})`);
  if (s?.door) l.push(`Opens: ${s.door} (press E next to the door)`);
  if (s?.slot) l.push('Right-click: equip');
  if (stackMax(d) > 1) l.push(`Stacks up to ${stackMax(d)}`);
  return l.join('\n');
}