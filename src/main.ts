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
  applyPending,
  quickEquip,
  refit,
  type Box,
} from "./ui/inventory";
import { registerDefs, dims, spec, sellPrice, type Def, type Item } from "./game/items.ts";
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
const CATS = ["Weapons", "Armor", "Backpacks", "Healing", "Ammo", "Keys", "Valuables", "Materials", "Other"];
const VALUABLES = new Set(["cheap_watch", "phone", "keycard", "laptop", "gold_bar", "prototype_tech", "bank_diamond", "encrypted_server"]);
const MATERIALS = new Set(["fuel_can", "bolts", "canned_food", "gun_parts"]);
const RAR = ["legendary", "epic", "rare", "uncommon", "common"];
const catOf = (d: Def): string => {
  const s = spec(d.item_type);
  if (s?.gun) return "Weapons";
  if (s?.slot === "head" || s?.slot === "body") return "Armor";
  if (s?.slot === "back") return "Backpacks";
  if (s?.heal) return "Healing";
  if (/^ammo_/.test(d.item_type)) return "Ammo";
  if (s?.door || /key|cheie/i.test(d.item_type)) return "Keys";
  if (VALUABLES.has(d.item_type)) return "Valuables";
  if (MATERIALS.has(d.item_type)) return "Materials";
  return "Other";
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

// Returneaza {data} la succes, null la eroare (eroarea apare in #msg). Retry singur la erori de retea.
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
      msg(`Weak connection, retrying (${i + 1}/${tries - 1})...`);
      await wait(800 * (i + 1));
    }
  }
  msg(lastErr || "Unknown error");
  return null;
}

