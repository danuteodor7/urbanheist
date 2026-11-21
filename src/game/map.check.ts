// Rulare: npx tsx src/game/map.check.ts
import { generateMap, rerollLoot, W, H, type ItemDef } from './map';

const ok = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const defs: ItemDef[] = [
  ...RARITIES.flatMap((r) => [0, 1].map((i) => ({ item_type: `${r}${i}`, name: r, rarity: r, slots: 1, stackable: i === 1, search_time_ms: 1000 }))),
  { item_type: 'ammo_smg', name: 'Gloante', rarity: 'common', slots: 1, stackable: true, search_time_ms: 500 },
  { item_type: 'medkit', name: 'Medkit', rarity: 'uncommon', slots: 2, stackable: false, search_time_ms: 800 },
  { item_type: 'backpack_small', name: 'Rucsac mic', rarity: 'uncommon', slots: 4, stackable: false, search_time_ms: 900 },
];

const seeds = ['a', 'b', 'main', 'raid-123', '49132efb-bf55-4b96-ba53-fbb5f29aa617', ...Array.from({ length: 300 }, (_, i) => `s${i}`)];
for (const seed of seeds) {
  const m = generateMap(seed, defs);
  ok(JSON.stringify(m) === JSON.stringify(generateMap(seed, defs)), `${seed}: harta trebuie sa fie determinista`);

  const a = generateMap(seed, defs), b = generateMap(seed, defs);
  rerollLoot(a, 7, defs); rerollLoot(b, 7, defs);
  ok(JSON.stringify(a) === JSON.stringify(b), `${seed}: reroll trebuie sa fie determinist`);
  ok(a.containers.every((c) => c.items.length >= 1 && c.items.every((i) => !i.item_type.startsWith('legendary') || (c.zone === 'red' || c.vip))),
    `${seed}: reroll a dat loot invalid`);

  const wall = new Set(m.walls.map(([x, y]) => `${x},${y}`));
  ok(wall.size === m.walls.length, `${seed}: pereti duplicati`);
  ok(m.containers.every((c) => !wall.has(`${c.x},${c.y}`)), `${seed}: container in perete`);
  ok(m.containers.every((c) => c.items.length >= 1), `${seed}: container gol`);
  ok(m.containers.every((c) => c.items.every((i) => i.item_type.startsWith('legendary') ? (c.zone === 'red' || c.vip) : true)),
    `${seed}: legendary in afara zonei rosii`);
  ok(m.extract.every((r) => m.walls.every(([x, y]) => x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h)),
    `${seed}: perete in zona de extractie`);

  // BFS din prima zona de extractie: trebuie sa ajungem la toate zonele, containerele si vehiculele
  const hard = new Set(m.walls.filter(([, , k]) => k !== 'lock').map(([x, y]) => `${x},${y}`));   // usile incuiate se pot deschide
  ok(m.locks.length >= 2 && m.locks.every((l) => wall.has(`${l.x},${l.y}`)), `${seed}: usi incuiate lipsa`);
  const seen = new Set<string>();
  const q: [number, number][] = [[m.extract[0].x, m.extract[0].y]];
  while (q.length) {
    const [x, y] = q.pop()!;
    const k = `${x},${y}`;
    if (seen.has(k) || hard.has(k) || x < 0 || y < 0 || x >= W || y >= H) continue;
    seen.add(k);
    q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  ok(m.extract.every((r) => seen.has(`${r.x},${r.y}`)), `${seed}: zona de extractie inaccesibila`);
  ok(m.containers.every((c) => seen.has(`${c.x},${c.y}`)), `${seed}: container inaccesibil`);

  ok(m.shops.length === 8 && ['arms', 'ammo', 'med', 'gear'].every((k) => m.shops.filter((s) => s.kind === k).length === 2), `${seed}: magazine lipsa`);
  ok(m.shops.every((s) => wall.has(`${s.x},${s.y}`) && wall.has(`${s.x + 1},${s.y}`)), `${seed}: tejghea lipsa`);
  ok(m.shops.every((s) => [[s.x, s.y + 1], [s.x + 1, s.y + 1], [s.x, s.y - 1], [s.x + 1, s.y - 1]].some(([x, y]) => seen.has(`${x},${y}`))), `${seed}: magazin inaccesibil`);

  ok(m.vehicles.length >= 6, `${seed}: prea putine vehicule (${m.vehicles.length})`);
  ok(m.vehicles.every((v) => !wall.has(`${v.x},${v.y}`) && seen.has(`${v.x},${v.y}`)), `${seed}: vehicul in perete / inaccesibil`);
  // fiecare vehicul are loc liber 3x3 in jur (sa poata porni)
  ok(m.vehicles.every((v) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (hard.has(`${v.x + dx},${v.y + dy}`)) return false;
    return true;
  }), `${seed}: vehicul blocat de pereti`);
}
console.log(`map.check OK (${seeds.length} seed-uri)`);