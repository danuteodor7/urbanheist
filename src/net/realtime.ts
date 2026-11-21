import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// ---- Limite Supabase Free: 100 mesaje/s PE PROIECT, numarate si la livrare (N jucatori => ~N^2 * rata) ----
export const SERVER = 'main';     // un singur server comun: canalul raid:main
export const MAX_PLAYERS = 15;
export const MSG_BUDGET = 70;      // mesaje/s tinta pentru toata sesiunea (sub plafonul de 100)
export const POS_MIN_MS = 100;     // cel mai rapid interval de trimitere a pozitiei
export const POS_MAX_MS = 5000;
export const HEARTBEAT_MS = 4000;  // jucator static: semnal de viata la fiecare 4s
export const STALE_MS = 12000;     // fara semnal 12s => jucator scos de pe harta

export type Loot = { item_type: string; quantity: number };
// x,y in pixeli; vx,vy in px/s (pentru extrapolare); n = username; hp = viata
export type PosMsg = { id: string; n: string; x: number; y: number; vx: number; vy: number; hp: number };
// dm = damage, sp = viteza, lf = durata (ms), n = numar de alice, sg = imprastiere, sd = seed (alicele sunt deterministe la toti clientii)
export type ShotMsg = { id: string; x: number; y: number; dx: number; dy: number; dm?: number; sp?: number; lf?: number; n?: number; sg?: number; sd?: number };
// did = id unic al drop-ului (acelasi jucator poate muri de mai multe ori)
export type DeadMsg = { id: string; x: number; y: number; loot: Loot[]; by: string | null; n?: string; did?: string };
export type LootedMsg = { k: string; taken: Loot[] };      // k = id container ('c12' sau 'd<did>')
// put = ai pus iteme intr-un container (sau langa un drop); drop = item aruncat pe jos (aceeasi forma ca DeadMsg, dar fara cadavru)
export type PutMsg = { k: string; added: Loot[] };
export type AlarmMsg = { x: number; y: number };
export type DoorMsg = { id: string };   // id-ul cladirii ale carei usi s-au deschis
// Masina: id = indexul din map.vehicles; a = unghi, v = viteza (px/s, cu semn), w = viteza unghiulara (rad/s), d = soferul ('' = parcata)
export type CarMsg = { id: number; x: number; y: number; a: number; v: number; w: number; d: string };
export type GoneMsg = { id: string };
export type HelloMsg = { id: string };
export type StateMsg = { to: string; e: number; containers: Record<string, Loot[]>; drops: DeadMsg[]; doors?: string[]; cars?: CarMsg[] };

export type Handlers = {
  pos: (m: PosMsg) => void;
  shot: (m: ShotMsg) => void;
  dead: (m: DeadMsg) => void;
  looted: (m: LootedMsg) => void;
  put: (m: PutMsg) => void;
  drop: (m: DeadMsg) => void;
  gone: (m: GoneMsg) => void;
  alarm: (m: AlarmMsg) => void;
  door: (m: DoorMsg) => void;
  car: (m: CarMsg) => void;
  hello: (m: HelloMsg) => void;
  state: (m: StateMsg) => void;
};

const opts = { config: { broadcast: { self: false, ack: false } } };

// Un canal Broadcast per sesiune: raid:<cod>. Fara Presence (limite mici pe Free), lista jucatorilor vine din mesajele 'pos'.
export class Net {
  private ch: RealtimeChannel;
  private me: string;
  private ready = false;

  constructor(code: string, me: string, h: Handlers) {
    this.me = me;
    this.ch = supabase.channel(`raid:${code}`, opts);
    const on = <T>(ev: string, fn: (p: T) => void) =>
      this.ch.on('broadcast', { event: ev }, ({ payload }) => fn(payload as T));
    on<PosMsg>('pos', h.pos);
    on<ShotMsg>('shot', h.shot);
    on<DeadMsg>('dead', h.dead);
    on<LootedMsg>('looted', h.looted);
    on<PutMsg>('put', h.put);
    on<DeadMsg>('drop', h.drop);
    on<GoneMsg>('gone', h.gone);
    on<AlarmMsg>('alarm', h.alarm);
    on<DoorMsg>('door', h.door);
    on<CarMsg>('car', h.car);
    on<HelloMsg>('hello', h.hello);
    on<StateMsg>('state', h.state);
    // raspuns la sondajul de capacitate (vezi peekCount)
    on<{ id: string }>('probe', (p) => { if (p.id !== this.me) void this.send('alive', { id: this.me, to: p.id }); });
  }

  join(): Promise<boolean> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 8000);   // nu ramanem agatati la infinit
      this.ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') { clearTimeout(t); this.ready = true; resolve(true); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { clearTimeout(t); this.ready = false; resolve(false); }
      });
    });
  }

  async send(event: string, payload: object): Promise<void> {
    if (!this.ready) return;
    try { await this.ch.send({ type: 'broadcast', event, payload }); } catch { /* retea: ignoram */ }
  }

  leave() { this.ready = false; void supabase.removeChannel(this.ch).catch(() => undefined); }
}

// Cati jucatori sunt deja intr-o sesiune? Trimite 'probe' si numara raspunsurile 'alive' timp de ~1.2s.
// Orice eroare de retea => 0 (nu blocam intrarea in joc din cauza sondajului).
export async function peekCount(code: string): Promise<number> {
  const me = 'peek-' + Math.random().toString(36).slice(2);
  const seen = new Set<string>();
  const ch = supabase.channel(`raid:${code}`, opts);
  try {
    ch.on('broadcast', { event: 'alive' }, ({ payload }) => {
      const p = payload as { id: string; to: string };
      if (p.to === me) seen.add(p.id);
    });
    const ok = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 5000);
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED') { clearTimeout(t); resolve(true); }
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') { clearTimeout(t); resolve(false); }
      });
    });
    if (ok) {
      await ch.send({ type: 'broadcast', event: 'probe', payload: { id: me } });
      await new Promise((r) => setTimeout(r, 1200));
    }
  } catch { /* retea: continuam */ }
  try { await supabase.removeChannel(ch); } catch { /* ignorat */ }
  return seen.size;
}