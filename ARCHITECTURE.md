# Urban Heist: Architecture & Handoff

Joc web 2D top-down, extraction shooter (Tarkov / Zero Sievert / GTA 2), multiplayer pentru un grup mic de prieteni (tinta 15, realist 3-5 pe Supabase Free). Stack gratuit: **Vite + TypeScript + Phaser 3** (frontend, hostat pe Netlify) si **Supabase Free** (Auth, Postgres + RLS + RPC, Realtime Broadcast).

> **Pentru un AI care preia proiectul:** citeste "Reguli", "Stare curenta" si "Probleme deschise". `supabase/schema.sql` + `supabase/shop.sql` sunt sursa de adevar pentru DB (schema.sql nu e in acest document: cere-l utilizatorului daca ai nevoie de el). Textele din UI sunt acum in **engleza**; comentariile din cod sunt in mare parte in romana. Utilizatorul scrie in engleza: raspunde-i in engleza. Fisierele din `src/` se dau mereu **complete** (nu fragmente), pentru ca utilizatorul le inlocuieste direct.

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
index.html (link catre fonturile Barlow + Barlow Condensed), package.json, vite.config.ts, tsconfig.json, .env.local
supabase/schema.sql      tabele, RLS, RPC (baza)
supabase/shop.sql        spend_money + rucsacurile in item_defs (de rulat o data)
supabase/changes.sql     stash 100/+50/max 750 cu pret, casti epic/legendary, raritatea cheilor (de rulat o data; upgrade_stash de aici inlocuieste varianta din schema.sql)
src/
  main.ts                auth, Hub (stash + loadout), pornire raid
  style.css              toata tema (tokeni, butoane, hub, inventar, tooltip, magazin, pop-up, HUD din raid)
  lib/supabase.ts        client supabase-js
  net/realtime.ts        clasa Net (canal Broadcast), peekCount, tipurile mesajelor, constante de buget
  ui/inventory.ts        grile drag&drop (stash, inventar, container, sloturi), aruncare pe jos, sprite SVG (iconSvg), tooltip, rucsac, quickEquip, layout in localStorage + persistenta loadout dupa raid (saveRaidLayout / savePending / applyPending)
  ui/modal.ts            pop-up-uri in joc: confirmBox / infoBox (nu se mai foloseste NICIODATA window.confirm / alert / prompt)
  game/map.ts            generator determinist de harta + loot + magazine (seed = codul sesiunii)
  game/map.check.ts      test pe 305 seed-uri (BFS accesibilitate, magazine, vehicule, loot)
  game/items.ts          catalog arme/armuri/heal/chei/rucsacuri, infer() pentru itemele necunoscute, tip()
  game/art.ts            toate texturile desenate din cod (zero asset-uri)
  game/itemart.ts        ilustratia SVG a fiecarui item, desenata din cod (folosita doar prin `iconSvg` din inventory.ts)
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
| `extract_player` | `p_raid_id, p_loot[], p_xp` | itemele aduse revin in stash **ca aceleasi randuri** (fara unire); loot-ul gasit se adauga la UN SINGUR rand stackabil sau intr-un rand nou; returneaza `skipped_stash_full`; erori: `not in raid`, `raid not extractable yet`, `invalid xp`, `unknown item`, `invalid quantity` |
| `die_in_raid` | `p_raid_id` | sterge itemele aduse, returneaza numarul pierdut |
| `consume_raid_item` | `p_item_id, p_qty` | scade un item adus din stash (gloante, heal, chei). **Sterge randul cand se consuma tot** (quantity 0 incalca `stash_items_quantity_check`); altfel scade cantitatea. Vezi "Fixuri SQL" |
| `sell_item` | `p_item_id, p_qty` | vinde din stash la 40% din `base_value` (`SELL_PCT` in items.ts = acelasi 40 din SQL, supabase/changes.sql); returneaza suma castigata |
| `upgrade_stash` | - | +50 sloturi (max 750), costa `1000 * (stash_slots - 50) / 50` ($1.000 la primul upgrade, apoi +$1.000 la fiecare); erori: `not enough money`, `stash at maximum`; returneaza noul `stash_slots` |
| `spend_money` | `p_amount bigint` | (shop.sql) scade banii cat timp esti in raid; returneaza soldul nou; `not enough money` |

Starea SQL aplicata de utilizator: `spend_money` si cele 4 rucsacuri (`backpack_small/medium/large/military`) in `item_defs` (cu `category` copiat de la alt item) trebuie sa fie rulate. Daca magazinul zice "nu e activ", lipseste `spend_money`.