function showAuth() {
  teardown?.();
  teardown = null;
  app.innerHTML = `<div class="auth">
    <div class="card auth-card">
      <div class="brand big">URBAN<span>HEIST</span></div>
      <p class="sub">2D extraction shooter · get in, loot, get out with the prize</p>
      <input id="u" placeholder="username (Register only)" autocomplete="username">
      <input id="e" type="email" placeholder="email" autocomplete="email">
      <input id="p" type="password" placeholder="password (min 6)" autocomplete="current-password">
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
    if (!data.session) msg("Account created. Confirm your email, then Login.");
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
      `<p>Cannot reach the server (fetch failed). Check your internet connection.</p><button id="retry" class="btn primary">Retry</button><button id="out" class="btn">Logout</button>`,
    );
    $("retry").onclick = () => showHub();
    $("out").onclick = () => supabase.auth.signOut();
    return;
  }
  const [me, inRaid, items, defsQ] = res;

  if (!me.data) {
    card(
      `<p>Profile unavailable: ${esc(me.error?.message ?? "no row for this user")}</p><button id="retry" class="btn primary">Retry</button><button id="out" class="btn">Logout</button>`,
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
          const won = /^Extraction/.test(n);
          void infoBox({
            title: won ? "Extraction successful" : "Raid over",
            text: n,
            ok: "Back to base",
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
      <p>You are still registered in a raid. ${esc(note)}</p>
      <button id="again" class="btn primary">Rejoin raid</button>
      <button id="leave" class="btn">Abandon raid (you lose the items you brought)</button>
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
          title: "Abandon the raid?",
          text: "You lose the items you brought into the raid.",
          ok: "Abandon",
          cancel: "Back",
          danger: true,
        }))
      )
        return;
      msg("Leaving the raid...");
      const r = await rpc("die_in_raid", { p_raid_id: raidId }, 5);
      if (r || /not in raid/i.test(lastErr)) {
        raidBad = false;
        clearLoadout(uid!);
        note = "You left the raid.";
        showHub();
      }
    };
    return;
  }

  if (!defsQ.data) {
    card(
      `<p>Cannot load items: ${esc(defsQ.error?.message ?? "")}</p><button id="retry" class="btn primary">Retry</button><button id="out" class="btn">Logout</button>`,
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
  }));
  const prefer = applyPending(uid!, list, [stash, B.bag, B.head, B.body, B.weapon, B.back]);
  distribute(
    defs,
    uid!,
    list,
    [stash, B.bag, B.head, B.body, B.weapon, B.back],
    stash,
    () => refit(defs, B.bag, B.back),
    prefer,
  );
  const save = () =>
    saveLayout(uid!, [stash, B.bag, B.head, B.body, B.weapon, B.back]);

  save();

  // Itemele care nu au mai incaput in grila stau sub ea (gridul nu creste): avertizam o data
  const over = stash.items.filter(
    (i) => i.y + dims(defs.get(i.type)!)[1] > stash.cap!,
  ).length;
  if (over)
    note += `${note ? " " : ""}${over} ${over === 1 ? "item did" : "items did"} not fit in the stash (below the grid): move them to your inventory or sell them (V).`;

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
        <div class="chip"><small>LEVEL</small><b>${p.level}</b></div>
        <div class="chip"><small>XP</small><b>${p.xp}</b></div>
        <div class="chip money"><small>MONEY</small><b>$${p.money}</b></div>
      </div>
      <button id="out" class="btn ghost">Logout</button>
    </header>
    <main class="card">
      <div class="card-h">
        <h3>Raid Prep</h3>
        <span class="hint">Whatever you put in <b>Inventory</b> or on <b>Equipment</b> is at risk in the raid; an equipped <b>backpack</b> enlarges the inventory (don't forget <b>ammo</b> for your weapon). <kbd>Right-click</kbd> equips · <kbd>V</kbd> over a stash item sells it</span>
      </div>
      <div class="tools">
        <label>Sort by
          <select id="sortsel">
            <option value="cat">Category</option>
            <option value="rar">Rarity</option>
            <option value="val">Value</option>
            <option value="name">Name</option>
          </select>
        </label>
        <button id="sortgo" class="btn">Sort stash</button>
        <span class="sep"></span>
        <button id="selmode" class="btn">Select: OFF</button>
        <button id="selall" class="btn ghost">Whole stash</button>
        <button id="selclr" class="btn ghost">Deselect</button>
        <span class="th"><kbd>Ctrl</kbd>+click selects an item</span>
        <button id="sellsel" class="btn danger" disabled>Sell selection</button>
      </div>
      <div id="inv"></div>
    </main>
    <footer class="bar">
      <button id="up" class="btn"${maxed || p.money < cost ? " disabled" : ""}>${maxed ? "Stash maxed" : `Upgrade stash (+${STASH_STEP} slots, $${cost})`}</button>
      <p id="msg" class="note">${esc(note)}</p>
      <button id="go" class="btn primary big">ENTER SERVER</button>
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
  const worth = (it: Item) => sellPrice(defs.get(it.type) ?? {}, it.qty);
  const refreshTools = () => {
    const list = stashSel();
    const btn = $("sellsel") as HTMLButtonElement;
    btn.disabled = !list.length;
    btn.textContent = list.length
      ? `Sell ${list.length} ($${list.reduce((t, i) => t + worth(i), 0)})`
      : "Sell selection";
    $("selmode").textContent = `Select: ${selMode ? "ON" : "OFF"}`;
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
        else msg("Cannot equip / no room");
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
    if (!it) return msg("You can only sell from the stash");
    const def = defs.get(it.type)!;
    if (
      !(await confirmBox({
        title: `Sell ${def.name}?`,
        text: `${def.name} x${it.qty} sells for $${sellPrice(def, it.qty)}. This cannot be undone.`,
        ok: "Sell",
        cancel: "Keep",
        danger: true,
      }))
    )
      return;
    if (await rpc("sell_item", { p_item_id: +it.id, p_qty: it.qty })) {
      stash.items = stash.items.filter((i) => i !== it);
      save();
      done("Sold.");
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
        if (fits(defs, stash, it, x, y)) {
          Object.assign(it, { x, y });
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
      bottom = Math.max(bottom, it.y + dims(d(it))[1]);
    }
    save();
    inv.render();
    msg("Stash sorted.");
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
        title: `Sell ${list.length} items?`,
        text: `You get $${total}. This cannot be undone.${rare ? ` Warning: ${rare} are epic / legendary.` : ""}`,
        ok: "Sell all",
        cancel: "Keep",
        danger: true,
      }))
    )
      return;
    ($("sellsel") as HTMLButtonElement).disabled = true;
    let n = 0, got = 0;
    for (const it of list) {
      msg(`Selling ${n + 1}/${list.length}...`);
      if (!(await rpc("sell_item", { p_item_id: +it.id, p_qty: it.qty }))) break;
      n++;
      got += worth(it);
    }
    done(n === list.length ? `Sold ${n} items, +$${got}.` : `Sold ${n} of ${list.length} (error: ${lastErr}).`);
  };
  refreshTools();

  $("up").onclick = async () => {
    if (maxed) return msg(`The stash is already at its maximum (${STASH_MAX}).`);
    if (p.money < cost) return msg(`Not enough money ($${cost}).`);
    const r = await rpc("upgrade_stash");
    if (r) done(`Stash expanded (+${STASH_STEP}), -$${cost}.`);
    else if (/not enough money/i.test(lastErr)) msg(`Not enough money ($${cost}).`);
  };
  $("go").onclick = async () => {
    const btn = $("go") as HTMLButtonElement;
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const ids = loadout().map((i) => +i.id);
      msg("Checking the server...");
      if ((await peekCount(SERVER)) >= MAX_PLAYERS)
        return msg(`The server is full (${MAX_PLAYERS}/${MAX_PLAYERS}).`);

      // Fiecare jucator are propriul raid pe server (validare extractie/moarte); serverul comun e canalul Broadcast.
      const raid = await rpc("create_raid");
      if (!raid) return;
      if (!(await rpc("join_raid", { p_raid_id: raid.data, p_item_ids: ids })))
        return;
      if (!(await rpc("start_raid", { p_raid_id: raid.data }))) return;
      raidBad = false;
      done("You are in the raid. Extraction opens after 60s.");
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