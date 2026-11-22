import "./style.css";
import { supabase } from "./lib/supabase";
import { runRaid } from "./game/RaidScene";
import { peekCount, MAX_PLAYERS, SERVER } from "./net/realtime";
import {
  mkBoxes,
  mountInventory,
  saveLayout,
  clearLoadout,
  distribute,
  fits,
  placeOverflow,
  quickEquip,
  refit,
  type Box,
} from "./ui/inventory";
import { registerDefs, dims, spec, type Def, type Item } from "./game/items.ts";
import { confirmBox, infoBox } from "./ui/modal.ts";

type Row = {
  id: number;
  item_type: string;
  quantity: number;
  raid_id: string | null;
};

const STASH_START = 100, STASH_STEP = 50, STASH_MAX = 750;
// trebuie sa fie identic cu formula din SQL (upgrade_stash)
const upgradeCost = (slots: number) => 1000 * ((slots - 50) / 50);

// Categorii pentru sortarea / selectia din stash
const CATS = ["Arme", "Armuri", "Rucsacuri", "Heal", "Gloante", "Chei", "Altele"];
const RAR = ["legendary", "epic", "rare", "uncommon", "common"];
const catOf = (d: Def): string => {
  const s = spec(d.item_type);
  if (s?.gun) return "Arme";
  if (s?.slot === "head" || s?.slot === "body") return "Armuri";
  if (s?.slot === "back") return "Rucsacuri";
  if (s?.heal) return "Heal";
  if (/^ammo_/.test(d.item_type)) return "Gloante";
  if (s?.door || /key|cheie/i.test(d.item_type)) return "Chei";
  return "Altele";
};

const app = document.getElementById("app")!;
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let uid: string | null = null;
let note = ""; // mesaj afisat dupa urmatorul render
let teardown: (() => void) | null = null; // curata inventarul + listener-ele hub-ului inainte de re-render
let raidBad = false; // iesirea din raid a esuat (retea): aratam ecranul de recuperare, nu re-intram in bucla
let lastErr = "";

const msg = (t: string) => {
  const el = document.getElementById("msg");
  if (el) el.textContent = t;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isNet = (m: string) =>
  /fetch|network|timeout|timed out|failed to|load failed|abort/i.test(m);

// Returneaza {data} la succes, null la eroare (eroarea apare in #msg). Reincearca singur la erori de retea.
async function rpc(fn: string, args?: object, tries = 3) {
  lastErr = "";
  for (let i = 0; i < tries; i++) {
    try {
      const { data, error } = await supabase.rpc(fn, args);
      if (!error) return { data };
      lastErr = error.message;
      if (!isNet(lastErr)) break;
    } catch (e) {
      lastErr = String((e as Error)?.message ?? e);
    }
    if (i < tries - 1) {
      msg(`Conexiune slaba, reincerc (${i + 1}/${tries - 1})...`);
      await wait(800 * (i + 1));
    }
  }
  msg(lastErr || "Eroare necunoscuta");
  return null;
}

function showAuth() {
  teardown?.();
  teardown = null;
  app.innerHTML = `<div class="auth">
    <div class="card auth-card">
      <div class="brand big">URBAN<span>HEIST</span></div>
      <p class="sub">Extraction shooter 2D · intra, jefuieste, scoate-ti prada</p>
      <input id="u" placeholder="username (doar la Register)" autocomplete="username">
      <input id="e" type="email" placeholder="email" autocomplete="email">
      <input id="p" type="password" placeholder="parola (min 6)" autocomplete="current-password">
      <div class="row"><button id="login" class="btn primary">Login</button><button id="reg" class="btn">Register</button></div>
      <p id="msg" class="note"></p>
    </div></div>`;
  const val = (id: string) =>
    (document.getElementById(id) as HTMLInputElement).value;

  $("login").onclick = async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: val("e").trim(),
      password: val("p"),
    });
    if (error) msg(error.message);
  };
  $("reg").onclick = async () => {
    const { data, error } = await supabase.auth.signUp({
      email: val("e").trim(),
      password: val("p"),
      options: { data: { username: val("u").trim() } },
    });
    if (error) return msg(error.message);
    if (!data.session) msg("Cont creat. Confirma emailul, apoi Login.");
  };
}