## Fluxul jocului
1. **Auth** (`showAuth`): email + parola, username la Register.
2. **Hub** (`showHub`): stash + loadout (Inventar + sloturi Casca/Vesta/Arma/Rucsac). **Stash-ul are dimensiune fixa:** 10 coloane x `ceil(slots / 10)` randuri, unde `slots = min(STASH_MAX, max(STASH_START, stash_slots))` (constantele `STASH_START=100`, `STASH_STEP=50`, `STASH_MAX=750` si `upgradeCost()` sunt in `main.ts` si trebuie sa fie identice cu SQL-ul `upgrade_stash`). Start = 10x10, fiecare upgrade = +5 randuri, maxim 75 de randuri (se deruleaza in `.sc`). Butonul "Upgrade stash" arata pretul si se dezactiveaza fara bani sau la maxim. Nu are `grow`, deci nu mai creste cand pui un item pe ultimul rand. **Stash-ul nu creste niciodata** (`Box.cap` = randurile folosibile; `fits` / `autoPlace` il respecta, deci nu poti pune un item pe jumatate peste ultimul rand). Itemele care nu mai incap (loot nou cand grila e plina) raman vizibile sub grila (`placeOverflow` in inventory.ts) pana le muti in inventar / echipament sau le vinzi; in randurile de sub `cap` nu se poate pune nimic nou, iar la urmatorul `showHub` incearca din nou sa le puna in grila. Pozitiile itemelor se tin in localStorage (`uh:layout:<uid>`), DB nu stie de grid. V peste item din stash = vinde. Buton "INTRA PE SERVER": `peekCount` (refuza la >= 15), `create_raid` > `join_raid` (itemele din loadout) > `start_raid`.
   - **Dupa raid** (extractie / moarte / abandon): inventarul si echipamentul NU se muta in stash, raman cum erau la finalul raidului. La extractie `RaidScene.extract` salveaza pozitiile itemelor aduse (`saveRaidLayout`, cheia `uh:layout:<uid>`, dupa id-ul randului din DB) si pozitiile loot-ului gasit dupa tip (`savePending`, cheia `uh:pending:<uid>`). In hub, `applyPending` potriveste randurile noi din DB (id-uri noi) cu pozitiile salvate si le trimite lui `distribute(..., prefer)`: loot-ul revine in acelasi slot / grid unde il purtai si ajunge in stash doar daca nu mai incape (ex. bucati de 50). Itemele pierdute la moarte dispar din DB. Doar la abandon de pe ecranul de recuperare se apeleaza `clearLoadout` (sterge si `uh:pending`).
   - **Layout hub:** `.hub` are `max-width: 1560px` ca Stash + Echipament + Inventar (pana la 12x9 cu rucsacul militar) sa incapa pe un singur rand; pe ecrane mai inguste panourile trec pe randul urmator (`flex-wrap`).
3. **Raid** (`runRaid` > `RaidScene`): un singur server comun, canal `raid:main`, aceeasi harta (`generateMap('main')`). Fiecare jucator are propriul raid pe server (validare extractie/moarte).
4. **Final:** extractia (5 s in zona verde, dupa 60 s de la intrare) trimite loot-ul *gasit* (`found: true`) + xp; moarte/abandon (Q) lasa un drop cu tot ce ai asupra ta; `die_in_raid` sterge itemele aduse. La final se revine in hub cu un mesaj (`note`).
5. Daca iesirea esueaza din retea: ecran de recuperare (reintra / abandoneaza), `raidBad`.

**Controale:** WASD miscare, mouse tinta + click foc, R reload, E interactiune (container / usa / magazin / masina), Tab sau I inventar, H heal rapid, Q abandon, Esc inchide overlay. Clic dreapta in inventar: echipeaza / ia / foloseste. Itemele nu se rotesc. **Drag intre inventar si container (in ambele sensuri)** muta itemul; **drag in afara oricarui panou** il arunca pe jos.

