import { BASE_BAG, dims, spec, tip, type Def, type Item, type Slot } from '../game/items.ts';

// Un Box e fie un grid de celule (stash, rucsac, container), fie un slot de echipament (un singur item, `slot` = ce accepta)
export type Box = { id: string; title: string; w: number; h: number; items: Item[]; slot?: Slot; grow?: boolean; cap?: number; readonly?: boolean };   // cap = cate randuri se pot FOLOSI (stash: mai putine decat se vad, daca au ramas iteme peste limita)
export type Hooks = {
  defs: Map<string, Def>;
  hidden?: (b: Box, it: Item) => boolean;                        // container: item inca nerevelat
  onMove?: (it: Item, from: Box, to: Box | null) => boolean | 'eat';   // to = null: aruncat pe jos; false = refuz; 'eat' = itemul a fost combinat (stack) si dispare
  afterMove?: (it: Item, from: Box, to: Box | null) => void;     // dupa o mutare reusita (inclusiv refit): aici se fac efectele (retea, loot)
  ground?: boolean;                                              // true = tragerea in afara panourilor arunca itemul pe jos (doar in raid)
  onUse?: (it: Item, from: Box) => void;                         // clic dreapta
  onChange?: () => void;
  refit?: () => string | null;                                   // dupa o mutare: redimensioneaza rucsacul; mesaj de eroare = mutarea se anuleaza
  onDeny?: (msg: string) => void;
  pick?: (it: Item, from: Box, e: PointerEvent) => boolean;      // true = click consumat (selectie multipla), fara drag
  selected?: (it: Item) => boolean;                              // itemul e in selectie (clasa .sel)
};

export const C = 38;   // px per celula

export const mkBoxes = () => ({
  bag: { id: 'bag', title: 'Inventar', w: BASE_BAG.w, h: BASE_BAG.h, items: [] } as Box,
  back: { id: 'back', title: 'Rucsac', w: 4, h: 4, slot: 'back', items: [] } as Box,
  head: { id: 'head', title: 'Casca', w: 2, h: 2, slot: 'head', items: [] } as Box,
  body: { id: 'body', title: 'Vesta', w: 4, h: 4, slot: 'body', items: [] } as Box,
  weapon: { id: 'weapon', title: 'Arma', w: 6, h: 2, slot: 'weapon', items: [] } as Box,
});

const size = (defs: Map<string, Def>, it: Item, r = it.r) => dims(defs.get(it.type)!, r);

// Incape itemul in `b` la (x,y)? Itemul insusi nu conteaza ca obstacol (mutare in acelasi grid)
export function fits(defs: Map<string, Def>, b: Box, it: Item, x: number, y: number, r: boolean): boolean {
  if (b.slot) return spec(it.type)?.slot === b.slot && b.items.every((o) => o === it);
  const [w, h] = dims(defs.get(it.type)!, r);
  if (x < 0 || y < 0 || x + w > b.w || (!b.grow && y + h > (b.cap ?? b.h))) return false;
  return b.items.every((o) => {
    if (o === it) return true;
    const [ow, oh] = size(defs, o);
    return x + w <= o.x || o.x + ow <= x || y + h <= o.y || o.y + oh <= y;
  });
}

// Primul loc liber (normal, apoi rotit); itemul trebuie sa nu fie deja in `b`
export function autoPlace(defs: Map<string, Def>, b: Box, it: Item): boolean {
  const rows = b.slot ? 1 : b.grow ? 400 : (b.cap ?? b.h);
  for (let y = 0; y < rows; y++) for (let x = 0; x < (b.slot ? 1 : b.w); x++) for (const r of [false, true]) {
    if (!fits(defs, b, it, x, y, r)) continue;
    Object.assign(it, b.slot ? { x: 0, y: 0, r: false } : { x, y, r });
    b.items.push(it);
    return true;
  }
  return false;
}

// ---- rucsac: gridul de inventar isi schimba dimensiunea dupa rucsacul echipat ----
export const packSize = (back?: Box) => (back?.items[0] && spec(back.items[0].type)?.pack) || BASE_BAG;

