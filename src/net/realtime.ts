import { joinRoom } from 'trystero';
// Trystero 0.27: strategia implicita e Nostr (pentru alta: `npm i @trystero-p2p/torrent` si `import { joinRoom } from '@trystero-p2p/torrent'`).
// Semnalizarea e gratuita si nelimitata; datele merg direct intre jucatori (WebRTC).

// ---- Realtime P2P: nu mai exista limita de mesaje Supabase ----
// Supabase ramane doar pentru Auth / Postgres / RPC (hub, stash, magazin, extractie).
export const SERVER = 'main';
export const MAX_PLAYERS = 15;
export const MSG_BUDGET = 600;     // mesaje/s tinta (nu mai e plafon de server; plafonul real e upload-ul fiecarui jucator)
export const POS_MIN_MS = 100;
export const POS_MAX_MS = 5000;
export const HEARTBEAT_MS = 4000;
export const STALE_MS = 12000;

const APP_ID = 'urban-heist-v1';
const PEEK_MS = 3000;              // cat asteptam sa descoperim jucatorii in sondaj (P2P e mai lent decat un server)

export type Loot = { item_type: string; quantity: number };
export type PosMsg = { id: string; n: string; x: number; y: number; vx: number; vy: number; hp: number };
export type ShotMsg = { id: string; x: number; y: number; dx: number; dy: number; dm?: number; sp?: number; lf?: number; n?: number; sg?: number; sd?: number };
export type DeadMsg = { id: string; x: number; y: number; loot: Loot[]; by: string | null; n?: string; did?: string };
export type LootedMsg = { k: string; taken: Loot[] };
export type PutMsg = { k: string; added: Loot[] };
export type AlarmMsg = { x: number; y: number };
export type DoorMsg = { id: string };
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

// Numele actiunilor Trystero: maxim 12 octeti
const EVENTS: (keyof Handlers)[] = ['pos', 'shot', 'dead', 'looted', 'put', 'drop', 'gone', 'alarm', 'door', 'car', 'hello', 'state'];

// TURN optional (retele stricte: scoala / firma / NAT simetric). In .env.local:
//   VITE_TURN_URL=turn:host:3478,turns:host:443   VITE_TURN_USER=...   VITE_TURN_PASS=...
const TURN_URL = import.meta.env.VITE_TURN_URL as string | undefined;
const cfg = () => ({
  appId: APP_ID,
  identity: 'none' as const,   // id-uri aruncabile: nu folosim userId-ul Trystero (jocul are propriile id-uri), iar doua tab-uri din acelasi browser raman jucatori separati
  ...(TURN_URL
    ? { turnConfig: [{ urls: TURN_URL.split(','), username: import.meta.env.VITE_TURN_USER as string, credential: import.meta.env.VITE_TURN_PASS as string }] }
    : {}),
});

type Room = ReturnType<typeof joinRoom>;
type Act = { send: (data: any, opts?: { target?: string }) => Promise<unknown>; onMessage: (fn: (data: any, ctx: { peerId: string }) => void) => unknown };

// joinRoom arunca eroare daca aceeasi camera e inca activa: asteptam mereu leave() inainte de o noua intrare
let closing: Promise<unknown> = Promise.resolve();
const leaveRoom = (room: Room | null) => {
  if (!room) return;
  closing = Promise.resolve()
    .then(() => room.leave())
    .catch(() => undefined);
};

// O camera P2P per sesiune: raid:<cod>. Lista jucatorilor vine tot din mesajele 'pos'.
export class Net {
  private room: Room | null = null;
  private out = new Map<string, Act>();
  private peerUser = new Map<string, string>();   // peerId Trystero -> id-ul jucatorului (pentru `gone` instant la deconectare)
  private ready = false;
  private code: string;
  private me: string;
  private h: Handlers;

  constructor(code: string, me: string, h: Handlers) {
    this.code = code;
    this.me = me;
    this.h = h;
  }

  // Jucatorii apar pe masura ce se descopera (secunde). Intrarea tarzie e acoperita de hello/state.
  async join(): Promise<boolean> {
    try {
      await closing;
      const room = joinRoom(cfg(), `raid:${this.code}`);
      this.room = room;
      for (const ev of EVENTS) {
        const act = room.makeAction(ev) as unknown as Act;
        this.out.set(ev, act);
        act.onMessage((data: any, ctx) => {
          if ((ev === 'pos' || ev === 'hello') && typeof data?.id === 'string' && !data.id.startsWith('bot:')) this.peerUser.set(ctx.peerId, data.id);
          (this.h[ev] as (m: any) => void)(data);
        });
      }
      // peer nou conectat: ii spunem `hello` direct, ca sa ne trimita starea lumii (containere, usi, masini, drop-uri)
      room.onPeerJoin((ctx: { peerId: string }) => {
        void this.out.get('hello')?.send({ id: this.me }, { target: ctx.peerId }).catch(() => undefined);
      });
      room.onPeerLeave((ctx: { peerId: string }) => {
        const u = this.peerUser.get(ctx.peerId);
        this.peerUser.delete(ctx.peerId);
        if (u) this.h.gone({ id: u });
      });
      this.ready = true;
      return true;
    } catch {
      this.ready = false;
      return false;
    }
  }

  async send(event: string, payload: object): Promise<void> {
    if (!this.ready) return;
    try { await this.out.get(event)?.send(payload); } catch { /* retea: ignoram */ }
  }

  leave() {
    this.ready = false;
    leaveRoom(this.room);
    this.room = null;
  }
}

// Cati jucatori sunt deja intr-o sesiune? Intram in camera ~3s si numaram peer-ii descoperiti.
// Orice eroare => 0 (nu blocam intrarea in joc din cauza sondajului).
export async function peekCount(code: string): Promise<number> {
  let room: Room | null = null;
  try {
    await closing;
    room = joinRoom(cfg(), `raid:${code}`);
    await new Promise((r) => setTimeout(r, PEEK_MS));
    return Object.keys(room.getPeers()).length;
  } catch {
    return 0;
  } finally {
    leaveRoom(room);
    await closing;
  }
}