## Harta (`map.ts`)
- **120 x 80 tiles** (`W=120, H=80`), tile 32 px. Reteaua de strazi e generata de `layoutAxis` (pe fiecare axa): blocuri de 10..17 tiles separate de strazi de 2 tiles (1-2 artere late de 4 tiles), un bloc rezervat bancii (mereu in treimea din mijloc). Fiecare bloc are trotuar pe margine, iar interiorul e impartit de `subdivide` in 1-4 loturi separate de alei de 1 tile. Marcaje: linie intrerupta pe mijlocul strazilor, zebre la intersectii.
- **Zone de risc** = inele dupa distanta fata de centru (`zoneAt`): green (<65%... exterior), yellow, red (centru). Loot-ul depinde de zona (`WEIGHTS`), tipul de celula tot (`CELLS`).
- **Tipuri de celule:** house (45% incuiate, loot mai bun), ruins (pereti spartati), warehouse (2 usi incuiate, lazi, loot vip), shop/clinic (loot tematic ammo/med/pack), gas (pompe + masina), park, parking, plaza, yard (gard + casa), **lake** (apa, bloceaza miscarea nu gloantele), **camp** (gard cu 4 porti, loot ammo), **market** (tarabe), **trader** (vezi Magazine).
- **Banca**: 13x14 intr-un bloc din treimea din mijloc a hartii (pozitie aleatoare in bloc), 3 camere cu treceri decalate, 2 usi incuiate (cheie `Bank`), 10 containere vip.
- **8 zone de extractie:** mijlocul fiecarei laturi + 4 colturi (3x3 / 3x4 / 4x3 tiles). Spawn aleator in una dintre ele.
- **Perete** (`WallKind`): wall, tree, crate, fence, car, lock, shelf, pump, counter, water. Blocheaza vederea doar wall/tree/crate/lock (`blocksView`).
- **Garantie de accesibilitate:** obstacolele libere se pun doar pe tile-uri fara vecini solizi (`isolated`). `map.check.ts` verifica BFS: extractii, containere, magazine, vehicule, 3x3 liber la vehicule, determinism, legendary doar in zona rosie/vip.
- **Sanse de loot (`WEIGHTS`, `VIP` in map.ts):** verde 82% common / 17% uncommon / 1% rare; galben 40 / 35 / 20 rare / 5 epic; rosu 25 uncommon / 50 rare / 22 epic / 3 legendary; containere VIP 62 rare / 34 epic / 4 legendary. **Cheile** nu mai cad ca iteme normale: `rollItems` le scoate din pool si le da cu sansa proprie per item rulat (`KEY_CHANCE`: casa 1.5%, depozit 0.6%, banca 0.15% si doar in containere VIP). Raritatea cheilor din DB (`changes.sql`): banca legendary, depozit rare, casa uncommon; cheia bancii declanseaza deci alarma ca orice legendar.
- **Loot:** seed-ul hartii e fix; loot-ul se reroleaza la fiecare `RESET_MS` (5 min) cu `epoch = floor(Date.now()/RESET_MS)` si `rerollLoot` determinist, deci toti clientii au acelasi loot fara mesaje. Starea containerelor primita din alt epoch e ignorata.
- **Vehicule:** pana la 34 (`tryV`), pe strazi si la benzinarii; lipsesc din banca si din zonele de extractie.

## Magazine (in raid)
- 8 comercianti, cate 2 din fiecare tip, in loturi din zona verde alese cat mai departe unul de altul (`traderOf` in map.ts; cele doua magazine de acelasi fel sunt si ele departe): **arms** (arme), **ammo** (gloante), **med** (heal), **gear** (casti, veste, rucsacuri). Cladire 6x6, tejghea de 2 tiles (`counter`, colorata dupa tip), vanzator decorativ, firma vizibila dupa ce o vezi, marcaj mereu vizibil pe minimap. `GameMap.shops = {x,y,kind}` (x = tile-ul stang al tejghelei).
- `E` langa tejghea deschide overlay-ul (`openShop/renderShop`). Stocul vine din `item_defs` filtrat dupa `spec()` (gun / ammo_ / heal / pack|red); legendarele nu se vand.
- **Pret** = `base_value * BUY_MULT (2, definit in items.ts, impreuna cu SELL_PCT)`, fallback pe raritate (`FALLBACK_PRICE`); gloantele se vand in pachete de 20.
- **Cumparare** (`buy`): itemul se pune intai in inventar (nu incape => nu se plateste), apoi RPC `spend_money`; la eroare se anuleaza. Itemul are `found: true` (se salveaza la extractie). Arma/casca/vesta/rucsacul se echipeaza singure daca slotul e liber. Banii vin din `profiles.money` citit la intrarea in raid (`Init.money`).

