# Urban Heist: Architecture & Handoff

Joc web 2D top-down, extraction shooter (Tarkov / Zero Sievert / GTA 2), multiplayer pentru un grup mic de prieteni (tinta 15, realist 3-5 pe Supabase Free). Stack gratuit: **Vite + TypeScript + Phaser 3** (frontend, hostat pe Netlify) si **Supabase Free** (Auth, Postgres + RLS + RPC, Realtime Broadcast).

> **Pentru un AI care preia proiectul:** citeste "Reguli", "Stare curenta" si "Probleme deschise". `supabase/schema.sql` + `supabase/shop.sql` sunt sursa de adevar pentru DB (schema.sql nu e in acest document: cere-l utilizatorului daca ai nevoie de el). Textele din UI si comentariile sunt in romana; raspunde utilizatorului in romana.

## Reguli fundamentale
1. Lucram **pas cu pas**; utilizatorul testeaza fiecare schimbare.
2. **Pozitii, rotatii, gloante, masini = doar Realtime Broadcast**, niciodata in Postgres.
3. Postgres/RPC se scrie doar la evenimente majore: auth/profil, stash/upgrade, vanzare, cumparare in raid, extractie, moarte.
4. Actiunile cu bani/iteme persistente trec prin RPC `security definer`; clientul nu isi modifica singur banii.
5. Free plan: 500 MB DB, Realtime **100 mesaje/s pe proiect** (numarate si la livrare, deci creste cu N^2).
6. Orice schimbare in `map.ts` trebuie sa treaca `npx tsx src/game/map.check.ts` (305 seed-uri).
7. Verificare tipuri: `npx tsc --noEmit` (tsconfig cu `noUnusedLocals`: importurile/metodele nefolosite dau eroare).

## Rulare si deploy
```
npm install
npm run dev          # http://localhost:5173
npm run build        # genereaza dist/, se urca pe Netlify (drag & drop sau CLI)
```
`.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (cheie publishable, ok in client). Vite le copiaza in build la `npm run build`; daca Netlify face build din repo, le pune ca Environment variables. Daca se foloseste confirmare email, adresa Netlify trebuie in Supabase > Authentication > URL Configuration.

## Structura proiectului
```
index.html, package.json, vite.config.ts, tsconfig.json, .env.local
supabase/schema.sql      tabele, RLS, RPC (baza)
supabase/shop.sql        spend_money + rucsacurile in item_defs (de rulat o data)
src/
  main.ts                auth, Hub (stash + loadout), pornire raid
  style.css              tema + overlay inventar + overlay magazin
  lib/supabase.ts        client supabase-js
  net/realtime.ts        clasa Net (canal Broadcast), peekCount, tipurile mesajelor, constante de buget
  ui/inventory.ts        grile drag&drop (stash, inventar, container, sloturi), rucsac, quickEquip, layout in localStorage
  game/map.ts            generator determinist de harta + loot + magazine (seed = codul sesiunii)
  game/map.check.ts      test pe 305 seed-uri (BFS accesibilitate, magazine, vehicule, loot)
  game/items.ts          catalog arme/armuri/heal/chei/rucsacuri, infer() pentru itemele necunoscute, tip()
  game/art.ts            toate texturile desenate din cod (zero asset-uri)
  game/RaidScene.ts      scena Phaser: tot jocul din raid