// Pune gridul `b` la dimensiunea w x h; itemele raman pe loc daca incap, altfel se reaseaza automat. false = nu incap.
function fitBag(defs: Map<string, Def>, b: Box, w: number, h: number): boolean {
  if (b.items.every((it) => { const [iw, ih] = size(defs, it); return it.x + iw <= w && (b.grow || it.y + ih <= h); })) { b.w = w; b.h = h; return true; }
  const tmp: Box = { ...b, w, h, items: [] };
  const saved = b.items.map((it) => ({ it, x: it.x, y: it.y, r: it.r }));
  const area = (it: Item) => { const [iw, ih] = size(defs, it); return iw * ih; };
  for (const it of [...b.items].sort((a, c) => area(c) - area(a))) {
    if (!autoPlace(defs, tmp, it)) { for (const s of saved) Object.assign(s.it, { x: s.x, y: s.y, r: s.r }); return false; }
  }
  b.items = tmp.items;
  b.w = w; b.h = h;
  return true;
}

export function refit(defs: Map<string, Def>, bag: Box, back: Box): string | null {
  const p = packSize(back);
  return fitBag(defs, bag, p.w, p.h) ? null : 'Inventarul ar ramane fara loc: fa loc inainte sa schimbi rucsacul';
}

type Snap = { b: Box; items: Item[]; w: number; h: number; pos: { it: Item; x: number; y: number; r: boolean; qty: number }[] }[];
export const snap = (boxes: Box[]): Snap => [...new Set(boxes)].map((b) => ({ b, items: [...b.items], w: b.w, h: b.h, pos: b.items.map((it) => ({ it, x: it.x, y: it.y, r: it.r, qty: it.qty })) }));
export const restore = (s: Snap) => s.forEach(({ b, items, w, h, pos }) => { b.items = items; b.w = w; b.h = h; pos.forEach((p) => Object.assign(p.it, { x: p.x, y: p.y, r: p.r, qty: p.qty })); });