## Inventar si rucsacuri (`ui/inventory.ts`, `items.ts`)
- `Box` = grila (stash, inventar, container) sau slot (un item, `slot` = ce accepta). `mkBoxes()` da: `bag` (Inventar), `head`, `body`, `weapon`, `back` (Rucsac).
- **Panoul Echipament:** fara silueta; sloturile sunt placi metalice (`.box.slot`, colturi galbene, eticheta discreta) asezate cu pozitii in pixeli (`SLOT_POS`, `EQ_W=320`, `EQ_H=332` in inventory.ts) astfel incat sa nu se suprapuna: casca 2x2 sus-stanga, vesta 4x4 sub ea, rucsac 4x4 in dreapta, arma 6x2 jos pe toata latimea (cu 2 px de bordura la fiecare slot). Daca se schimba dimensiunea unui slot in `mkBoxes`, recalculeaza `SLOT_POS`.
- **Randare fara salt de scroll:** `render()` din `mountInventory` inlocuieste tot `innerHTML`; ca pagina sa nu sara sus la fiecare mutare, salveaza `scrollX/Y` si `scrollTop`-ul gridului `.sc`, fixeaza temporar `min-height` pe radacina si le restaureaza dupa. Orice randare noua trebuie sa pastreze aceasta schema.
- **Grile `grow`:** `boxHtml` mareste gridul exact cat cer itemele (fara rand in plus). Folosit de container si, rar, de stash (iteme peste capacitate).
- **Rucsac:** slot `back`; inventarul de baza (`BASE_BAG`) e **6x4**, cu rucsac devine: small 7x5, medium 8x7, large 10x8, military 12x9 (`Spec.pack`). Rucsacurile necunoscute din DB se deduc dupa raritate (`PACKS` in items.ts). Se gasesc in loot dupa raritate (uncommon..legendary) si se cumpara (nu cel militar).
- `refit(defs, bag, back)` redimensioneaza gridul; daca itemele nu mai incap (nici reasezate automat), mutarea/echiparea se **anuleaza** (snapshot/restore, `Hooks.refit/onDeny`). `distribute()` pune rucsacurile primele, ca restul itemelor sa incapa.
- Itemele aduse din stash sunt `found` nedefinit (raman la risc, scazute prin `consume_raid_item`); cele luate din raid au `found: true` si se salveaza la extractie. Stack-uri: `stackMax(def)` din items.ts (gloante pistol / shotgun 60, sniper 40, restul gloantelor 360, alte stackabile 10; arme, armuri, rucsacuri si chei = 1, nu se stackuiesc). Itemele gasite se combina doar cu stack-uri `found` de acelasi tip (`stackFree` / `mergeInto` in RaidScene: umple stack-urile existente, restul merge intr-un slot nou), la clic dreapta, drag din container si cumparare. `MAX_STACK = 50` ramane doar marimea bucatilor trimise la `extract_player` (limita serverului pe rand).
- Container deschis: toate itemele apar gri (`?`, fara clasa de raritate, `.it.hid`) si se deblocheaza pe rand, fiecare in acelasi timp `REVEAL_MS` (1 s, constanta in RaidScene; `search_time_ms` din DB nu se mai foloseste). Itemul in curs de deblocare are bara galbena de progres (`.pg`, variabila CSS `--p`); la final apare tipul lui cu efect `.pop` (`@keyframes unlock`, colorat dupa raritate). Clic dreapta / drag le ia (`commitTake`, `looted` broadcast). Cadavrele/drop-urile sunt instant revelate. Si containerele goale se pot deschide (ca sa lasi iteme in ele).
- **Echipare direct din container:** clic dreapta pe un item cu slot (rucsac, casca, vesta, arma) dintr-un container il echipeaza (`RaidScene.equipFromChest`, cu snapshot/restore). Itemul vechi merge in inventar sau, daca nu incape, in container (`commitPut`); daca noul rucsac ar lasa inventarul fara loc, schimbul se anuleaza cu mesaj. Rezolva cazul "inventar plin + rucsac mai mare gasit".
- **Depunere in container (fix):** gridul containerului nu mai e `readonly`. Drag din inventar in container: `onMove` accepta, iar efectele ruleaza dupa `refit` in `Hooks.afterMove` -> `commitPut` (loot nou in `c.items`, marcat deja identificat, mesaj Broadcast `put`).
- **Aruncare pe jos (fix):** `Hooks.ground = true` (doar in raid; in hub nu) => drag in afara panourilor `.pn` apeleaza `onMove(it, from, null)` si apoi `afterMove(it, from, null)` -> `throwItem`. Daca exista deja un drop la <30 px, itemul se adauga acolo (`put`), altfel se creeaza un drop nou (`drop`, forma `DeadMsg`, fara cadavru). Din container nu se arunca direct (se ia mai intai in inventar).
- **Ordinea efectelor:** `inventory.ts > up()` face intai mutarea + `refit` (cu snapshot/restore); abia dupa ce reuseste se apeleaza `afterMove`. Astfel un refuz de refit nu lasa loot fantoma / mesaje de retea.
- **Itemele aduse din stash** (`found` nedefinit) care ajung in container / pe jos se scad din DB cu `consume_raid_item` (`RaidScene.release`); daca le iei inapoi devin `found: true` si se salveaza la extractie. Fara asta un item aruncat si ridicat de altcineva ar fi existat de doua ori.
- **Iconite:** fiecare item are ilustratia lui in `game/itemart.ts` (SVG din cod). `iconSvg(def)` din inventory.ts (vezi "Performanta hub") defineste fiecare ilustratie o singura data intr-un sprite ascuns si returneaza doar `<svg><use/></svg>`. Numele apare in celula doar daca itemul are cel putin 2 celule. Tooltip-ul e propriu (`showTip` / `tipHtml`), nu atributul `title`.