```

## Baza de date (rezumat; verifica schema.sql)
Tabele folosite de client: `profiles(id, username, money, xp, level, stash_slots)`, `raid_players(raid_id, user_id)`, `stash_items(id, user_id, item_type, quantity, raid_id)`, `item_defs(item_type, name, category, rarity, slots, stackable, search_time_ms, base_value)`.
Atentie la `item_defs`: `rarity` este enum `item_rarity` (cast `::item_rarity` la insert) si `category` este NOT NULL (valorile permise nu sunt cunoscute; copiaza de la un item existent).

| RPC | Argumente | Rol |
|---|---|---|
| `create_raid` | - | creeaza raid, returneaza id |
| `join_raid` | `p_raid_id, p_item_ids[]` | marcheaza itemele luate la risc (`stash_items.raid_id`) |
| `start_raid` | `p_raid_id` | porneste raidul; extractia permisa dupa 60s |
| `extract_player` | `p_raid_id, p_loot[], p_xp` | salveaza loot gasit + xp; returneaza `skipped_stash_full`; erori: `not in raid`, `not extractable` |
| `die_in_raid` | `p_raid_id` | sterge itemele aduse, returneaza numarul pierdut |
| `consume_raid_item` | `p_item_id, p_qty` | scade un item adus din stash (gloante, heal, chei) |
| `sell_item` | `p_item_id, p_qty` | vinde din stash |
| `upgrade_stash` | - | +10 sloturi |
| `spend_money` | `p_amount bigint` | (shop.sql) scade banii cat timp esti in raid; returneaza soldul nou; `not enough money` |

Starea SQL aplicata de utilizator: `spend_money` si cele 4 rucsacuri (`backpack_small/medium/large/military`) in `item_defs` (cu `category` copiat de la alt item) trebuie sa fie rulate. Daca magazinul zice "nu e activ", lipseste `spend_money`.

## Fluxul jocului
1. **Auth** (`showAuth`): email + parola, username la Register.
2. **Hub** (`showHub`): stash (grila 10x8 cu `grow`) + loadout (Inventar + sloturi Casca/Vesta/Arma/Rucsac). Pozitiile itemelor se tin in localStorage (`uh:layout:<uid>`), DB nu stie de grid. V peste item din stash = vinde. Buton "INTRA PE SERVER": `peekCount` (refuza la >= 15), `create_raid` > `join_raid` (itemele din loadout) > `start_raid`.
3. **Raid** (`runRaid` > `RaidScene`): un singur server comun, canal `raid:main`, aceeasi harta (`generateMap('main')`). Fiecare jucator are propriul raid pe server (validare extractie/moarte).
4. **Final:** extractie (5 s in zona verde, dupa 60 s de la intrare) trimite loot-ul *gasit* (`found: true`) + xp; moarte/abandon (Q) lasa un drop cu tot ce ai asupra ta; `die_in_raid` sterge itemele aduse. La final se revine in hub cu un mesaj (`note`).
5. Daca iesirea esueaza din retea: ecran de recuperare (reintra / abandoneaza), `raidBad`.

**Controale:** WASD miscare, mouse tinta + click foc, R reload, E interactiune (container / usa / magazin / masina), Tab sau I inventar, H heal rapid, Q abandon, Esc inchide overlay. Clic dreapta in inventar: echipeaza / ia / foloseste. R in timpul drag: roteste itemul.

## Harta (`map.ts`)
- **64 -> 104x72 tiles** (`W=104, H=72, NX=12, NY=8`), tile 32 px. Grila 12x8 de celule 8x8 (continut 6x6, strazi de 2 tiles la x/y = 11+8k si 12+8k, cu linie intrerupta ca decor).
- **Zone de risc** = inele dupa distanta fata de centru (`zoneAt`): green (<65%... exterior), yellow, red (centru). Loot-ul depinde de zona (`WEIGHTS`), tipul de celula tot (`CELLS`).
- **Tipuri de celule:** house (45% incuiate, loot mai bun), ruins (pereti spartati), warehouse (2 usi incuiate, lazi, loot vip), shop/clinic (loot tematic ammo/med/pack), gas (pompe + masina), park, parking, plaza, yard (gard + casa), **lake** (apa, bloceaza miscarea nu gloantele), **camp** (gard cu 4 porti, loot ammo), **market** (tarabe), **trader** (vezi Magazine).
- **Banca** in centru (celulele cx 5-6, cy 3-4): 13x14, 3 camere cu treceri decalate, 2 usi incuiate (cheie `Banca`), 10 containere vip.
- **8 zone de extractie:** mijlocul fiecarei laturi + 4 colturi. Spawn aleator in una dintre ele.
- **Perete** (`WallKind`): wall, tree, crate, fence, car, lock, shelf, pump, counter, water. Blocheaza vederea doar wall/tree/crate/lock (`blocksView`).
- **Garantie de accesibilitate:** obstacolele libere se pun doar pe tile-uri fara vecini solizi (`isolated`). `map.check.ts` verifica BFS: extractii, containere, magazine, vehicule, 3x3 liber la vehicule, determinism, legendary doar in zona rosie/vip.
- **Loot:** seed-ul hartii e fix; loot-ul se reroleaza la fiecare `RESET_MS` (60 s) cu `epoch = floor(Date.now()/RESET_MS)` si `rerollLoot` determinist, deci toti clientii au acelasi loot fara mesaje. Starea containerelor primita din alt epoch e ignorata.
- **Vehicule:** 28, pe strazi si la benzinarii (lipsesc din banca si din zonele de extractie).

## Magazine (in raid)
- 8 comercianti, cate 2 din fiecare tip, in celule fixe din zona verde (`TRADERS` in map.ts): **arms** (arme), **ammo** (gloante), **med** (heal), **gear** (casti, veste, rucsacuri). Cladire 6x6, tejghea de 2 tiles (`counter`, colorata dupa tip), vanzator decorativ, firma vizibila dupa ce o vezi, marcaj mereu vizibil pe minimap. `GameMap.shops = {x,y,kind}` (x = tile-ul stang al tejghelei).
- `E` langa tejghea deschide overlay-ul (`openShop/renderShop`). Stocul vine din `item_defs` filtrat dupa `spec()` (gun / ammo_ / heal / pack|red); legendarele nu se vand.
- **Pret** = `base_value * BUY_MULT (3)`, fallback pe raritate (`FALLBACK_PRICE`); gloantele se vand in pachete de 20.
- **Cumparare** (`buy`): itemul se pune intai in inventar (nu incape => nu se plateste), apoi RPC `spend_money`; la eroare se anuleaza. Itemul are `found: true` (se salveaza la extractie). Arma/casca/vesta/rucsacul se echipeaza singure daca slotul e liber. Banii vin din `profiles.money` citit la intrarea in raid (`Init.money`).

## Inventar si rucsacuri (`ui/inventory.ts`, `items.ts`)
- `Box` = grila (stash, inventar, container) sau slot (un item, `slot` = ce accepta). `mkBoxes()` da: `bag` (Inventar), `head`, `body`, `weapon`, `back` (Rucsac).
- **Rucsac:** slot `back`; inventarul de baza (`BASE_BAG`) e **6x4**, cu rucsac devine: small 7x5, medium 8x7, large 10x8, military 12x9 (`Spec.pack`). Rucsacurile necunoscute din DB se deduc dupa raritate (`PACKS` in items.ts). Se gasesc in loot dupa raritate (uncommon..legendary) si se cumpara (nu cel militar).
- `refit(defs, bag, back)` redimensioneaza gridul; daca itemele nu mai incap (nici reasezate automat), mutarea/echiparea se **anuleaza** (snapshot/restore, `Hooks.refit/onDeny`). `distribute()` pune rucsacurile primele, ca restul itemelor sa incapa.
- Itemele aduse din stash sunt `found` nedefinit (raman la risc, scazute prin `consume_raid_item`); cele luate din raid au `found: true` si se salveaza la extractie. Stack max `MAX_STACK = 50`.
- Container deschis: itemele se identifica pe rand (`search_time_ms`), clic dreapta / drag le ia (`commitTake`, `looted` broadcast). Cadavrele/drop-urile sunt instant revelate.

## Itemi, arme, combat (`items.ts`, `RaidScene.ts`)
- `CATALOG` cunoaste: revolver, smg, shotgun, rifle, sniper, casti/veste, bandage/medkit/stim, chei (`Depozit`, `Banca`, `Casa`), 4 rucsacuri. `registerDefs()` deduce restul din nume/raritate (`infer`). Pistolul implicit nu e in DB (gloante infinite). Arma are `mag`, `reload`, `ammo` (tip item gloante), sniper are `range/fov` (camera se muta spre mouse).
- Combat **victim-authoritative**: fiecare client simuleaza gloantele, doar victima isi aplica damage-ul (armura reduce), apoi `pos` cu HP nou; HP 0 => `dead`. Hostul aplica damage pe boti. Spawn protection 3 s. Shotgun = un mesaj, alicele din seed.
- **Heal:** clic dreapta / H, intrerupt la lovitura. **Masini:** `E` (hotwire 1.5 s), W/S gaz-frana, A/D directie, lovesc jucatorii (victim-authoritative). **Usi incuiate:** necesita cheia potrivita in inventar (consumata).

## Multiplayer (`net/realtime.ts`)
Mesaje Broadcast: `pos` (dead reckoning: doar la schimbare de viteza + corectie rara, heartbeat 4 s, stale 12 s), `shot`, `dead` (drop cu `did` unic), `looted` (comutativ), `gone`, `alarm`, `door`, `car`, `hello`/`state` (jucator care intra tarziu primeste containerele modificate, drop-urile, usile, masinile), `probe`/`alive` (capacitate). Fara Presence.
- **Boti:** simulati doar de host = cel mai mic id (`electHost`, la 1 s), `BOT_COUNT = 8`, patrulare/urmarire/foc cu acelasi raycast de vedere, respawn 30 s, drop la moarte, id `bot:<host>:<n>`, trimisi ca `pos`. Fara pathfinding (se pot bloca). **Alarma:** cine ia un item `legendary` trimite `alarm`, botii din 800 px vin 20 s.
- **Buget:** `MSG_BUDGET = 70`; rata corectiilor `pos` scade cu n^2. Optiuni daca trebuie 15 jucatori: Supabase Pro, server WebSocket separat doar pentru pozitii, interest management pe zone.

## Randare, vizibilitate, UI (`RaidScene.ts`)
- **Ecran complet:** containerul `#game` e `position: fixed; inset: 0`; Phaser `Scale.RESIZE` (fara bare negre). Elementele fixe pe ecran se repozitioneaza in `layout()` (apelat la `scale 'resize'`): vigneta, bara de viata, textul arma/gloante/bani, mesajele, minimap.
- **UI:** doar bara de viata + o linie "arma mag/rezerva + $bani" jos stanga, mesaje jos centru, minimap dreapta sus (2 px/tile). HUD-ul text din stanga sus (hp, zona, jucatori, controale) a fost scos intentionat.
- **Vizibilitate:** `vision()` = 180 de raze, con 110 grade spre mouse (raza 420) + cerc 90 px; intunericul se deseneaza ca triunghiuri (FOG_R 1800), fara masti. `see(x,y)` ascunde jucatori/gloante/containere/masini din afara conului. Containerele si magazinele vazute o data raman afisate.
- Texturi 100% din cod (`art.ts`); ~7.5k tile-uri imagine pe harta (daca scade FPS: pre-randare in RenderTexture).