// ---- pozitiile itemelor se tin local (baza de date nu stie de grid) ----
type Layout = Record<string, { c: string; x: number; y: number; r: boolean }>;
const LK = (uid: string) => `uh:layout:${uid}`;
export function loadLayout(uid: string): Layout {
  try { return JSON.parse(localStorage.getItem(LK(uid)) ?? '{}'); } catch { return {}; }
}
const store = (uid: string, l: Layout) => { try { localStorage.setItem(LK(uid), JSON.stringify(l)); } catch { /* ignorat */ } };
export function saveLayout(uid: string, boxes: Box[]) {
  const l: Layout = {};
  for (const b of boxes) for (const it of b.items) l[it.id] = { c: b.id, x: it.x, y: it.y, r: it.r };
  store(uid, l);
}
// Dupa raid itemele ajung in stash: uitam loadout-ul
export function clearLoadout(uid: string) {
  const l = loadLayout(uid);
  for (const k of Object.keys(l)) if (l[k].c !== 'stash') delete l[k];
  store(uid, l);
}
// Item care nu mai incape in grila: sta sub ea, vizibil, pana il muti / vinzi. Gridul ramane fix: in randurile de sub `cap` nu se poate pune nimic nou.
export function placeOverflow(defs: Map<string, Def>, b: Box, it: Item): boolean {
  const cap = b.cap ?? b.h, grow = b.grow;
  b.cap = undefined; b.grow = true;
  const ok = autoPlace(defs, b, it);
  b.grow = grow; b.cap = cap;
  if (ok) b.h = Math.max(b.h, it.y + size(defs, it)[1]);
  return ok;
}
// Pune fiecare item in cutia salvata; ce nu mai incape sau nu are pozitie merge in `fallback`
export function distribute(defs: Map<string, Def>, uid: string, items: Item[], boxes: Box[], fallback: Box, after?: () => void) {
  const l = loadLayout(uid);
  // rucsacurile primele: dupa ce sunt echipate, gridul creste si restul itemelor isi gasesc locul
  const first = (it: Item) => (spec(it.type)?.slot === 'back' ? 0 : 1);
  for (const it of [...items].sort((a, b) => first(a) - first(b))) {
    const s = l[it.id], b = s && boxes.find((x) => x.id === s.c);
    if (b && fits(defs, b, it, s.x, s.y, s.r)) { Object.assign(it, { x: s.x, y: s.y, r: s.r }); b.items.push(it); after?.(); continue; }
    if (!autoPlace(defs, fallback, it)) placeOverflow(defs, fallback, it);   // nu pierdem iteme din vedere, dar gridul nu creste
    after?.();
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Panoul de echipament: pozitii in pixeli, calculate ca slot-urile sa nu se suprapuna niciodata
// (casca 2x2 + vesta 3x3 in stanga, rucsac 4x4 in dreapta, arma 6x2 jos; +2 px de bordura la fiecare)
const EQ_W = 320, EQ_H = 332;
const SLOT_POS: Record<string, string> = Object.fromEntries(
  Object.entries({ head: [38, 0], body: [0, 88], back: [164, 0], weapon: [45, 252] }).map(([k, [l, t]]) => [k, `left:${l}px;top:${t}px`]),
);

// Iconite simple (24x24) dupa tipul itemului; culoarea vine din raritate (currentColor)
const ICONS: Record<string, string> = {
  gun: '<path d="M2 8h14l2 1.5h4V13h-6l-1 5h-4l1-5H8l-1 3.5H3.5L5 13H2z"/>',
  head: '<path d="M4 15a8 8 0 0 1 16 0v2H4zM6 18.5h12V20H6z"/>',
  body: '<path d="M7 3l3 2h4l3-2 4 3-2.5 4.5V21h-11V10.5L3 6z"/>',
  back: '<path fill-rule="evenodd" d="M9 3h6l1 3h3v15H5V6h3zM9 13h6v5H9z"/>',
  heal: '<path d="M9.5 3h5v6.5H21v5h-6.5V21h-5v-6.5H3v-5h6.5z"/>',
  ammo: '<path d="M4 21V11l2.2-3L8.4 11v10zM10.8 21V9l2.2-3.5L15.2 9v12zM17.6 21V12l2.2-3 2.2 3v9z"/>',
  key: '<circle cx="7.5" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M11.5 12H22m-3 0v4m-3.5-4v3" fill="none" stroke="currentColor" stroke-width="2.6"/>',
  box: '<path d="M12 2.5l9 4.5v10l-9 4.5-9-4.5V7z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 7l9 4.5L21 7M12 11.5v10" fill="none" stroke="currentColor" stroke-width="2"/>',
};
const iconOf = (d: Def) => {
  const s = spec(d.item_type);
  const k = s?.gun ? 'gun' : s?.slot ?? (s?.heal ? 'heal' : s?.door ? 'key' : d.item_type.startsWith('ammo_') ? 'ammo' : 'box');
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[k] ?? ICONS.box}</svg>`;
};
export const iconSvg = iconOf;

// Tooltip propriu (inlocuieste atributul title): titlu colorat dupa raritate, apoi liniile din tip()
export function tipHtml(d: Def, qty: number): string {
  const [name, meta, ...rest] = tip(d, qty).split('\n');
  return `<b class="tn r-${d.rarity}">${esc(name)}</b><em>${esc(meta)}</em>${rest.map((l) => `<span>${esc(l)}</span>`).join('')}`;
}
let tipEl: HTMLDivElement | null = null;
export function showTip(html: string, x: number, y: number) {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
  tipEl.innerHTML = html;
  tipEl.style.display = 'block';
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  tipEl.style.left = `${Math.min(x + 16, window.innerWidth - w - 8)}px`;
  tipEl.style.top = `${Math.min(y + 16, window.innerHeight - h - 8)}px`;
}
export const hideTip = () => { if (tipEl) tipEl.style.display = 'none'; };



type Drag = { it: Item; from: Box; r: boolean; el: HTMLElement; hl: HTMLElement; dx: number; dy: number; over: { b: Box; x: number; y: number } | null; out: boolean };

export function mountInventory(root: HTMLElement, left: Box | null, slots: Box[], bag: Box, hooks: Hooks) {
  const { defs } = hooks;
  const boxes = [...(left ? [left] : []), ...slots, bag];
  let drag: Drag | null = null;
  let last: PointerEvent | null = null;
  let zone: HTMLDivElement | null = null;   // banner "arunca pe jos" cat timp tragi un item

  const itemHtml = (b: Box, it: Item) => {
    const def = defs.get(it.type)!;
    const [w, h] = dims(def, it.r);
    const hid = hooks.hidden?.(b, it);
    const x = b.slot ? ((b.w - w) * C) / 2 : it.x * C, y = b.slot ? ((b.h - h) * C) / 2 : it.y * C;
    const named = w * h >= 3 || (w >= 2 && h >= 1 && w * h >= 2);
    // itemele nedeblocate nu poarta clasa de raritate: sunt gri, ca sa nu dea de gol ce sunt
    return `<div class="it ${hid ? 'hid' : `r-${def.rarity}`}${hooks.selected?.(it) ? ' sel' : ''}" data-it="${esc(it.id)}" data-box="${b.id}" style="left:${x}px;top:${y}px;width:${w * C}px;height:${h * C}px">
      ${hid ? '<span class="q">?</span><i class="pg"></i>' : `${iconOf(def)}${named ? `<span class="nm">${esc(def.name)}</span>` : ''}${it.qty > 1 ? `<b>${it.qty}</b>` : ''}`}</div>`;
  };
  const boxHtml = (b: Box) => {
    // grila cu `grow` (container, sau stash-ul cand are iteme peste capacitate) se mareste exact cat are nevoie, fara rand in plus
    if (b.grow) b.h = Math.max(b.h, ...b.items.map((it) => it.y + size(defs, it)[1]));
    const empty = b.slot && !b.items.length ? `<i>${esc(b.title)}${b.slot === 'weapon' ? '<br>(pistol implicit)' : ''}</i>` : '';
    return `<div class="box${b.slot ? ' slot' : ''}" data-box="${b.id}" style="width:${b.w * C}px;height:${b.h * C}px${b.slot ? ';' + SLOT_POS[b.slot] : ''}">${b.items.map((it) => itemHtml(b, it)).join('')}${empty}</div>`;
  };

  const render = () => {
    // pastram scroll-ul paginii si al gridului: innerHTML prabuseste inaltimea si altfel pagina sare sus la fiecare mutare
    const sy = window.scrollY, sx = window.scrollX;
    const sc0 = root.querySelector<HTMLElement>('.sc')?.scrollTop ?? 0;
    if (root.offsetHeight) root.style.minHeight = `${root.offsetHeight}px`;
    root.innerHTML = `<div class="inv">
      ${left ? `<div class="pn"><h4>${esc(left.title)}</h4><div class="sc">${boxHtml(left)}</div></div>` : ''}
      <div class="pn"><h4>Echipament</h4><div class="ch" style="width:${EQ_W}px;height:${EQ_H}px">
        ${slots.map(boxHtml).join('')}</div></div>
      <div class="pn"><h4>${esc(bag.title)}</h4>${boxHtml(bag)}</div></div>`;
    const sc = root.querySelector<HTMLElement>('.sc');
    if (sc) sc.scrollTop = sc0;
    window.scrollTo(sx, sy);
    root.style.minHeight = '';
  };

  const sizeGhost = (d: Drag) => {
    const [w, h] = dims(defs.get(d.it.type)!, d.r);
    d.el.style.width = `${w * C}px`;
    d.el.style.height = `${h * C}px`;
  };

  const move = (e: PointerEvent) => {
    const d = drag!;
    last = e;
    d.el.style.left = `${e.clientX - d.dx}px`;
    d.el.style.top = `${e.clientY - d.dy}px`;
    d.hl.remove();
    d.over = null;
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    d.out = !!hooks.ground && !stack.some((n) => n.classList.contains('pn'));   // in afara oricarui panou = pe jos
    d.el.classList.toggle('tossing', d.out);
    zone?.classList.toggle('hot', d.out);
    const hit = stack.find((n) => n.classList.contains('box')) as HTMLElement | undefined;
    const b = hit && boxes.find((x) => x.id === hit.dataset.box);
    if (!hit || !b) return;
    const r0 = hit.getBoundingClientRect();
    const x = Math.round((e.clientX - d.dx - r0.left) / C), y = Math.round((e.clientY - d.dy - r0.top) / C);
    const ok = fits(defs, b, d.it, x, y, d.r) && (!b.readonly || b === d.from);
    const [w, h] = dims(defs.get(d.it.type)!, d.r);
    d.hl.className = `hl ${ok ? 'ok' : 'no'}`;
    d.hl.style.cssText = b.slot ? `left:0;top:0;width:${b.w * C}px;height:${b.h * C}px` : `left:${x * C}px;top:${y * C}px;width:${w * C}px;height:${h * C}px`;
    hit.appendChild(d.hl);
    if (ok) d.over = { b, x, y };
  };

  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    drag?.el.remove();
    drag?.hl.remove();
    zone?.remove();
    zone = null;
    drag = null;
  };

  function up() {
    const d = drag!;
    const o = d.over, out = d.out;
    stop();
    // Mutare reusita = intai refit (rucsacul se poate micsora), abia apoi efectele (retea, loot): altfel un refuz ar lasa urme
    const commit = (to: Box | null, place: () => void) => {
      const before = snap(boxes);
      const res = !to || to === d.from ? true : hooks.onMove?.(d.it, d.from, to) ?? true;
      if (res === false) return;
      d.from.items = d.from.items.filter((i) => i !== d.it);
      if (res === true) place();
      const err = hooks.refit?.() ?? null;   // rucsac echipat / scos => gridul de inventar se redimensioneaza
      if (err) { restore(before); hooks.onDeny?.(err); return; }
      if (to !== d.from) hooks.afterMove?.(d.it, d.from, to);
      hooks.onChange?.();
    };
    if (o) {
      commit(o.b, () => {
        Object.assign(d.it, o.b.slot ? { x: 0, y: 0, r: false } : { x: o.x, y: o.y, r: d.r });
        o.b.items.push(d.it);
      });
    } else if (out) {
      if (hooks.onMove?.(d.it, d.from, null) !== false) commit(null, () => undefined);
    }
    render();
  }

  const find = (el: HTMLElement) => {
    const from = boxes.find((x) => x.id === el.dataset.box)!;
    return { from, it: from.items.find((i) => i.id === el.dataset.it)! };
  };

  root.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.it');
    if (!el || e.button !== 0 || el.classList.contains('hid')) return;
    const { from, it } = find(el);
    if (hooks.pick?.(it, from, e)) { e.preventDefault(); return; }
    const rect = el.getBoundingClientRect();
    const tmp = document.createElement('div');
    tmp.innerHTML = itemHtml(from, it);
    const ghost = tmp.firstElementChild as HTMLElement;
    ghost.classList.add('dragghost');
    document.body.appendChild(ghost);
    el.style.opacity = '.3';
    drag = { it, from, r: it.r, el: ghost, hl: document.createElement('div'), dx: e.clientX - rect.left, dy: e.clientY - rect.top, over: null, out: false };
    hideTip();
    if (hooks.ground) {
      zone = document.createElement('div');
      zone.className = 'throwzone';
      zone.innerHTML = '<b>Arunca pe jos</b><span>elibereaza in afara panourilor</span>';
      document.body.appendChild(zone);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    move(e);
  });

  root.addEventListener('contextmenu', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.it');
    if (!el || el.classList.contains('hid')) return;
    e.preventDefault();
    const { from, it } = find(el);
    hooks.onUse?.(it, from);
    render();
  });

  root.addEventListener('mousemove', (e) => {
    const el = drag ? null : (e.target as HTMLElement).closest<HTMLElement>('.it');
    if (!el || el.classList.contains('hid')) return hideTip();
    const { it } = find(el);
    showTip(tipHtml(defs.get(it.type)!, it.qty), e.clientX, e.clientY);
  });
  root.addEventListener('mouseleave', hideTip);

  // R = roteste itemul tinut in mana
  const onKey = (e: KeyboardEvent) => {
    if (!drag || e.key.toLowerCase() !== 'r') return;
    drag.r = !drag.r;
    sizeGhost(drag);
    if (last) move(last);
  };
  window.addEventListener('keydown', onKey);

  render();
  return {
    render,
    destroy() { stop(); hideTip(); window.removeEventListener('keydown', onKey); root.innerHTML = ''; },
  };
}

// Clic dreapta: item cu slot => se echipeaza (cel vechi ia locul itemului sau merge in `fallback`); item echipat => inapoi in `fallback`
export function quickEquip(defs: Map<string, Def>, it: Item, from: Box, slots: Record<string, Box>, fallback: Box): boolean {
  const before = snap([from, fallback, ...Object.values(slots)]);
  if (!quickEquip0(defs, it, from, slots, fallback)) return false;
  if (slots.back && refit(defs, fallback, slots.back)) { restore(before); return false; }
  return true;
}

function quickEquip0(defs: Map<string, Def>, it: Item, from: Box, slots: Record<string, Box>, fallback: Box): boolean {
  const old = { x: it.x, y: it.y, r: it.r };
  if (from.slot) {
    from.items = from.items.filter((i) => i !== it);
    if (autoPlace(defs, fallback, it)) return true;
    from.items.push(it);
    return false;
  }
  const s = spec(it.type)?.slot, to = s && slots[s];
  if (!to) return false;
  const prev = to.items[0];
  from.items = from.items.filter((i) => i !== it);
  to.items = [];
  Object.assign(it, { x: 0, y: 0, r: false });
  to.items.push(it);
  if (prev && !autoPlace(defs, from, prev) && !autoPlace(defs, fallback, prev)) {   // nu are unde pleca: anulam
    to.items = [prev];
    from.items.push(it);
    Object.assign(it, old);
    return false;
  }
  return true;
}