## Performanta hub (`ui/inventory.ts`, `style.css`)
Cauza laguiului era numarul de iteme: `render()` reface tot `innerHTML`, iar fiecare item crea zeci de noduri SVG.
- **Sprite SVG:** `iconSvg(d)` cache-uieste dupa `item_type|rarity|name`; la prima folosire pune un `<symbol id="iaN" viewBox>` intr-un `<svg>` ascuns (width/height 0, `position:absolute`) in `document.body`; itemele din grila sunt `<svg viewBox><use href="#iaN"/></svg>` (1 nod). Daca `itemArt` nu are `viewBox`, se intoarce SVG-ul complet (fallback). Magazinul din raid foloseste aceeasi functie.
- **Drag:** ghostul urmareste mouse-ul imediat; hit-testing-ul (`probe`: `elementsFromPoint`, `fits`) ruleaza o data pe cadru (`requestAnimationFrame`); highlight-ul (`hl`) se atinge doar cand se schimba tinta (`hlKey`). `up()` face flush la probe-ul pending inainte sa citeasca `d.over`.
- **Tooltip:** `showTip` nu reface `innerHTML` daca textul e identic (`tipHtmlLast`); `moveTip` doar repozitioneaza; handlerul `mousemove` sare peste `find()` cat timp mouse-ul sta pe acelasi element (`tipFor`).
- **CSS:** fara `filter: drop-shadow` pe `.it svg`, fara `filter` la hover, legendarele au glow static (nu animatie infinita), `.it` are `contain: layout paint style`, banda `.btn.big` se anima doar la hover.
- **Daca tot lagheaza (stash foarte mare):** urmatorul pas e virtualizarea (desenezi doar itemele din fereastra vizibila a `.sc`). Sortarea (`sortStash` / `putAt`) e O(celule x iteme) per item: lenta la sute de iteme.

## Consumul itemelor aduse si persistenta loadout-ului
- **Consum:** `RaidScene.consume(id, qty)` apeleaza `consume_raid_item` (cu retry), tine promisiunea in `this.pend` si afiseaza toast `Server error (item): ...` la eroare. `release()` (item pus in container / aruncat) si `consumeN()` (chei, gloante, heal) trec prin ea. `extract()` face `await Promise.all([...this.pend])` inainte de `extract_player`, ca un consum in curs sa nu ramana in urma si itemul sa nu se intoarca in stash.
- **Bug-ul "cheia reapare":** `consume_raid_item` facea `update quantity = quantity - p_qty` si apoi `delete where quantity <= 0`; la consumul ultimului exemplar update-ul incalca `stash_items_quantity_check` (quantity > 0), functia esua, randul ramanea marcat cu `raid_id`, iar `extract_player` il intorcea in stash. Fix: sterge randul cand `quantity <= p_qty`, altfel scade (vezi mai jos). Fara toast-ul de eroare (client) problema nu se vedea.
- **Bug-ul de duplicare din `extract_player`:** pasul 1 aduna cantitatea adusa la TOATE randurile stackabile de acelasi tip din stash (si stergea randul adus), iar loot-ul stackabil facea `update ... where item_type = ...` pe toate randurile. Fix: randurile aduse revin ca aceleasi randuri (`update raid_id = null`), iar loot-ul se adauga la un singur rand (`order by id limit 1`).

## Fixuri SQL (de rulat o data in SQL Editor si de salvat in `supabase/fixes.sql`)
`consume_raid_item`:
```sql
CREATE OR REPLACE FUNCTION public.consume_raid_item(p_item_id bigint, p_qty integer DEFAULT 1)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if p_qty < 1 then return; end if;
  delete from stash_items
   where id = p_item_id and user_id = auth.uid() and raid_id is not null and quantity <= p_qty;
  if not found then
    update stash_items set quantity = quantity - p_qty
     where id = p_item_id and user_id = auth.uid() and raid_id is not null and quantity > p_qty;
  end if;
end $function$;
```
`extract_player`: pasul 1 = `update stash_items set raid_id = null where user_id = v_uid and raid_id = p_raid_id;` (fara unire / stergere); la loot stackabil: `update stash_items set quantity = least(quantity + v_qty, 999) where id = (select id from stash_items where user_id = v_uid and item_type = v_def.item_type and raid_id is null and quantity < 999 order by id limit 1); if found then continue; end if;`. Restul (verificari, plafon `stash_slots`, xp, `leave_raid`) neschimbat.
Functiile `leave_raid`, `create_raid`, `start_raid` nu au fost vazute de ultimul AI: daca apar duplicari noi, citeste-le primele.