## Limitari cunoscute / securitate
- Clientul e de incredere pentru loot gasit, xp si damage (potrivit pentru prieteni, nu pentru public). Vizibilitatea e doar pe client.
- Doi jucatori pot lua simultan acelasi item (duplicare rara).
- Abandonul lasa un drop cu tot rucsacul (poate fi folosit ca transfer de iteme intre prieteni).
- Loot-ul gasit exista doar in memoria clientului; refresh in raid il pierde. Tab inchis fara extractie = ramai in `raid_players`, reintri in raid.
- `spend_money` valideaza doar suma si faptul ca esti in raid (itemul cumparat nu e verificat server-side).
- Gloantele trec peste apa, dar sunt oprite de gard/masini/rafturi/pompe (`isShot` vs `isWall`).

## Probleme deschise
1. **"loot exceeds limit" la extractie:** verificarea sta in functia SQL `extract_player` (cod necunoscut documentului). Utilizatorul vrea s-o scoata. Pas: ruleaza `select pg_get_functiondef('public.extract_player'::regproc);`, scoate blocul `raise exception ... exceeds/limit` (si limitele pe raritate / xp / stack) si re-creeaza functia. Pana atunci clientul trimite stack-urile in bucati de max 50 si, daca serverul refuza, ofera iesire doar cu itemele aduse. Constantele `MAX_XP`, `MAX_STACK` din RaidScene oglindesc SQL: schimba-le impreuna.
2. Magazinele depind de `item_defs`: daca lipsesc arme/gloante (`ammo_*`)/heal/armuri in DB, magazinul respectiv apare gol.
3. Neverificat in browser de AI-ul care a scris ultima versiune: ecranul complet, overlay-ul de magazin, rucsacurile in raid cu 2+ jucatori.

## Idei urmatoare (Pasul 6)
Economie extinsa (magazin si in hub), crafting / upgrade Hideout, skill tree, A* pentru boti, zgomot de masini care atrage boti, optimizari de trafic, mutarea starii efemere critice pe server daca jocul devine public.

## Conventii de cod
TypeScript strict; comentarii si UI in romana; fara framework UI (HTML prin template strings, `esc()` pe orice text extern); `showHub()` re-randeaza tot (mesaje prin `note`); orice schimbare de schema se scrie in `supabase/*.sql` si se ruleaza manual in SQL Editor; harta si loot trebuie sa ramana deterministe (acelasi seed => aceeasi harta la toti jucatorii).