const card = (html: string) => {
  app.innerHTML = `<div class="auth"><div class="card auth-card">${html}</div></div>`;
};

async function showHub() {
  teardown?.();
  teardown = null;
  const res = await Promise.all([
    supabase
      .from("profiles")
      .select("username,money,xp,level,stash_slots")
      .eq("id", uid!)
      .single(),
    supabase
      .from("raid_players")
      .select("raid_id")
      .eq("user_id", uid!)
      .maybeSingle(),
    supabase
      .from("stash_items")
      .select("id,item_type,quantity,raid_id")
      .order("id"),
    supabase.from("item_defs").select("*"),
  ]).catch(() => null);

  if (!res) {
    card(
      `<p>Nu pot contacta serverul (fetch failed). Verifica internetul.</p><button id="retry" class="btn primary">Reincearca</button><button id="out" class="btn">Logout</button>`,
    );
    $("retry").onclick = () => showHub();
    $("out").onclick = () => supabase.auth.signOut();
    return;
  }
  const [me, inRaid, items, defsQ] = res;

  if (!me.data) {
    card(
      `<p>Profil indisponibil: ${esc(me.error?.message ?? "niciun rand pentru acest user")}</p><button id="retry" class="btn primary">Reincearca</button><button id="out" class="btn">Logout</button>`,
    );
    $("retry").onclick = () => showHub();
    $("out").onclick = () => supabase.auth.signOut();
    return;
  }

  const p = me.data;
  const raidId: string | undefined = inRaid.data?.raid_id;

  if (raidId && !raidBad) {
    app.innerHTML = `<div id="game" style="position:fixed;inset:0"></div>`;
    runRaid(
      $("game"),
      raidId,
      SERVER,
      { id: uid!, name: p.username },
      (n, failed) => {
        note = n;
        if (failed) raidBad = true; // dupa raid inventarul si echipamentul raman cum erau; le muti tu in stash
        showHub();
        if (!failed) {
          // la eroare de retea ecranul de recuperare arata deja mesajul
          const won = /^Extractie/.test(n);
          void infoBox({
            title: won ? "Extractie reusita" : "Raid incheiat",
            text: n,
            ok: "Inapoi in baza",
            tone: won ? "good" : "bad",
          });
          note = "";
        }
      },
    );
    return;
  }

  // Raid blocat: serverul inca te considera in raid, dar iesirea a esuat. Poti reintra sau abandona.
  if (raidId && raidBad) {
    card(`<div class="brand">URBAN<span>HEIST</span></div>
      <p>Esti inca inregistrat intr-un raid. ${esc(note)}</p>
      <button id="again" class="btn primary">Reintra in raid</button>
      <button id="leave" class="btn">Abandoneaza raidul (pierzi itemele aduse)</button>
      <button id="out" class="btn ghost">Logout</button>
      <p id="msg" class="note"></p>`);
    $("again").onclick = () => {
      raidBad = false;
      showHub();
    };
    $("out").onclick = () => supabase.auth.signOut();
    $("leave").onclick = async () => {
      if (
        !(await confirmBox({
          title: "Abandonezi raidul?",
          text: "Pierzi itemele aduse la risc.",
          ok: "Abandoneaza",
          cancel: "Inapoi",
          danger: true,
        }))
      )
        return;
      msg("Se iese din raid...");
      const r = await rpc("die_in_raid", { p_raid_id: raidId }, 5);
      if (r || /not in raid/i.test(lastErr)) {
        raidBad = false;
        clearLoadout(uid!);
        note = "Ai parasit raidul.";
        showHub();
      }
    };
    return;
  }

  if (!defsQ.data) {
    card(
      `<p>Nu pot incarca itemele: ${esc(defsQ.error?.message ?? "")}</p><button id="retry" class="btn primary">Reincearca</button><button id="out" class="btn">Logout</button>`,
    );
    $("retry").onclick = () => showHub();
    $("out").onclick = () => supabase.auth.signOut();
    return;
  }

  registerDefs(defsQ.data as Def[]); // itemele necunoscute (armuri, arme, heal, chei) devin utilizabile
  const defs = new Map((defsQ.data as Def[]).map((d) => [d.item_type, d]));
  const safe = ((items.data ?? []) as Row[]).filter(
    (r) => !r.raid_id && defs.has(r.item_type),
  );

  // Stash (grila cu dimensiune FIXA: 10 coloane, un rand la fiecare 10 sloturi, minim 8 randuri) + loadout (rucsac + 3 sloturi);
  // pozitiile se tin in localStorage. Stash-ul nu creste niciodata: itemele care nu incap raman sub grila pana le muti / vinzi.
  const B = mkBoxes();
  const slots = Math.min(STASH_MAX, Math.max(STASH_START, p.stash_slots));
  const rows = Math.ceil(slots / 10);
  const cost = upgradeCost(slots);
  const maxed = slots >= STASH_MAX;
  const stash: Box = {
    id: "stash",
    title: `Stash ${safe.length}/${slots}`,
    w: 10,
    h: rows,
    cap: rows,
    items: [],
  };
  const list: Item[] = safe.map((r) => ({
    id: String(r.id),
    type: r.item_type,
    qty: r.quantity,
    x: 0,
    y: 0,
    r: false,
  }));
  distribute(
    defs,
    uid!,
    list,
    [stash, B.bag, B.head, B.body, B.weapon, B.back],
    stash,
    () => refit(defs, B.bag, B.back),
  );
  const save = () =>
    saveLayout(uid!, [stash, B.bag, B.head, B.body, B.weapon, B.back]);

  save();

  // Itemele care nu au mai incaput in grila stau sub ea (gridul nu creste): avertizam o data
  const over = stash.items.filter(
    (i) => i.y + dims(defs.get(i.type)!, i.r)[1] > stash.cap!,
  ).length;
  if (over)
    note += `${note ? " " : ""}${over} ${over === 1 ? "item nu a incaput" : "iteme nu au incaput"} in stash (sunt sub grila): muta-le in inventar sau vinde-le (V).`;

  const loadout = () => [
    ...B.bag.items,
    ...B.head.items,
    ...B.body.items,
    ...B.weapon.items,
    ...B.back.items,
  ];

  app.innerHTML = `<div class="hub">
    <header class="top">
      <div class="brand">URBAN<span>HEIST</span></div>
      <div class="stats">
        <div class="chip"><small>OPERATOR</small><b>${esc(p.username)}</b></div>
        <div class="chip"><small>NIVEL</small><b>${p.level}</b></div>
        <div class="chip"><small>XP</small><b>${p.xp}</b></div>
        <div class="chip money"><small>BANI</small><b>$${p.money}</b></div>
      </div>
      <button id="out" class="btn ghost">Logout</button>
    </header>
    <main class="card">
      <div class="card-h">
        <h3>Pregatire raid</h3>
        <span class="hint">Ce pui in <b>Inventar</b> sau pe <b>Echipament</b> iei la risc in raid; un <b>rucsac</b> echipat mareste inventarul (nu uita <b>gloantele</b> pentru arma ta). <kbd>Clic dreapta</kbd> echipeaza · <kbd>R</kbd> roteste · <kbd>V</kbd> peste un item din stash il vinde</span>
      </div>
      <div class="tools">
        <label>Sorteaza
          <select id="sortsel">
            <option value="cat">Categorie</option>
            <option value="rar">Raritate</option>
            <option value="val">Valoare</option>
            <option value="name">Nume</option>
          </select>
        </label>
        <button id="sortgo" class="btn">Sorteaza stash</button>
        <span class="sep"></span>
        <button id="selmode" class="btn">Selectie: OFF</button>
        <button id="selall" class="btn ghost">Tot stash-ul</button>
        <button id="selclr" class="btn ghost">Deselecteaza</button>
        <span class="th"><kbd>Ctrl</kbd>+click selecteaza un item</span>
        <button id="sellsel" class="btn danger" disabled>Vinde selectia</button>
      </div>
      <div id="inv"></div>
    </main>
    <footer class="bar">
      <button id="up" class="btn"${maxed || p.money < cost ? " disabled" : ""}>${maxed ? "Stash la maxim" : `Upgrade stash (+${STASH_STEP} sloturi, $${cost})`}</button>
      <p id="msg" class="note">${esc(note)}</p>
      <button id="go" class="btn primary big">INTRA PE SERVER</button>
    </footer>
  </div>`;
  note = "";

  $("out").onclick = () => supabase.auth.signOut();

  // Dupa o actiune reusita: mesaj + re-render
  const done = (t: string) => {
    note = t;
    showHub();
  };

  // ---- selectie multipla (doar stash) ----
  const sel = new Set<string>();
  let selMode = false;
  const stashSel = () => stash.items.filter((i) => sel.has(i.id));
  const worth = (it: Item) => (defs.get(it.type)?.base_value ?? 0) * it.qty;
  const refreshTools = () => {
    const list = stashSel();
    const btn = $("sellsel") as HTMLButtonElement;
    btn.disabled = !list.length;
    btn.textContent = list.length
      ? `Vinde ${list.length} ($${list.reduce((t, i) => t + worth(i), 0)})`
      : "Vinde selectia";
    $("selmode").textContent = `Selectie: ${selMode ? "ON" : "OFF"}`;
    $("selmode").classList.toggle("on", selMode);
    $("inv").classList.toggle("selmode", selMode);
  };

  const inv = mountInventory(
    $("inv"),
    stash,
    [B.head, B.body, B.weapon, B.back],
    B.bag,
    {
      defs,
      onChange: () => {
        save();
        refreshTools();
      },
      pick: (it, from, e) => {
        if (from !== stash || !(selMode || e.ctrlKey || e.shiftKey)) return false;
        if (sel.has(it.id)) sel.delete(it.id);
        else sel.add(it.id);
        refreshTools();
        inv.render();
        return true;
      },
      selected: (it) => sel.has(it.id),
      refit: () => refit(defs, B.bag, B.back),
      onDeny: (m) => msg(m),
      onUse: (it, from) => {
        if (
          quickEquip(
            defs,
            it,
            from,
            { head: B.head, body: B.body, weapon: B.weapon, back: B.back },
            B.bag,
          )
        )
          save();
        else msg("Nu se poate echipa / nu incape");
      },
    },
  );

  // V peste un item din stash = vinde (cu confirmare)
  let hover: string | null = null;
  $("inv").addEventListener("mouseover", (e) => {
    hover =
      (e.target as HTMLElement).closest<HTMLElement>(".it")?.dataset.it ?? null;
  });
  const onKey = async (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== "v" || !hover) return;
    const it = stash.items.find((i) => i.id === hover);
    if (!it) return msg("Poti vinde doar din stash");
    const def = defs.get(it.type)!;
    if (
      !(await confirmBox({
        title: `Vinzi ${def.name}?`,
        text: `${def.name} x${it.qty} se vinde pentru $${(def.base_value ?? 0) * it.qty}. Nu se poate anula.`,
        ok: "Vinde",
        cancel: "Pastreaza",
        danger: true,
      }))
    )
      return;
    if (await rpc("sell_item", { p_item_id: +it.id, p_qty: it.qty })) {
      stash.items = stash.items.filter((i) => i !== it);
      save();
      done("Vandut.");
    }
  };
  window.addEventListener("keydown", onKey);
  teardown = () => {
    inv.destroy();
    window.removeEventListener("keydown", onKey);
  };

  // ---- sortare stash ----
  const putAt = (it: Item, minY: number) => {
    for (let y = minY; y < rows; y++)
      for (let x = 0; x < stash.w; x++)
        for (const r of [false, true])
          if (fits(defs, stash, it, x, y, r)) {
            Object.assign(it, { x, y, r });
            stash.items.push(it);
            return true;
          }
    return false;
  };
  const sortStash = (mode: string) => {
    const d = (i: Item) => defs.get(i.type)!;
    const cat = (i: Item) => CATS.indexOf(catOf(d(i)));
    const rar = (i: Item) => RAR.indexOf(d(i).rarity);
    const nm = (a: Item, b: Item) => d(a).name.localeCompare(d(b).name);
    const cmp: Record<string, (a: Item, b: Item) => number> = {
      cat: (a, b) => cat(a) - cat(b) || rar(a) - rar(b) || nm(a, b),
      rar: (a, b) => rar(a) - rar(b) || cat(a) - cat(b) || nm(a, b),
      val: (a, b) => worth(b) - worth(a) || nm(a, b),
      name: nm,
    };
    // cat / rar: fiecare grup nou incepe pe un rand nou
    const group = (i: Item) => (mode === "cat" ? catOf(d(i)) : mode === "rar" ? d(i).rarity : "");
    const items = [...stash.items].sort(cmp[mode] ?? nm);
    stash.items = [];
    stash.h = rows;
    let bottom = 0, minY = 0, g: string | null = null;
    for (const it of items) {
      if (g !== null && group(it) !== g) minY = bottom;
      g = group(it);
      if (!putAt(it, minY) && !putAt(it, 0)) placeOverflow(defs, stash, it);
      bottom = Math.max(bottom, it.y + dims(d(it), it.r)[1]);
    }
    save();
    inv.render();
    msg("Stash sortat.");
  };
  $("sortgo").onclick = () => sortStash(($("sortsel") as HTMLSelectElement).value);

  // ---- selectie / vanzare in masa ----
  $("selmode").onclick = () => {
    selMode = !selMode;
    refreshTools();
  };
  $("selall").onclick = () => {
    for (const it of stash.items) sel.add(it.id);
    selMode = true;
    refreshTools();
    inv.render();
  };
  $("selclr").onclick = () => {
    sel.clear();
    refreshTools();
    inv.render();
  };
  $("sellsel").onclick = async () => {
    const list = stashSel();
    if (!list.length) return;
    const total = list.reduce((t, i) => t + worth(i), 0);
    const rare = list.filter((i) => ["epic", "legendary"].includes(defs.get(i.type)!.rarity)).length;
    if (
      !(await confirmBox({
        title: `Vinzi ${list.length} iteme?`,
        text: `Primesti $${total}. Nu se poate anula.${rare ? ` Atentie: ${rare} sunt epice / legendare.` : ""}`,
        ok: "Vinde tot",
        cancel: "Pastreaza",
        danger: true,
      }))
    )
      return;
    ($("sellsel") as HTMLButtonElement).disabled = true;
    let n = 0, got = 0;
    for (const it of list) {
      msg(`Vand ${n + 1}/${list.length}...`);
      if (!(await rpc("sell_item", { p_item_id: +it.id, p_qty: it.qty }))) break;
      n++;
      got += worth(it);
    }
    done(n === list.length ? `Vandute ${n} iteme, +$${got}.` : `Vandute ${n} din ${list.length} (eroare: ${lastErr}).`);
  };
  refreshTools();

  $("up").onclick = async () => {
    if (maxed) return msg(`Stash-ul e deja la maxim (${STASH_MAX}).`);
    if (p.money < cost) return msg(`Nu ai destui bani ($${cost}).`);
    const r = await rpc("upgrade_stash");
    if (r) done(`Stash marit (+${STASH_STEP}), -$${cost}.`);
    else if (/not enough money/i.test(lastErr)) msg(`Nu ai destui bani ($${cost}).`);
  };
  $("go").onclick = async () => {
    const btn = $("go") as HTMLButtonElement;
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const ids = loadout().map((i) => +i.id);
      msg("Verific serverul...");
      if ((await peekCount(SERVER)) >= MAX_PLAYERS)
        return msg(`Serverul e plin (${MAX_PLAYERS}/${MAX_PLAYERS}).`);

      // Fiecare jucator are propriul raid pe server (validare extractie/moarte); serverul comun e canalul Broadcast.
      const raid = await rpc("create_raid");
      if (!raid) return;
      if (!(await rpc("join_raid", { p_raid_id: raid.data, p_item_ids: ids })))
        return;
      if (!(await rpc("start_raid", { p_raid_id: raid.data }))) return;
      raidBad = false;
      done("Esti in raid. Extractia e permisa dupa 60s.");
    } finally {
      btn.disabled = false;
    }
  };
}

// Reactioneaza doar la schimbarea userului (SIGNED_IN se re-emite uneori la focus pe tab)
supabase.auth.onAuthStateChange((_e, session) => {
  const id = session?.user.id ?? null;
  if (id === uid && app.innerHTML) return;
  uid = id;
  setTimeout(() => (id ? showHub() : showAuth()), 0); // evita blocaj in callback-ul supabase
});