## Itemi, arme, combat (`items.ts`, `RaidScene.ts`)
- `CATALOG` cunoaste: revolver, smg, shotgun, rifle, sniper, casti (light 10%, heavy 20%, `helmet_epic` 28%, `helmet_legendary` 38%, toate 2x2; ultimele doua sunt si in `item_defs` prin changes.sql) / veste (`registerDefs` face orice vesta `legendary` 4x4, ca rucsacul legendar; slotul `body` e 4x4), bandage/medkit/stim, chei (`Depozit`, `Banca`, `Casa`), 4 rucsacuri. `registerDefs()` deduce restul din nume/raritate (`infer`). Pistolul implicit nu e in DB (gloante infinite). Arma are `mag`, `reload`, `ammo` (tip item gloante), sniper are `range/fov` (conul de vedere se prelungeste; camera NU mai urmareste mouse-ul: `cameraLead` din RaidScene are `k = 0`, camera ramane pe caracter).
- Combat **victim-authoritative**: fiecare client simuleaza gloantele, doar victima isi aplica damage-ul (armura reduce), apoi `pos` cu HP nou; HP 0 => `dead`. Hostul aplica damage pe boti. Spawn protection 3 s. Shotgun = un mesaj, alicele din seed.
- **Heal:** clic dreapta / H, intrerupt la lovitura. **Masini:** `E` (hotwire 1.5 s), W/S gaz-frana, A/D directie, lovesc jucatorii (victim-authoritative). **Usi incuiate:** necesita cheia potrivita in inventar (consumata).

## Multiplayer (`net/realtime.ts`)
Mesaje Broadcast: `pos` (dead reckoning: doar la schimbare de viteza + corectie rara, heartbeat 4 s, stale 12 s), `shot`, `dead` (drop cu `did` unic), `looted` (comutativ), `put` (iteme puse intr-un container / drop: `{k, added[]}`), `drop` (item aruncat pe jos, aceeasi forma ca `dead`, creeaza doar containerul), `gone`, `alarm`, `door`, `car`, `hello`/`state` (jucator care intra tarziu primeste containerele modificate, drop-urile, usile, masinile; starea unui container atins inlocuieste lista locala, nu doar scade din ea, ca sa includa si itemele depuse), `probe`/`alive` (capacitate). Fara Presence.
- **Boti:** simulati doar de host = cel mai mic id (`electHost`, la 1 s), `BOT_COUNT = 8`, patrulare/urmarire/foc cu acelasi raycast de vedere, respawn 30 s, drop la moarte, id `bot:<host>:<n>`, trimisi ca `pos`. Fara pathfinding (se pot bloca). **Alarma:** cine ia un item `legendary` trimite `alarm`, botii din 800 px vin 20 s.
- **Buget:** `MSG_BUDGET = 70`; rata corectiilor `pos` scade cu n^2. Optiuni daca trebuie 15 jucatori: Supabase Pro, server WebSocket separat doar pentru pozitii, interest management pe zone.

## Randare, vizibilitate, UI (`RaidScene.ts`)
- **Ecran complet:** containerul `#game` e `position: fixed; inset: 0`; Phaser `Scale.RESIZE` (fara bare negre). Elementele fixe pe ecran se repozitioneaza in `layout()` (apelat la `scale 'resize'`): vigneta, bara de viata, textul arma/gloante/bani, mesajele, minimap.
- **UI (HTML, nu Phaser):** HUD-ul din raid e un `div.hud` adaugat peste canvas (`buildHud` / `updateHud`, recalculat doar cand se schimba ceva): panou jos stanga cu arma, incarcator mare (rosu cand e pe terminate), rezerva, bara de viata segmentata, armura si bani; flash rosu la lovitura (`hud.hit`). Mesajele sunt toast-uri HTML (`say()`, max 4, dispar dupa ~3.5 s). Minimap-ul ramane desenat in Phaser (dreapta sus, 2 px/tile, cu rama galbena). HUD-ul text din stanga sus (hp, zona, jucatori, controale) a fost scos intentionat.
- **Pop-up-uri in joc:** `ui/modal.ts` (`confirmBox`, `infoBox`) inlocuiesc complet `window.confirm`. Cat timp un pop-up e deschis, tastele `keydown` sunt interceptate (doar keydown, ca `keyup` sa ajunga la Phaser) si `RaidScene.modal` blocheaza miscarea, focul si tastele E/H/R/Q (consumate cu `JustDown`, ca sa nu se declanseze dupa inchidere). Pentru actiuni periculoase (abandon, vanzare, extragere fara loot) butonul implicit e "Anuleaza". Folosit la: vanzare (V in hub), abandon (Q in raid si in ecranul de recuperare), extragere fara loot si raportul de dupa raid (extractie reusita / raid incheiat).
- **Tema vizuala:** tokeni in `:root` din `style.css` (asfalt `--ink`, otel `--steel/--plate`, accent unic galben de santier `--amber`, bani `--cash`); semnul distinctiv e banda de avertizare (`--tape`) pe bara de sus, cardul de login, butonul "Intra pe server" si pop-up-uri. Fonturi: Barlow Condensed (titluri, cifre) + Barlow (text). Butoanele au colturi taiate (`--chamfer`); culorile raritatii sunt variabila `--rc` (`.r-*` / `.sr-*`). Respecta `prefers-reduced-motion`. Orice culoare noua se pune ca token, nu hardcodata.
- **Vizibilitate:** `vision()` = 180 de raze, con 110 grade spre mouse (raza 420) + cerc 90 px; intunericul se deseneaza ca triunghiuri (FOG_R 1800), fara masti. `see(x,y)` ascunde jucatori/gloante/containere/masini din afara conului. Containerele si magazinele vazute o data raman afisate.
- Texturi 100% din cod (`art.ts`); ~7.5k tile-uri imagine pe harta (daca scade FPS: pre-randare in RenderTexture).

## Limitari cunoscute / securitate
- La extractie, itemele aduse nu se mai unesc cu randurile din stash (fix duplicare): daca ai mai multe randuri stackabile de acelasi tip, raman separate pana le muti / vinzi. Loot-ul stackabil nou se adauga la primul rand cu `quantity < 999`.
- Clientul e de incredere pentru loot gasit, xp si damage (potrivit pentru prieteni, nu pentru public). Vizibilitatea e doar pe client.
- Doi jucatori pot lua simultan acelasi item (duplicare rara).
- Abandonul lasa un drop cu tot rucsacul (poate fi folosit ca transfer de iteme intre prieteni).
- Loot-ul gasit exista doar in memoria clientului; refresh in raid il pierde. Tab inchis fara extractie = ramai in `raid_players`, reintri in raid.
- `spend_money` valideaza doar suma si faptul ca esti in raid (itemul cumparat nu e verificat server-side).
- Itemele puse intr-un container al hartii dispar la urmatorul reset de loot (`rerollLoot` rescrie `c.items`); doar drop-urile (aruncate / de la cadavre) raman. Itemele depuse de altii apar la ceilalti ca "?" (nerevelate) in containerele hartii.
- Aruncarea poate fi folosita ca transfer de iteme intre prieteni (ca abandonul); itemele aduse din stash se scad din DB la aruncare / depunere.
- Gloantele trec peste apa, dar sunt oprite de gard/masini/rafturi/pompe (`isShot` vs `isWall`).
- Limita stash-ului din UI (randuri = `stash_slots / 10`) e doar vizuala; server-side `stash_slots` ramane numarul maxim de iteme (nu de celule), deci un stash plin vizual poate avea inca loc pe server si invers.

## Probleme deschise
0. **De confirmat in browser (ultima sesiune):** (a) cheia folosita in raid NU mai reapare dupa extractie (si ca ai doua chei, folosesti una => ramane una); (b) loot-ul gasit revine in acelasi slot dupa extractie, nu in stash; (c) hub-ul nu mai lagheaza cu stash mare (sprite SVG, drag pe rAF); (d) `tsc --noEmit` nu a rulat pe ultimele modificari (`inventory.ts`, `RaidScene.ts`, `main.ts`). Cele doua functii SQL de mai sus trebuie rulate in Supabase si adaugate in `supabase/*.sql`.
1. **`extract_player` (SQL):** limitele `loot exceeds limits` (c_max_items 40, c_max_epic 4, c_max_leg 2) au fost scoase din functia SQL (utilizatorul a rulat versiunea noua in SQL Editor; de confirmat ca extractia merge cu rucsac militar plin). Raman: `not in raid`, `raid not extractable yet` (60 s), `invalid xp` (max 2000), `unknown item`, `invalid quantity` (max 50 stackable / 1 altfel) si `skipped_stash_full`. Clientul trimite stack-urile in bucati de max 50; constantele `MAX_XP`, `MAX_STACK` din RaidScene oglindesc SQL: schimba-le impreuna. `supabase/*.sql` din repo trebuie actualizat cu noua functie.
2. Magazinele depind de `item_defs`: daca lipsesc arme/gloante (`ammo_*`)/heal/armuri in DB, magazinul respectiv apare gol.
3. Neverificat in browser de AI-ul care a scris ultima versiune: ecranul complet, overlay-ul de magazin, rucsacurile in raid cu 2+ jucatori, **depunerea / aruncarea itemelor si noul HUD / tema** (doar `tsc`, `map.check` si `vite build` au rulat). De testat: depui un item in container si il ia al doilea jucator; arunci un item adus din stash (verifica ca dispare din stash dupa extractie); Enter / Esc / Tab in pop-up nu misca jucatorul.
4. **Nou, neverificat in browser (doar scris, nici `tsc` nu a rulat):** panoul Echipament refacut (fara suprapunere rucsac / arma), stash cu dimensiune fixa (nu mai creste pe ultimul rand), pastrarea scroll-ului la mutarea itemelor, `.hub` lat (inventarul cu rucsac mare ramane pe acelasi rand), inventarul / echipamentul raman dupa raid (fara mutare automata in stash). De testat: pui un item pe ultimul rand din stash si nu apare rand nou; muti iteme prin stash fara salt de scroll; echipezi rucsacul militar si Inventarul ramane langa Echipament; dupa extractie echipamentul si inventarul raman unde erau, iar lootul nou apare in stash; stash-ul plin nu creste (itemele in plus stau sub grila). **Rezolvat:** clientul foloseste minim 100 de sloturi; SQL-ul din `supabase/changes.sql` seteaza si default-ul / valoarea din DB la minim 100. Preturile upgrade-ului (1000 x numarul upgrade-ului) sunt provizorii: se schimba in `upgradeCost` (main.ts) si in `upgrade_stash` (SQL) impreuna.

5. **Nou, neverificat in browser:** deblocarea uniforma a itemelor din container (gri + `?`, 1 s fiecare, efect `pop`) si `equipFromChest`. De testat: deschizi un chest cu 3+ iteme (toate gri, apar pe rand cu bara galbena); gasesti un rucsac mai mare cu inventarul plin si clic dreapta il echipeaza; rucsacul vechi ajunge in inventar sau ramane in container; schimbul se anuleaza daca noul rucsac e mai mic si itemele nu incap.

## Modificari recente (de testat in browser; doar scrise, `tsc` / `map.check` nerulate)
- **Stash:** start 100 sloturi, +50 per upgrade cu pret, max 750 (vezi RPC si Fluxul jocului).
- **Echipament:** vesta legendara 4x4, slotul vestei 4x4, panou 320x332; casti epic / legendary noi.
- **Camera:** fixa pe caracter (sniper inclus).
- **Loot:** sanse de raritate reduse, chei cu sansa proprie, reset la 5 minute. Toti jucatorii trebuie sa aiba aceeasi versiune a `map.ts`, altfel loot-ul nu mai coincide.
- **De verificat:** `npx tsx src/game/map.check.ts` (trebuie sa treaca; testul foloseste defs fara chei, deci ramura cheilor nu e acoperita), `npx tsc --noEmit`, numele cheilor din DB (`keycard_bank`, `key_warehouse`, `key_house`) si ca vesta legendara 4x4 incape in rucsac / container.

- **Preturi:** vanzare = 40% din `base_value` (client: `sellPrice()` in items.ts; server: `sell_item`), cumparare in raid = 2x `base_value`. Tooltip-ul arata acum pretul de vanzare. SELL_PCT si SQL-ul se schimba impreuna.

- **Stackare:** vezi "Stack-uri" in Inventar. In stash fiecare rand din DB ramane separat (max 50 per rand, limita `extract_player`), deci un stack mare din raid ajunge in stash in mai multe sloturi.

- **Ultima sesiune:** loadout-ul ramane dupa extractie (`saveRaidLayout` / `savePending` / `applyPending` + `distribute(..., prefer)`); consum tracked cu `pend` si await inainte de extractie; `consume_raid_item` si `extract_player` corectate (SQL); optimizari hub (sprite SVG, drag pe rAF, tooltip, CSS).

## Idei urmatoare (Pasul 6)
Economie extinsa (magazin si in hub), crafting / upgrade Hideout, skill tree, A* pentru boti, zgomot de masini care atrage boti, optimizari de trafic, mutarea starii efemere critice pe server daca jocul devine public.

## Conventii de cod
TypeScript strict; comentarii si UI in romana; fara framework UI (HTML prin template strings, `esc()` pe orice text extern); `showHub()` re-randeaza tot (mesaje prin `note`; confirmarile prin `ui/modal.ts`, niciodata dialoguri native); orice schimbare de schema se scrie in `supabase/*.sql` si se ruleaza manual in SQL Editor; harta si loot trebuie sa ramana deterministe (acelasi seed => aceeasi harta la toti jucatorii).