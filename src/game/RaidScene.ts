import Phaser from "phaser";
import { supabase } from "../lib/supabase";
import {
  TILE,
  W,
  H,
  zoneAt,
  generateMap,
  rerollLoot,
  epochNow,
  rollItems,
  blocksView,
  rngFrom,
  SHOP_INFO,
  type Container,
  type GameMap,
  type ItemDef,
  type Loot,
  type Lock,
  type Shop,
  type ShopKind,
} from "./map";
import { makeTextures } from "./art";
import {
  PISTOL,
  spec,
  tip,
  registerDefs,
  type Def,
  type Item,
  type Gun,
  BUY_MULT,
  stackMax,
} from "./items.ts";
import {
  mkBoxes,
  mountInventory,
  autoPlace,
  distribute,
  quickEquip,
  refit,
  iconSvg,
  snap,
  restore,
  type Box,
  type Hooks,
} from "../ui/inventory";
import { confirmBox } from "../ui/modal.ts";
import {
  Net,
  MSG_BUDGET,
  POS_MIN_MS,
  HEARTBEAT_MS,
  STALE_MS,
  type PosMsg,
  type ShotMsg,
  type DeadMsg,
  type LootedMsg,
  type StateMsg,
  type AlarmMsg,
  type DoorMsg,
  type CarMsg,
  type PutMsg,
} from "../net/realtime";

const SPEED = 170;
const REACH = 44; // distanta maxima pana la container / usa (px)
const EXTRACT_MS = 5000; // cat stai in zona verde ca sa extragi
const REVEAL_MS = 1000; // cat dureaza deblocarea fiecarui item din container (la fel pentru toate)
// Limite oglindite din extract_player (limitele pe numar de iteme / raritate au fost scoase din SQL)
const MAX_XP = 2000,
  MAX_STACK = 50;

// Combat: armele reale vin din items.ts; astea sunt doar valorile implicite ale gloantelor (boti, mesaje fara camp)
const HP_MAX = 100,
  DAMAGE = 20;
const BULLET_SPEED = 520,
  BULLET_LIFE_MS = 1100,
  HIT_R = 14; // raza de lovire (era 12): tinta mai usor de nimerit
// Ajutor la tintire: daca cursorul e la mai putin de ASSIST_R px de un inamic vizibil, glontul se curbeaza spre el
const ASSIST_R = 36,
  ASSIST_MAX = 0.85;
// Distanta de la punctul (px,py) la segmentul (ax,ay)-(bx,by): gloantele rapide nu mai "sar" peste tinte intre doua frame-uri
const segDist = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) => {
  const dx = bx - ax,
    dy = by - ay,
    l = dx * dx + dy * dy;
  const t = l
    ? Phaser.Math.Clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1)
    : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const SPAWN_PROTECT_MS = 3000;
const CORPSE_MS = 60000; // cat sta cadavrul pe jos
const MAX_DECALS = 350; // pete de sange simultane (cele vechi dispar)

// Masini
const CAR_MAX = 330,
  CAR_ACC = 240,
  CAR_BRAKE = 500,
  CAR_DRAG = 140,
  CAR_REV = 110,
  CAR_TURN = 2.3,
  STEAL_MS = 1500;

// Boti (simulati doar de host): valori provizorii
const BOT_COUNT = 8,
  BOT_SPEED = 110,
  BOT_SIGHT = 380,
  BOT_KEEP = 140,
  BOT_FIRE_MS = 900,
  BOT_RESPAWN_MS = 30000,
  ALARM_R = 800;

// Vizibilitate: con spre tinta (mouse) + cerc mic in jurul jucatorului; peretii, copacii, lazile si usile incuiate blocheaza vederea
const FOV = (110 * Math.PI) / 180,
  RANGE = 420,
  NEAR = 90,
  RAYS = 180,
  FOG_R = 1800,
  FOG_ALPHA = 0.45;
const STEP = (Math.PI * 2) / RAYS;
const DIRS = Array.from({ length: RAYS }, (_, i) => ({
  a: i * STEP - Math.PI,
  c: Math.cos(i * STEP - Math.PI),
  s: Math.sin(i * STEP - Math.PI),
}));

const MS = 2; // minimap: px per tile
// Magazine: pretul de cumparare = pretul de vanzare (base_value) x BUY_MULT; fara base_value se foloseste pretul pe raritate
const FALLBACK_PRICE: Record<string, number> = {
  common: 40,
  uncommon: 100,
  rare: 250,
  epic: 700,
  legendary: 2000,
};
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const XP: Record<string, number> = {
  common: 5,
  uncommon: 10,
  rare: 25,
  epic: 60,
  legendary: 150,
};
const mid = (t: number) => t * TILE + TILE / 2;
const LOCK_TINT: Record<string, number> = {
  Warehouse: 0xffb74d,
  Bank: 0x64b5f6,
  House: 0x81c784,
  Shop: 0xba68c8,
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// RPC cu reincercari la erori de retea ("fetch failed"); erorile logice (ex. "not in raid") se intorc imediat
async function rpcRetry(
  fn: string,
  args: object,
  tries = 4,
): Promise<{ data: any; error: { message: string } | null }> {
  let res: { data: any; error: { message: string } | null } = {
    data: null,
    error: { message: "necunoscut" },
  };
  for (let i = 0; i < tries; i++) {
    try {
      res = (await supabase.rpc(fn, args)) as any;
    } catch (e) {
      res = {
        data: null,
        error: { message: String((e as Error)?.message ?? e) },
      };
    }
    if (
      !res.error ||
      !/fetch|network|timeout|timed out|failed to|load failed|abort/i.test(
        res.error.message,
      )
    )
      return res;
    await wait(700 * (i + 1));
  }
  return res;
}

type Keys = Record<
  "W" | "A" | "S" | "D" | "E" | "Q" | "H" | "R",
  Phaser.Input.Keyboard.Key
>;
type Init = {
  raidId: string; // raidul de pe server (validare extract/die)
  code: string; // codul sesiunii: seed-ul hartii + canalul Broadcast
  me: { id: string; name: string };
  defs: Map<string, ItemDef>;
  money: number; // banii din cont (se cheltuie in magazine prin RPC spend_money)
  brought: { id: number; item_type: string; quantity: number }[]; // iteme aduse la risc (randuri din stash_items)
  parent: HTMLElement;
  end: (note: string, failed?: boolean) => void;
};
type Remote = {
  g: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  n: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  t: number; // snapshot + moment primire
  dx: number;
  dy: number; // pozitia afisata (neteda)
};
type Bullet = {
  g: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  owner: string;
  dm: number;
};
type Corpse = {
  g: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  until: number;
  x: number;
  y: number;
};
type Car = {
  id: number;
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  a: number;
  v: number;
  w: number;
  d: string;
  t: number; // ultima stare primita
  dx: number;
  dy: number;
  da: number; // starea afisata (neteda)
  moved: boolean;
};

const isBot = (id: string) => id.startsWith("bot:");
type Bot = {
  id: string;
  x: number;
  y: number;
  hp: number;
  dir: { x: number; y: number };
  turn: number;
  shot: number;
  go: { x: number; y: number; until: number } | null; // tinta alarmei
  last: { vx: number; vy: number; t: number }; // ultimul `pos` trimis
};

class RaidScene extends Phaser.Scene {
  private cfg!: Init;
  private map!: GameMap;
  private player!: Phaser.GameObjects.Image;
  private keys!: Keys;
  private arrows!: Phaser.Types.Input.Keyboard.CursorKeys;
  private vig!: Phaser.GameObjects.Image;
  private miniBg!: Phaser.GameObjects.Graphics;
  private bar!: Phaser.GameObjects.Graphics;
  private hud!: Record<
    "root" | "wpn" | "mag" | "res" | "hp" | "hpt" | "arm" | "money" | "toasts",
    HTMLElement
  >; // HUD HTML (deasupra canvas-ului)
  private modal = false; // un pop-up (confirmBox) e deschis: jocul ignora tastele / focul
  private mini!: Phaser.GameObjects.Graphics;
  private epoch = 0; // epoch-ul de loot curent (vezi RESET_MS)
  private baseCount = 0; // containerele hartii (restul sunt drop-uri)
  private nextCheck = 0;
  private bots = new Map<string, Bot>(); // doar la host
  private hostSeen = ""; // id-ul jucatorului-host (cel mai mic id)
  private botSeq = 0;
  private boxes = new Map<Container, Phaser.GameObjects.Image>();
  private byId = new Map<string, Container>();
  private ids = new Map<Container, string>();
  private touched = new Set<string>(); // containere modificate (pentru jucatorii care intra tarziu)
  private drops = new Map<string, DeadMsg>(); // loot lasat de jucatori morti
  private wallSet = new Set<number>();
  private viewSet = new Set<number>(); // pereti care blocheaza vederea
  private fog!: Phaser.GameObjects.Graphics;
  private reach = new Float32Array(RAYS); // cat de departe vede jucatorul pe fiecare raza
  private seen = new Set<Container>(); // containere vazute cel putin o data (raman afisate)
  private zones: Phaser.Geom.Rectangle[] = [];
  private xp = 0;
  private hp = HP_MAX;
  private extractMs = 0;
  private blockedUntil = 0;
  private busy = false;
  private dying = false;
  private lastHud = "";
  private money = 0;
  private shop: { s: Shop; el: HTMLDivElement } | null = null;
  private buying = false;
  private shopLabels: { s: Shop; label: Phaser.GameObjects.Text }[] = [];
  private shopSeen = new Set<Shop>();
  private waterSet = new Set<number>(); // apa: blocheaza miscarea, nu si gloantele
  private net!: Net;
  private remotes = new Map<string, Remote>();
  private bullets: Bullet[] = [];
  private lastShot = 0;
  private protectedUntil = 0;
  private last = { vx: 0, vy: 0, t: 0 };

  // ---- masini ----
  private cars: Car[] = [];
  private driving: Car | null = null;
  private carV = 0;
  private lastCar = { v: 0, w: 0, t: 0 };
  private stealing: { c: Car; t0: number } | null = null;
  private carHitAt = 0;

  // ---- gloante / reload / camera sniper ----
  private mag = new Map<string, number>(); // id arma (sau 'pistol') -> gloante in incarcator
  private reloading: { t0: number; ms: number; key: string } | null = null;
  private lead = { x: 0, y: 0 }; // decalajul camerei (sniper)

  // ---- inventar ----
  private B = mkBoxes(); // rucsac + 3 sloturi de echipament
  private hooks!: Hooks;
  private inv: ReturnType<typeof mountInventory> | null = null;
  private ov: HTMLDivElement | null = null;
  private ovStatus: HTMLElement | null = null;
  private chest: Box | null = null; // gridul containerului deschis
  private chestC: Container | null = null;
  private lootOf = new Map<string, Loot>(); // id item din grid -> loot-ul din container
  private revealed = new WeakSet<Loot>(); // iteme deja deblocate (reveal)
  private reveal: { loot: Loot; t0: number; ms: number } | null = null;
  private fseq = 0;
  private healing: { it: Item; t0: number; ms: number; hp: number } | null =
    null;
  private onKey = (e: KeyboardEvent) => {
    if (this.busy || e.repeat) return;
    if (e.key === "Tab" || e.key.toLowerCase() === "i") {
      e.preventDefault();
      if (this.inv) this.closeInv();
      else this.openInv(null);
    } else if (e.key === "Escape") {
      if (this.inv) this.closeInv();
      else if (this.shop) this.closeShop();
    }
  };

  // ---- usi, sange, cadavre ----
  private lockObjs: {
    l: Lock;
    img: Phaser.GameObjects.Image;
    open: boolean;
  }[] = [];
  private opened = new Set<string>();
  private decals: Phaser.GameObjects.Image[] = [];
  private corpses: Corpse[] = [];

  constructor() {
    super("raid");
  }

  init(cfg: Init) {
    this.cfg = cfg;
  }

  private get defs() {
    return this.cfg.defs as Map<string, Def>;
  }

  create() {
    const { code, defs, brought, me } = this.cfg;
    this.money = this.cfg.money;
    makeTextures(this);
    this.map = generateMap(code, [...defs.values()]); // code e fix => aceeasi harta mereu; doar loot-ul se schimba
    this.baseCount = this.map.containers.length;
    this.epoch = epochNow();
    rerollLoot(this.map, this.epoch, [...defs.values()]);

    // itemele aduse: pozitiile alese in hub (localStorage), ce nu incape merge in rucsac
    const B = this.B;
    distribute(
      this.defs,
      me.id,
      brought.map((b) => ({
        id: String(b.id),
        type: b.item_type,
        qty: b.quantity,
        x: 0,
        y: 0,
      })),
      [B.bag, B.head, B.body, B.weapon, B.back],
      B.bag,
      () => refit(this.defs, B.bag, B.back),
    );
    this.hooks = {
      defs: this.defs,
      ground: true,
      hidden: (b, it) =>
        b === this.chest && !this.revealed.has(this.lootOf.get(it.id)!),
      onMove: (it, from, to) => {
        if (from !== this.chest) return true; // bag -> container / sloturi / jos: permis
        if (!to) {
          this.say("Container items go to your inventory, they can't be thrown");
          return false;
        }
        if (to === this.chest) return true;
        const err = this.checkTake(it);
        if (err) {
          this.say(err);
          return false;
        }
        return this.commitTake(it) ? "eat" : true;
      },
      afterMove: (it, from, to) => {
        if (!to) this.throwItem(it);
        else if (to === this.chest && from !== this.chest) this.commitPut(it);
      },
      onUse: (it, from) => this.useItem(it, from),
      refit: () => refit(this.defs, B.bag, B.back),
      onDeny: (m) => this.say(m),
    };

    for (const [x, y, k] of this.map.walls) {
      this.wallSet.add(y * 1000 + x);
      if (blocksView(k)) this.viewSet.add(y * 1000 + x);
      if (k === "water") this.waterSet.add(y * 1000 + x);
    }

    const tile = (x: number, y: number, key: string) =>
      this.add.image(x * TILE, y * TILE, key).setOrigin(0);
    // Asfaltul se deseneaza doar unde nu exista alt teren care sa-l acopere (marcajele sunt transparente)
    const OVERLAY = new Set(["road_h", "road_v", "cross_h", "cross_v"]);
    const covered = new Set<number>();
    for (const [x, y, k] of this.map.ground)
      if (!OVERLAY.has(k)) covered.add(y * 1000 + x);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (!covered.has(y * 1000 + x))
          tile(x, y, `t_road_${(x * 31 + y * 17) % 3}`);
    for (const [x, y, k] of this.map.ground) tile(x, y, `g_${k}`);
    for (const r of this.map.extract) {
      const z = new Phaser.Geom.Rectangle(
        r.x * TILE,
        r.y * TILE,
        r.w * TILE,
        r.h * TILE,
      );
      this.zones.push(z);
      const e = this.add
        .tileSprite(z.x, z.y, z.width, z.height, "extract")
        .setOrigin(0)
        .setDepth(1);
      this.tweens.add({
        targets: e,
        alpha: 0.45,
        duration: 900,
        yoyo: true,
        repeat: -1,
      });
    }

    const walls = this.physics.add.staticGroup();
    for (const [x, y, k = "wall"] of this.map.walls) {
      const img = this.add
        .image(
          mid(x),
          mid(y),
          k === "car" ? `w_car${(x * 7 + y * 13) % 3}` : `w_${k}`,
        )
        .setDepth(2);
      walls.add(img);
      const l =
        k === "lock"
          ? this.map.locks.find((q) => q.x === x && q.y === y)
          : undefined;
      if (l) {
        img.setTint(LOCK_TINT[l.key] ?? 0xffffff);
        this.lockObjs.push({ l, img, open: false });
      }
      const sh =
        k === "counter"
          ? this.map.shops.find(
              (q) => q.y === y && (q.x === x || q.x + 1 === x),
            )
          : undefined;
      if (sh) img.setTint(SHOP_INFO[sh.kind].color);
    }
    // vanzatorul sta in spatele tejghelei, deasupra e firma magazinului (apare dupa ce o vezi prima oara)
    for (const s of this.map.shops) {
      const info = SHOP_INFO[s.kind];
      this.add
        .image((s.x + 1) * TILE, mid(s.y - 1), "trader")
        .setDepth(2.2)
        .setTint(info.color)
        .setRotation(Math.PI / 2);
      const label = this.add
        .text((s.x + 1) * TILE, mid(s.y) - 40, `$ ${info.name}`, {
          font: "bold 12px monospace",
          color: info.hex,
          backgroundColor: "#000000aa",
          padding: { x: 5, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(6)
        .setVisible(false);
      this.shopLabels.push({ s, label });
    }
    this.map.containers.forEach((c, i) => {
      this.register(`c${i}`, c);
      this.boxes.set(
        c,
        this.add.image(mid(c.x), mid(c.y), "box").setDepth(3).setVisible(false),
      );
    });

    // masini conductibile (stare efemera: doar Broadcast)
    this.map.vehicles.forEach((v, i) => {
      const x = mid(v.x),
        y = mid(v.y);
      const img = this.add
        .image(x, y, `w_car${i % 3}`)
        .setDepth(4.5)
        .setScale(1.3)
        .setRotation(v.a)
        .setVisible(false);
      this.cars.push({
        id: i,
        img,
        x,
        y,
        a: v.a,
        v: 0,
        w: 0,
        d: "",
        t: 0,
        dx: x,
        dy: y,
        da: v.a,
        moved: false,
      });
    });

    const spawn = this.zones[Math.floor(Math.random() * this.zones.length)];
    this.player = this.add
      .image(spawn.centerX, spawn.centerY, "player")
      .setDepth(5);
    this.physics.world.setBounds(0, 0, W * TILE, H * TILE);
    this.physics.add.existing(this.player);
    const pb = this.player.body as Phaser.Physics.Arcade.Body;
    pb.setCollideWorldBounds(true);
    pb.setCircle(9, 7, 7);
    this.physics.add.collider(this.player, walls);
    this.protectedUntil = this.time.now + SPAWN_PROTECT_MS;
    this.nextCheck = this.time.now + 2500; // lasam ceilalti jucatori sa apara inainte de alegerea hostului

    this.cameras.main
      .setBounds(0, 0, W * TILE, H * TILE)
      .startFollow(this.player, true, 0.15, 0.15);

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys("W,A,S,D,E,Q,H,R") as Keys;
    this.arrows = kb.createCursorKeys();
    window.addEventListener("keydown", this.onKey);
    this.input.setDefaultCursor("crosshair");

    this.fog = this.add.graphics().setDepth(7);
    this.bar = this.add.graphics().setDepth(8);
    this.buildHud();
    this.vig = this.add.image(0, 0, "vignette").setScrollFactor(0).setDepth(9);
    this.buildMini();
    this.layout();
    this.scale.on("resize", this.layout, this); // ecran complet: tot ce e fix pe ecran se repozitioneaza la redimensionare

    // ---- retea ----
    this.net = new Net(code, me.id, {
      pos: (m) => this.onPos(m),
      shot: (m) => this.onShot(m),
      dead: (m) => this.onDead(m),
      looted: (m) => this.onLooted(m),
      put: (m) => this.onPut(m),
      drop: (m) => this.addDrop(m),
      gone: (m) => this.removeRemote(m.id),
      hello: (m) => {
        if (m.id !== me.id) this.onHello(m.id);
      },
      state: (m) => this.onState(m),
      alarm: (m) => this.onAlarm(m),
      door: (m) => this.setOpen(m.id, true),
      car: (m) => this.onCar(m),
    });
    void this.net.join().then((ok) => {
      if (!ok) return this.say("No multiplayer connection: playing solo");
      void this.net.send("hello", { id: me.id });
      this.sendPos(this.time.now, true);
    });
  }

  update(_t: number, dt: number) {
    if (this.busy) return;
    const now = this.time.now,
      p = this.player,
      k = this.keys,
      a = this.arrows;
    if (now > this.nextCheck) {
      this.nextCheck = now + 1000;
      if (epochNow() !== this.epoch) this.resetLoot();
      this.electHost();
    }
    const body = p.body as Phaser.Physics.Arcade.Body;
    const lock = this.modal; // pop-up deschis: nu ne miscam, nu tragem, tastele de joc sunt consumate
    if (this.driving) this.drive(dt, now);
    else if (lock) body.velocity.set(0, 0);
    else {
      body.velocity
        .set(
          (k.D.isDown || a.right.isDown ? 1 : 0) -
            (k.A.isDown || a.left.isDown ? 1 : 0),
          (k.S.isDown || a.down.isDown ? 1 : 0) -
            (k.W.isDown || a.up.isDown ? 1 : 0),
        )
        .normalize()
        .scale(SPEED);
    }

    this.vision();
    this.cameraLead();
    this.bar.clear();
    this.tickHeal(now);
    this.tickReload(now);
    this.tickSteal(now);

    const jE = Phaser.Input.Keyboard.JustDown(k.E),
      jH = Phaser.Input.Keyboard.JustDown(k.H);
    const jR = Phaser.Input.Keyboard.JustDown(k.R),
      jQ = Phaser.Input.Keyboard.JustDown(k.Q); // consumate mereu, altfel ar ramane "apasate" dupa pop-up
    if (jE && !lock) {
      if (this.driving) this.exitCar();
      else if (this.inv) this.closeInv();
      else if (this.shop) this.closeShop();
      else if (
        !this.tryDoor() &&
        !this.tryShop() &&
        !this.openChest() &&
        !this.tryCar()
      )
        this.say("Nothing to search here");
    }
    if (jH && !lock) this.quickHeal();
    if (jR && !lock && !this.inv && !this.shop) this.startReload();
    if (
      this.shop &&
      Phaser.Math.Distance.Between(
        p.x,
        p.y,
        (this.shop.s.x + 1) * TILE,
        mid(this.shop.s.y),
      ) >
        REACH + 70
    )
      this.closeShop(); // te-ai departat de tejghea
    if (this.inv && this.chestC) {
      if (this.dist(this.chestC) > REACH + 30)
        this.closeInv(); // te-ai departat de container
      else this.tickReveal(now);
    }

    if (jQ && !lock) void this.askAbandon();

    if (
      !this.driving &&
      this.zones.some((z) => z.contains(p.x, p.y)) &&
      now > this.blockedUntil
    ) {
      this.extractMs += dt;
      this.progress(this.extractMs / EXTRACT_MS, 0x00e676);
      if (this.extractMs >= EXTRACT_MS) void this.extract();
    } else this.extractMs = 0;

    this.aimAndShoot(now);
    this.updateBullets(dt, now);
    if (this.hostSeen === this.cfg.me.id) this.updateBots(dt, now);
    this.updateRemotes(dt, now);
    this.updateCars(dt, now);
    this.updateCorpses(now);
    this.sendPos(now);
    this.sendCar(now);
    this.drawMini();

    this.updateHud();
  }

  // Pozitiile elementelor fixe pe ecran (se apeleaza si la redimensionarea ferestrei)
  private layout() {
    const w = this.scale.width,
      h = this.scale.height;
    this.vig.setPosition(w / 2, h / 2).setDisplaySize(w, h);
    const mx = w - 8 - W * MS;
    this.miniBg.setPosition(mx, 8);
    this.mini.setPosition(mx, 8);
  }

  // ---------- vizibilitate ----------
  // Distanta pana la primul obiect care blocheaza vederea pe raza (c,s), maxim `max`
  private cast(x: number, y: number, c: number, s: number, max: number) {
    for (let d = 6; d < max; d += 6) {
      if (
        this.viewSet.has(
          Math.floor((y + s * d) / TILE) * 1000 +
            Math.floor((x + c * d) / TILE),
        )
      )
        return Math.min(max, d + 6);
    }
    return max;
  }

  // Calculeaza cat vede jucatorul pe fiecare din RAYS raze si deseneaza intunericul DOAR in afara zonei vizibile
  // (triunghiuri intre raza si FOG_R: functioneaza identic pe Phaser 3 si 4, fara masti). Sniper: con mai lung si mai ingust.
  private vision() {
    const p = this.player;
    const gun = this.gun(),
      range = gun.range ?? RANGE,
      fov = gun.fov ?? FOV;
    const w = this.input.activePointer.positionToCamera(
      this.cameras.main,
    ) as Phaser.Math.Vector2;
    const face = Math.atan2(w.y - p.y, w.x - p.x);
    for (let i = 0; i < RAYS; i++) {
      const { a, c, s } = DIRS[i];
      const inCone =
        Math.abs(Math.atan2(Math.sin(a - face), Math.cos(a - face))) <= fov / 2;
      this.reach[i] = this.cast(p.x, p.y, c, s, inCone ? range : NEAR);
    }
    const f = this.fog.clear().fillStyle(0x000000, FOG_ALPHA);
    for (let i = 0; i < RAYS; i++) {
      const j = (i + 1) % RAYS,
        d0 = DIRS[i],
        d1 = DIRS[j];
      const ax = p.x + d0.c * this.reach[i],
        ay = p.y + d0.s * this.reach[i];
      const bx = p.x + d1.c * this.reach[j],
        by = p.y + d1.s * this.reach[j];
      const cx = p.x + d1.c * FOG_R,
        cy = p.y + d1.s * FOG_R,
        dx = p.x + d0.c * FOG_R,
        dy = p.y + d0.s * FOG_R;
      f.fillTriangle(ax, ay, bx, by, cx, cy).fillTriangle(
        ax,
        ay,
        cx,
        cy,
        dx,
        dy,
      );
    }
    for (const [c, box] of this.boxes) {
      const q = this.cpos(c);
      if (!this.seen.has(c) && this.see(q.x, q.y)) this.seen.add(c);
      box.setVisible(this.seen.has(c));
    }
    for (const { s, label } of this.shopLabels) {
      if (!this.shopSeen.has(s) && this.see((s.x + 1) * TILE, mid(s.y)))
        this.shopSeen.add(s);
      label.setVisible(this.shopSeen.has(s));
    }
  }

  private see(x: number, y: number) {
    const dx = x - this.player.x,
      dy = y - this.player.y;
    const i = Math.round((Math.atan2(dy, dx) + Math.PI) / STEP) % RAYS;
    return Math.hypot(dx, dy) <= this.reach[i] + 8;
  }

  // Cu sniperul camera se muta spre mouse, ca sa vezi cat de departe ajunge raza
  private cameraLead() {
    const ptr = this.input.activePointer;
    const k = 0; // camera ramane pe caracter
    const tx = Phaser.Math.Clamp((ptr.x - this.scale.width / 2) * k, -320, 320),
      ty = Phaser.Math.Clamp((ptr.y - this.scale.height / 2) * k, -200, 200);
    this.lead.x += (tx - this.lead.x) * 0.08;
    this.lead.y += (ty - this.lead.y) * 0.08;
    this.cameras.main.setFollowOffset(-this.lead.x, -this.lead.y);
  }

  // ---------- minimap (dreapta sus) ----------
  private buildMini() {
    const x0 = 0,
      y0 = 0; // pozitia pe ecran o seteaza layout()
    const g = this.add.graphics().setScrollFactor(0).setDepth(10);
    this.miniBg = g;
    g.fillStyle(0x000000, 0.7).fillRect(x0 - 3, y0 - 3, W * MS + 6, H * MS + 6);
    g.lineStyle(2, 0xffb300, 0.9).strokeRect(
      x0 - 3,
      y0 - 3,
      W * MS + 6,
      H * MS + 6,
    );
    g.fillStyle(0x2b2e33).fillRect(x0, y0, W * MS, H * MS); // asfalt (fara inele de zona)
    const gcol: Record<string, number> = {
      grass: 0x2f6b34,
      paved: 0x6e7078,
      sidewalk: 0x8a8d93,
      floor: 0x6a5a4b,
      tile: 0xcfd8dc,
      dirt: 0x7a6246,
    };
    for (const [x, y, k] of this.map.ground)
      if (gcol[k] !== undefined)
        g.fillStyle(gcol[k]).fillRect(x0 + x * MS, y0 + y * MS, MS, MS);
    const col: Record<string, number> = {
      wall: 0xb0b6bf,
      tree: 0x2e7d32,
      crate: 0x8d6e63,
      fence: 0x8d6e63,
      car: 0x5c7fb8,
      shelf: 0x8d6e63,
      pump: 0xd32f2f,
      counter: 0xb0bec5,
      water: 0x1e88e5,
    };
    for (const [x, y, k = "wall"] of this.map.walls)
      if (k !== "lock")
        g.fillStyle(col[k] ?? 0xb0b6bf).fillRect(
          x0 + x * MS,
          y0 + y * MS,
          MS,
          MS,
        );
    for (const r of this.map.extract)
      g.fillStyle(0x00e676).fillRect(
        x0 + r.x * MS,
        y0 + r.y * MS,
        r.w * MS,
        r.h * MS,
      );
    this.mini = this.add.graphics().setScrollFactor(0).setDepth(11);
  }

  private drawMini() {
    const m = this.mini.clear(),
      x0 = 0,
      y0 = 0;
    for (const s of this.map.shops)
      m.fillStyle(SHOP_INFO[s.kind].color).fillRect(
        x0 + s.x * MS - 1,
        y0 + s.y * MS - 2,
        MS * 2 + 2,
        MS + 3,
      ); // magazinele se vad mereu
    for (const o of this.lockObjs)
      if (!o.open)
        m.fillStyle(LOCK_TINT[o.l.key] ?? 0xffffff).fillRect(
          x0 + o.l.x * MS - 1,
          y0 + o.l.y * MS - 1,
          MS + 2,
          MS + 2,
        );
    for (const c of this.boxes.keys())
      if (this.seen.has(c) && c.items.length)
        m.fillStyle(0xffeb3b).fillRect(x0 + c.x * MS, y0 + c.y * MS, 2, 2);
    for (const c of this.cars)
      if (c.img.visible)
        m.fillStyle(0x90caf9).fillRect(
          x0 + (c.dx / TILE) * MS - 1,
          y0 + (c.dy / TILE) * MS - 1,
          3,
          3,
        );
    for (const [id, r] of this.remotes)
      if (r.g.visible)
        m.fillStyle(isBot(id) ? 0xff8a65 : 0xff1744).fillRect(
          x0 + (r.dx / TILE) * MS - 1,
          y0 + (r.dy / TILE) * MS - 1,
          3,
          3,
        );
    const p = this.player,
      px = x0 + (p.x / TILE) * MS,
      py = y0 + (p.y / TILE) * MS;
    m.lineStyle(1, 0xffffff, 0.9).lineBetween(
      px,
      py,
      px + Math.cos(p.rotation) * 6,
      py + Math.sin(p.rotation) * 6,
    );
    m.fillStyle(0xffffff).fillCircle(px, py, 2.2);
  }

  // ---------- helperi ----------
  private register(id: string, c: Container) {
    this.ids.set(c, id);
    this.byId.set(id, c);
  }

  // pozitia exacta a unui container (drop-urile stau unde a murit jucatorul)
  private cpos(c: Container) {
    return { x: c.px ?? mid(c.x), y: c.py ?? mid(c.y) };
  }

  private isDrop(c: Container) {
    return this.ids.get(c)?.[0] === "d";
  }

  private dist(c: Container) {
    const q = this.cpos(c);
    return Phaser.Math.Distance.Between(this.player.x, this.player.y, q.x, q.y);
  }

  // Mesaj scurt (toast) deasupra HUD-ului; maxim 4 deodata
  private say(t: string) {
    const box = this.hud.toasts,
      el = document.createElement("div");
    el.className = "hud-toast";
    el.textContent = t;
    box.appendChild(el);
    while (box.children.length > 4) box.firstElementChild!.remove();
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 250);
    }, 3200);
  }

  // ---------- HUD (HTML, deasupra canvas-ului) ----------
  private buildHud() {
    const root = document.createElement("div");
    root.className = "hud";
    root.innerHTML = `<div class="hud-bl">
        <div class="hud-gun"><span class="hud-wpn"></span><span class="hud-ammo"><b class="hud-mag"></b><i class="hud-res"></i></span></div>
        <div class="hud-hp"><div class="hud-hpf"></div><span class="hud-hpt"></span></div>
        <div class="hud-row"><span class="hud-arm"></span><span class="hud-money"></span></div>
      </div><div class="hud-toasts"></div>`;
    this.cfg.parent.appendChild(root);
    const q = (c: string) => root.querySelector<HTMLElement>(`.hud-${c}`)!;
    this.hud = {
      root,
      wpn: q("wpn"),
      mag: q("mag"),
      res: q("res"),
      hp: q("hpf"),
      hpt: q("hpt"),
      arm: q("arm"),
      money: q("money"),
      toasts: q("toasts"),
    };
  }

  // Actualizeaza doar ce s-a schimbat (apelat in fiecare cadru)
  private updateHud() {
    const w = this.B.weapon.items[0],
      g = this.gun(),
      res = this.reserve(g),
      mag = this.magNow();
    const arm = Math.round(this.armor() * 100);
    const key = `${w?.type ?? "p"}|${mag}|${g.mag}|${res}|${this.money}|${this.hp}|${arm}|${this.reloading ? 1 : 0}`;
    if (key === this.lastHud) return;
    this.lastHud = key;
    const h = this.hud;
    h.wpn.textContent = w ? this.defs.get(w.type)!.name : "Pistol";
    h.mag.textContent = this.reloading ? "..." : String(mag);
    h.mag.classList.toggle(
      "low",
      !this.reloading && mag <= Math.ceil(g.mag * 0.25),
    );
    h.res.textContent = `/ ${g.mag}  ·  ${res === Infinity ? "∞" : res}`;
    h.hp.style.width = `${Math.max(0, (100 * this.hp) / HP_MAX)}%`;
    h.hp.parentElement!.classList.toggle("low", this.hp <= 30);
    h.hpt.textContent = String(Math.ceil(this.hp));
    h.arm.textContent = arm ? `Armor ${arm}%` : "No armor";
    h.arm.classList.toggle("on", arm > 0);
    h.money.textContent = `$${this.money}`;
  }

  private progress(f: number, color: number) {
    const { x, y } = this.player;
    this.bar
      .fillStyle(0x000000, 0.6)
      .fillRect(x - 20, y - 26, 40, 6)
      .fillStyle(color)
      .fillRect(x - 20, y - 26, 40 * Math.min(f, 1), 6);
  }

  private isWall(px: number, py: number) {
    return this.wallSet.has(
      Math.floor(py / TILE) * 1000 + Math.floor(px / TILE),
    );
  }

  // gloantele trec peste apa
  private isShot(px: number, py: number) {
    const k = Math.floor(py / TILE) * 1000 + Math.floor(px / TILE);
    return this.wallSet.has(k) && !this.waterSet.has(k);
  }

  private recolor(c: Container) {
    this.boxes
      .get(c)
      ?.setTexture(
        c.items.length ? (this.isDrop(c) ? "drop" : "box") : "box_empty",
      );
  }

  // ---------- inventar ----------
  private packItems(): Item[] {
    const B = this.B;
    return [
      ...B.bag.items,
      ...B.head.items,
      ...B.body.items,
      ...B.weapon.items,
      ...B.back.items,
    ];
  }

  private gun(): Gun {
    const w = this.B.weapon.items[0];
    return (w && spec(w.type)?.gun) || PISTOL;
  }

  private armor() {
    return [this.B.head, this.B.body].reduce(
      (s, b) => s + (b.items[0] ? (spec(b.items[0].type)?.red ?? 0) : 0),
      0,
    );
  }

  // c = containerul deschis (null = doar inventarul propriu)
  private openInv(c: Container | null) {
    this.closeInv();
    this.closeShop();
    const ov = document.createElement("div");
    ov.className = "invov";
    ov.innerHTML =
      '<div class="invst"></div><div class="invroot"></div><div class="invhint"><kbd>Drag</kbd> between grids (and back into the container) · <kbd>Right-click</kbd> equip / take / use · drag <b>outside the panels</b> to drop on the ground · <kbd>Tab</kbd> / <kbd>Esc</kbd> close</div>';
    ov.addEventListener("contextmenu", (e) => e.preventDefault());
    this.cfg.parent.appendChild(ov);
    this.ov = ov;
    this.ovStatus = ov.querySelector(".invst");
    if (c) {
      this.chestC = c;
      this.chest = {
        id: "chest",
        title: this.isDrop(c) ? "On the ground / corpse" : "Container",
        w: 6,
        h: 1,
        items: [],
        grow: true,
      };
      this.syncChest();
    }
    const B = this.B;
    this.inv = mountInventory(
      ov.querySelector(".invroot") as HTMLElement,
      this.chest,
      [B.head, B.body, B.weapon, B.back],
      B.bag,
      this.hooks,
    );
  }

  private closeInv() {
    this.inv?.destroy();
    this.ov?.remove();
    this.inv =
      this.ov =
      this.ovStatus =
      this.chest =
      this.chestC =
      this.reveal =
        null;
  }

  // true = am gasit un container in apropiere (deschis sau gol)
  private openChest(): boolean {
    const c = this.map.containers
      .filter((q) => this.dist(q) < REACH + (q.px !== undefined ? 16 : 0))
      .sort((a, b) => this.dist(a) - this.dist(b))[0];
    if (!c) return false;
    this.openInv(c); // si cele goale: poti pune iteme in ele
    return true;
  }

  // Gridul containerului oglindeste c.items (iteme luate de altii dispar, cele noi apar nedeblocate; la cadavre sunt instant revelate)
  private syncChest() {
    const ch = this.chest,
      c = this.chestC;
    if (!ch || !c) return;
    ch.items = ch.items.filter((it) =>
      c.items.includes(this.lootOf.get(it.id)!),
    );
    const have = new Set(ch.items.map((it) => this.lootOf.get(it.id)));
    for (const l of c.items) {
      if (have.has(l)) continue;
      const it: Item = {
        id: `L${this.fseq++}`,
        type: l.item_type,
        qty: l.quantity,
        x: 0,
        y: 0,
      };
      this.lootOf.set(it.id, l);
      if (this.isDrop(c)) this.revealed.add(l);
      autoPlace(this.defs, ch, it); // grid cu `grow`: gaseste mereu loc
    }
  }

  // Itemele din container sunt gri (`?`) si se deblocheaza pe rand, fiecare in acelasi timp (REVEAL_MS);
  // dupa deblocare apare tipul itemului cu un mic efect (clasa CSS `pop`)
  private tickReveal(now: number) {
    const c = this.chestC!;
    const next = c.items.find((l) => !this.revealed.has(l));
    if (!next) {
      this.reveal = null;
      if (this.ovStatus)
        this.ovStatus.textContent = c.items.length
          ? ""
          : "Container empty · drag items here to leave them";
      return;
    }
    if (this.reveal?.loot !== next)
      this.reveal = { loot: next, t0: now, ms: REVEAL_MS };
    const f = (now - this.reveal.t0) / this.reveal.ms;
    const id = this.chest?.items.find(
      (i) => this.lootOf.get(i.id) === next,
    )?.id;
    const sel = `.it[data-it="${id}"]`;
    if (f >= 1) {
      this.revealed.add(next);
      this.reveal = null;
      this.inv?.render();
      if (id) this.ov?.querySelector(sel)?.classList.add("pop"); // mini efect de deblocare
    } else {
      if (id)
        this.ov
          ?.querySelector<HTMLElement>(sel)
          ?.style.setProperty("--p", String(f));
      if (this.ovStatus)
        this.ovStatus.textContent = `Unlocking... ${Math.round(f * 100)}%`;
    }
  }

  // Poate fi luat itemul din container? (returneaza mesajul de eroare). Nu mai exista limite pe raritate.
  private checkTake(it: Item): string | null {
    const l = this.lootOf.get(it.id);
    return !l || !this.revealed.has(l)
      ? "Item not unlocked yet"
      : null;
  }

  // Cat loc liber e in stack-urile existente (doar iteme gasite in raid; cele aduse din stash nu se amesteca cu ele)
  private stackFree(it: Item) {
    const max = stackMax(this.defs.get(it.type)!);
    if (max <= 1) return 0;
    return this.packItems()
      .filter((i) => i !== it && i.found && i.type === it.type)
      .reduce((n, i) => n + Math.max(0, max - i.qty), 0);
  }

  // Umple stack-urile existente; ce ramane ramane in `it` (qty redus). true = a intrat tot si `it` dispare.
  private mergeInto(it: Item): boolean {
    const max = stackMax(this.defs.get(it.type)!);
    if (max <= 1) return false;
    for (const s of this.packItems()) {
      if (s === it || !s.found || s.type !== it.type || s.qty >= max) continue;
      const n = Math.min(max - s.qty, it.qty);
      s.qty += n;
      it.qty -= n;
      if (it.qty <= 0) return true;
    }
    return false;
  }

  // Itemul a intrat in rucsac: scoate loot-ul din container, anunta ceilalti. Returneaza true daca s-a combinat cu un stack existent.
  private commitTake(it: Item): boolean {
    const c = this.chestC!,
      loot = this.lootOf.get(it.id)!,
      def = this.defs.get(it.type)!;
    c.items = c.items.filter((l) => l !== loot);
    const qty0 = it.qty;
    const eaten = this.mergeInto(it);
    if (!eaten) it.found = true;
    this.xp = Math.min(MAX_XP, this.xp + (XP[def.rarity] ?? 0));
    const k = this.ids.get(c)!;
    this.touched.add(k);
    this.recolor(c);
    void this.net.send("looted", {
      k,
      taken: [{ item_type: it.type, quantity: qty0 }],
    } satisfies LootedMsg);
    if (def.rarity === "legendary") {
      const q = this.cpos(c);
      const a: AlarmMsg = { x: Math.round(q.x), y: Math.round(q.y) };
      this.onAlarm(a);
      void this.net.send("alarm", a);
    }
    return eaten;
  }

  // Clic dreapta
  private useItem(it: Item, from: Box) {
    const B = this.B;
    if (from === this.chest) {
      if (spec(it.type)?.slot) return this.equipFromChest(it); // rucsac / casca / vesta / arma: se echipeaza direct
      const err = this.checkTake(it);
      if (err) return this.say(err);
      const full = this.stackFree(it) >= it.qty,
        saved = { x: it.x, y: it.y };
      from.items = from.items.filter((i) => i !== it);
      if (!full && !autoPlace(this.defs, B.bag, it)) {
        from.items.push(it);
        Object.assign(it, saved);
        return this.say("Not enough room in inventory");
      }
      this.commitTake(it);
      return;
    }
    if (spec(it.type)?.heal) return this.startHeal(it);
    if (spec(it.type)?.slot || from.slot) {
      if (
        quickEquip(
          this.defs,
          it,
          from,
          { head: B.head, body: B.body, weapon: B.weapon, back: B.back },
          B.bag,
        )
      )
        this.sendPos(this.time.now, true);
      else this.say("Can't equip / no room in inventory");
    }
  }

  // Clic dreapta pe echipament din container: se echipeaza direct, fara sa treaca prin inventar.
  // Itemul vechi merge in inventar sau, daca nu incape, ramane in container; daca noul rucsac ar lasa inventarul fara loc, schimbul se anuleaza.
  private equipFromChest(it: Item) {
    const err0 = this.checkTake(it);
    if (err0) return this.say(err0);
    const B = this.B,
      ch = this.chest,
      s = spec(it.type)?.slot,
      to = s && B[s];
    if (!ch || !to) return;
    const before = snap([B.bag, B.head, B.body, B.weapon, B.back, ch]);
    const prev = to.items[0];
    ch.items = ch.items.filter((i) => i !== it);
    Object.assign(it, { x: 0, y: 0 });
    to.items = [it];
    const err = refit(this.defs, B.bag, B.back);
    if (err) {
      restore(before);
      return this.say(err);
    }
    let toChest = false;
    if (prev && !autoPlace(this.defs, B.bag, prev)) {
      autoPlace(this.defs, ch, prev);
      toChest = true;
    }
    this.commitTake(it);
    if (prev && toChest) this.commitPut(prev);
    this.sendPos(this.time.now, true);
  }

  // ---------- pop-up-uri, depunere, aruncare ----------
  private async ask(o: Parameters<typeof confirmBox>[0]) {
    this.modal = true;
    try {
      return await confirmBox(o);
    } finally {
      this.modal = false;
    }
  }

  private async askAbandon() {
    if (
      await this.ask({
        title: "Abandon the raid?",
        text: "You lose all the gear you brought into the raid; what you carry stays on the ground.",
        ok: "Abandon",
        cancel: "Keep raiding",
        danger: true,
      })
    )
      void this.die(null, true);
  }

  // Itemele aduse din stash nu mai sunt ale tale dupa ce ajung in container / pe jos: se scad din baza de date (reiau drumul ca "gasite" daca le iei inapoi)
  private release(it: Item) {
    if (!it.found && +it.id > 0)
      void rpcRetry(
        "consume_raid_item",
        { p_item_id: +it.id, p_qty: it.qty },
        3,
      );
  }

  // Item mutat din inventar in containerul deschis: devine loot normal, deja deblocat, vizibil si pentru ceilalti
  private commitPut(it: Item) {
    const c = this.chestC,
      k = c && this.ids.get(c);
    if (!c || !k) return;
    const loot: Loot = { item_type: it.type, quantity: it.qty };
    c.items.push(loot);
    this.lootOf.set(it.id, loot);
    this.revealed.add(loot);
    this.release(it);
    this.touched.add(k);
    this.recolor(c);
    void this.net.send("put", { k, added: [{ ...loot }] } satisfies PutMsg);
    this.say(`You put ${this.defs.get(it.type)!.name} in the container`);
  }

  // Item tras in afara panourilor: cade pe jos. Daca e deja un drop in apropiere, se adauga acolo.
  private throwItem(it: Item) {
    const p = this.player,
      loot: Loot = { item_type: it.type, quantity: it.qty };
    this.release(it);
    const near = this.map.containers.find(
      (c) =>
        this.isDrop(c) &&
        Math.hypot(this.cpos(c).x - p.x, this.cpos(c).y - p.y) < 30,
    );
    const k = near && this.ids.get(near);
    if (near && k) {
      near.items.push(loot);
      this.touched.add(k);
      this.recolor(near);
      this.refreshChest(near);
      void this.net.send("put", { k, added: [{ ...loot }] } satisfies PutMsg);
    } else {
      const m: DeadMsg = {
        id: this.cfg.me.id,
        x: Math.round(p.x),
        y: Math.round(p.y),
        loot: [loot],
        by: null,
        n: this.cfg.me.name,
        did: Math.random().toString(36).slice(2, 8),
      };
      this.addDrop(m);
      void this.net.send("drop", m);
    }
    this.say(`You dropped ${this.defs.get(it.type)!.name}`);
  }

  // Alt jucator a pus iteme intr-un container / drop
  private onPut(m: PutMsg) {
    const c = this.byId.get(m.k);
    if (!c) return;
    c.items.push(...m.added.map((l) => ({ ...l })));
    this.touched.add(m.k);
    this.recolor(c);
    this.refreshChest(c);
  }

  // ---------- gloante si reload ----------
  private wkey() {
    return this.B.weapon.items[0]?.id ?? "pistol";
  }

  // gloante in incarcator (arma noua cu gloante reale porneste goala: apasa R)
  private magNow(): number {
    const k = this.wkey(),
      g = this.gun();
    if (!this.mag.has(k)) this.mag.set(k, g.ammo ? 0 : g.mag);
    return this.mag.get(k)!;
  }

  private reserve(g: Gun): number {
    return g.ammo
      ? this.B.bag.items
          .filter((i) => i.type === g.ammo)
          .reduce((n, i) => n + i.qty, 0)
      : Infinity;
  }

  private startReload() {
    if (this.reloading || this.driving) return;
    const g = this.gun();
    if (this.magNow() >= g.mag) return this.say("Magazine full");
    if (this.reserve(g) <= 0)
      return this.say(
        `No ammo (${this.defs.get(g.ammo!)?.name ?? g.ammo}) in inventory`,
      );
    this.reloading = { t0: this.time.now, ms: g.reload, key: this.wkey() };
    this.say("Reloading...");
  }

  private tickReload(now: number) {
    const r = this.reloading;
    if (!r) return;
    if (r.key !== this.wkey()) {
      this.reloading = null;
      return;
    } // ai schimbat arma
    if (now - r.t0 < r.ms) return this.progress((now - r.t0) / r.ms, 0xffca28);
    this.reloading = null;
    const g = this.gun(),
      have = this.magNow();
    const need = Math.min(g.mag - have, this.reserve(g));
    if (need <= 0) return;
    if (g.ammo) this.takeAmmo(g.ammo, need);
    this.mag.set(r.key, have + need);
    this.say(`Magazine ${have + need}/${g.mag}`);
  }

  private takeAmmo(type: string, n: number) {
    for (const it of this.B.bag.items.filter((i) => i.type === type)) {
      if (n <= 0) break;
      const u = Math.min(n, it.qty);
      this.consumeN(it, u);
      n -= u;
    }
  }

  // ---------- heal ----------
  private startHeal(it: Item) {
    const h = spec(it.type)?.heal;
    if (!h || this.healing) return;
    if (this.hp >= HP_MAX) return this.say("Health is already full");
    this.healing = { it, t0: this.time.now, ms: h.ms, hp: h.hp };
    this.say(`Using ${this.defs.get(it.type)!.name}...`);
  }

  // H: cel mai mic heal care acopera ce lipseste, altfel cel mai mare
  private quickHeal() {
    const miss = HP_MAX - this.hp;
    const hs = this.B.bag.items
      .filter((i) => spec(i.type)?.heal)
      .sort((a, b) => spec(a.type)!.heal!.hp - spec(b.type)!.heal!.hp);
    const it =
      hs.find((i) => spec(i.type)!.heal!.hp >= miss) ?? hs[hs.length - 1];
    if (it) this.startHeal(it);
    else this.say("You have nothing to heal with");
  }

  private tickHeal(now: number) {
    const h = this.healing;
    if (!h) return;
    if (!this.packItems().includes(h.it)) {
      this.healing = null;
      return;
    }
    if (now - h.t0 < h.ms) return this.progress((now - h.t0) / h.ms, 0x66bb6a);
    this.healing = null;
    this.hp = Math.min(HP_MAX, this.hp + h.hp);
    this.consumeN(h.it, 1);
    this.drawHp();
    this.sendPos(now, true);
    this.say(`+${h.hp} HP`);
  }

  // Foloseste n unitati dintr-un item; cele aduse din stash se scad si in baza de date (un singur RPC)
  private consumeN(it: Item, n: number) {
    const box = [
      this.B.bag,
      this.B.head,
      this.B.body,
      this.B.weapon,
      this.B.back,
    ].find((b) => b.items.includes(it));
    if (!box) return;
    const used = Math.min(n, it.qty);
    it.qty -= used;
    if (it.qty <= 0) box.items = box.items.filter((i) => i !== it);
    if (!it.found && used > 0)
      void rpcRetry("consume_raid_item", { p_item_id: +it.id, p_qty: used }, 3);
    this.inv?.render();
  }

  // ---------- magazine ----------
  private tryShop(): boolean {
    const p = this.player;
    const s = this.map.shops.find(
      (q) =>
        Phaser.Math.Distance.Between(p.x, p.y, (q.x + 1) * TILE, mid(q.y)) <
        REACH + 24,
    );
    if (!s) return false;
    this.openShop(s);
    return true;
  }

  private isAmmo = (d: Def) => /^ammo_/.test(d.item_type);

  // Ce vinde fiecare tip de magazin (din item_defs; legendarele nu se cumpara, doar se gasesc)
  private stock(kind: ShopKind): Def[] {
    const has: Record<ShopKind, (d: Def) => boolean> = {
      arms: (d) => !!spec(d.item_type)?.gun,
      ammo: (d) => this.isAmmo(d),
      med: (d) => !!spec(d.item_type)?.heal,
      gear: (d) => !!(spec(d.item_type)?.pack || spec(d.item_type)?.red),
    };
    return [...this.defs.values()]
      .filter((d) => d.rarity !== "legendary" && has[kind](d))
      .sort((a, b) => this.offer(a).price - this.offer(b).price);
  }

  // Gloantele se vand in pachete de 20; restul cate unul
  private offer(d: Def) {
    const ammo = this.isAmmo(d),
      qty = ammo ? 20 : 1;
    const base =
      d.base_value && d.base_value > 0
        ? d.base_value
        : ammo
          ? 2
          : (FALLBACK_PRICE[d.rarity] ?? 100);
    return { qty, price: Math.max(1, Math.round(base * BUY_MULT * qty)) };
  }

  private openShop(s: Shop) {
    this.closeInv();
    this.closeShop();
    const ov = document.createElement("div");
    ov.className = "invov";
    ov.addEventListener("contextmenu", (e) => e.preventDefault());
    ov.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>(
        "button[data-t]",
      );
      if (b) void this.buy(b.dataset.t!);
    });
    this.cfg.parent.appendChild(ov);
    this.shop = { s, el: ov };
    this.renderShop();
  }

  private closeShop() {
    this.shop?.el.remove();
    this.shop = null;
  }

  private renderShop() {
    const sh = this.shop;
    if (!sh) return;
    const info = SHOP_INFO[sh.s.kind];
    const keep = sh.el.querySelector(".shl")?.scrollTop ?? 0;
    const rows = this.stock(sh.s.kind)
      .map((d) => {
        const { qty, price } = this.offer(d);
        const [, head, ...rest] = tip(d, qty).split("\n");
        const chips = rest
          .map((l) => `<span>${esc(l.replace(/ \(.*\)$/, ""))}</span>`)
          .join("");
        const poor = this.money < price;
        return `<div class="srow sr-${d.rarity}${poor ? " poor" : ""}">
        <div class="sic r-${d.rarity}">${iconSvg(d)}</div>
        <div class="sin"><b>${esc(d.name)}${qty > 1 ? ` x${qty}` : ""}</b><em>${esc(head)}</em><div class="chips">${chips}</div></div>
        <div class="sp">$${price}</div>
        <button class="btn primary" data-t="${esc(d.item_type)}"${poor || this.buying ? " disabled" : ""}>Buy</button></div>`;
      })
      .join("");
    sh.el.innerHTML = `<div class="shop" style="--tone:${info.hex}">
      <div class="shh"><h3>${info.name}</h3><span class="shm">$${this.money}</span></div>
      <div class="shl">${rows || '<p class="ssub">Nothing for sale here (items missing from the database).</p>'}</div>
      <div class="invhint"><kbd>Tab</kbd> inventory · <kbd>E</kbd> / <kbd>Esc</kbd> close · you pay from your account money, the item goes straight to your inventory</div></div>`;
    const list = sh.el.querySelector(".shl");
    if (list) list.scrollTop = keep;
  }

  // Itemul se pune intai in inventar (daca nu incape, nu se plateste nimic), apoi se retrag banii prin RPC; la eroare se anuleaza
  private async buy(type: string) {
    const d = this.defs.get(type);
    if (!d || this.buying || !this.shop) return;
    const { qty, price } = this.offer(d),
      B = this.B;
    if (this.money < price) return this.say("Not enough money");
    const it: Item = {
      id: `B${this.fseq++}`,
      type,
      qty,
      x: 0,
      y: 0,
      found: true,
    };
    const slot = spec(type)?.slot;
    const before = snap([B.bag, B.head, B.body, B.weapon, B.back]);
    const toBack = slot === "back" && !B.back.items.length;
    if (toBack) {
      B.back.items.push(it);
      const err = refit(this.defs, B.bag, B.back);
      if (err) {
        B.back.items = [];
        return this.say(err);
      }
    } else {
      if (this.stackFree(it) < it.qty && !autoPlace(this.defs, B.bag, it))
        return this.say("Not enough room in inventory");
      this.mergeInto(it); // gloantele cumparate completeaza stack-urile existente
    }

    this.buying = true;
    this.renderShop();
    const { data, error } = await rpcRetry(
      "spend_money",
      { p_amount: price },
      3,
    );
    this.buying = false;
    if (error) {
      restore(before);
      refit(this.defs, B.bag, B.back);
      this.renderShop();
      return this.say(
        /function|schema cache|could not find/i.test(error.message)
          ? "The shop is not active: run supabase/shop.sql in Supabase"
          : /enough|insufficient/i.test(error.message)
            ? "Not enough money"
            : error.message,
      );
    }
    this.money = typeof data === "number" ? data : this.money - price;
    // arma / casca / vesta cumparata se echipeaza singura daca slotul e liber
    if (slot && slot !== "back" && !B[slot].items.length)
      quickEquip(
        this.defs,
        it,
        B.bag,
        { head: B.head, body: B.body, weapon: B.weapon, back: B.back },
        B.bag,
      );
    this.sendPos(this.time.now, true);
    this.say(`You bought ${d.name}${qty > 1 ? ` x${qty}` : ""}`);
    this.renderShop();
    this.inv?.render();
  }

  // ---------- usi incuiate ----------
  private tryDoor(): boolean {
    const p = this.player;
    const o = this.lockObjs.find(
      (q) =>
        !q.open &&
        Phaser.Math.Distance.Between(p.x, p.y, mid(q.l.x), mid(q.l.y)) <
          REACH + 8,
    );
    if (!o) return false;
    const key = this.packItems().find((i) => spec(i.type)?.door === o.l.key);
    if (!key) {
      const need =
        [...this.defs.values()].find((d) => spec(d.item_type)?.door === o.l.key)
          ?.name ?? "a key";
      this.say(`Locked: ${o.l.key} (requires ${need})`);
      return true;
    }
    this.consumeN(key, 1);
    this.setOpen(o.l.id, true);
    void this.net.send("door", { id: o.l.id } satisfies DoorMsg);
    this.say(`You unlocked: ${o.l.key}`);
    return true;
  }

  private setOpen(id: string, open: boolean) {
    for (const o of this.lockObjs) {
      if (o.l.id !== id) continue;
      o.open = open;
      o.img.setVisible(!open);
      (o.img.body as Phaser.Physics.Arcade.StaticBody).enable = !open;
      const key = o.l.y * 1000 + o.l.x;
      if (open) {
        this.wallSet.delete(key);
        this.viewSet.delete(key);
      } else {
        this.wallSet.add(key);
        this.viewSet.add(key);
      }
    }
    if (open) this.opened.add(id);
    else this.opened.delete(id);
  }

  // ---------- masini ----------
  private carMsg(c: Car): CarMsg {
    return {
      id: c.id,
      x: Math.round(c.x),
      y: Math.round(c.y),
      a: +c.a.toFixed(2),
      v: Math.round(c.v),
      w: +c.w.toFixed(2),
      d: c.d,
    };
  }

  // E langa o masina libera: o furi (hotwire 1.5s)
  private tryCar(): boolean {
    const p = this.player;
    const c = this.cars
      .filter((q) => !q.d)
      .sort(
        (a, b) =>
          Phaser.Math.Distance.Between(p.x, p.y, a.dx, a.dy) -
          Phaser.Math.Distance.Between(p.x, p.y, b.dx, b.dy),
      )[0];
    if (!c || Phaser.Math.Distance.Between(p.x, p.y, c.dx, c.dy) > REACH + 20)
      return false;
    this.stealing = { c, t0: this.time.now };
    this.say("Hotwiring the car...");
    return true;
  }

  private tickSteal(now: number) {
    const s = this.stealing;
    if (!s) return;
    const d = Phaser.Math.Distance.Between(
      this.player.x,
      this.player.y,
      s.c.dx,
      s.c.dy,
    );
    if (d > REACH + 40 || s.c.d) {
      this.stealing = null;
      return this.say("You gave up");
    }
    if (now - s.t0 >= STEAL_MS) {
      this.stealing = null;
      return this.enterCar(s.c);
    }
    this.progress((now - s.t0) / STEAL_MS, 0x42a5f5);
  }

  private enterCar(c: Car) {
    if (c.d) return this.say("The car is occupied");
    this.closeInv();
    this.healing = null;
    this.reloading = null;
    this.driving = c;
    this.carV = 0;
    c.d = this.cfg.me.id;
    c.moved = true;
    c.v = 0;
    c.w = 0;
    c.t = this.time.now;
    const p = this.player,
      body = p.body as Phaser.Physics.Arcade.Body;
    body.setCircle(14, 2, 2);
    body.reset(c.x, c.y);
    p.setVisible(false);
    this.lastCar = { v: 0, w: 0, t: 0 };
    this.say("Driving: W/S gas-brake, A/D steer, E exit");
    this.sendCar(this.time.now, true);
    this.sendPos(this.time.now, true);
  }

  private exitCar(silent = false) {
    const c = this.driving;
    if (!c) return;
    const p = this.player;
    let nx = p.x,
      ny = p.y;
    for (let i = 0; i < 8; i++) {
      // primul loc liber langa portiera
      const a = c.a + Math.PI / 2 + (i * Math.PI) / 4,
        x = p.x + Math.cos(a) * 34,
        y = p.y + Math.sin(a) * 34;
      if (!this.isWall(x, y)) {
        nx = x;
        ny = y;
        break;
      }
    }
    this.driving = null;
    this.carV = 0;
    c.v = 0;
    c.w = 0;
    c.d = "";
    c.x = p.x;
    c.y = p.y;
    c.dx = p.x;
    c.dy = p.y;
    c.t = this.time.now;
    const body = p.body as Phaser.Physics.Arcade.Body;
    body.setCircle(9, 7, 7);
    body.reset(nx, ny);
    p.setVisible(true);
    void this.net.send("car", this.carMsg(c));
    this.sendPos(this.time.now, true);
    if (!silent) this.say("You got out of the car");
  }

  // Miscarea masinii: viteza scalara + directie; coliziunea cu peretii o face fizica Arcade (corpul jucatorului e mai mare in masina)
  private drive(dt: number, now: number) {
    const c = this.driving!,
      p = this.player,
      k = this.keys,
      a = this.arrows,
      body = p.body as Phaser.Physics.Arcade.Body;
    const up = k.W.isDown || a.up.isDown,
      down = k.S.isDown || a.down.isDown;
    const left = k.A.isDown || a.left.isDown,
      right = k.D.isDown || a.right.isDown;
    const s = dt / 1000;
    c.x = p.x;
    c.y = p.y;
    c.dx = p.x;
    c.dy = p.y;

    if (up) this.carV = Math.min(CAR_MAX, this.carV + CAR_ACC * s);
    else if (down)
      this.carV =
        this.carV > 0
          ? Math.max(0, this.carV - CAR_BRAKE * s)
          : Math.max(-CAR_REV, this.carV - CAR_ACC * 0.6 * s);
    else
      this.carV -=
        Math.sign(this.carV) * Math.min(Math.abs(this.carV), CAR_DRAG * s);
    if (!body.touching.none && Math.abs(this.carV) > 60) this.carV *= 0.35; // te-ai lovit de un perete

    const steer = (right ? 1 : 0) - (left ? 1 : 0);
    const w =
      steer *
      CAR_TURN *
      Math.min(1, Math.abs(this.carV) / 120) *
      (this.carV < 0 ? -1 : 1);
    c.a += w * s;
    body.velocity.set(Math.cos(c.a) * this.carV, Math.sin(c.a) * this.carV);
    c.v = this.carV;
    c.w = w;
    c.t = now;
    c.img.setPosition(c.x, c.y).setRotation(c.a).setVisible(true);
  }

  // Trimitem starea masinii cand se schimba viteza / viraj, plus semnal la 1s (dead reckoning la ceilalti)
  private sendCar(now: number, force = false) {
    const c = this.driving;
    if (!c) return;
    const changed =
      Math.abs(c.v - this.lastCar.v) > 40 ||
      Math.abs(c.w - this.lastCar.w) > 0.3;
    if (
      force ||
      (changed && now - this.lastCar.t >= 150) ||
      now - this.lastCar.t >= 1000
    ) {
      this.lastCar = { v: c.v, w: c.w, t: now };
      void this.net.send("car", this.carMsg(c));
    }
  }

  private onCar(m: CarMsg) {
    const c = this.cars[m.id];
    if (!c) return;
    if (c === this.driving) {
      // doi jucatori au furat aceeasi masina simultan: cel cu id mai mic o pastreaza
      if (m.d && m.d !== this.cfg.me.id && m.d < this.cfg.me.id) this.exitCar();
      return;
    }
    Object.assign(c, {
      x: m.x,
      y: m.y,
      a: m.a,
      v: m.v,
      w: m.w,
      d: m.d,
      t: this.time.now,
      moved: true,
    });
  }

  // Masinile celorlalti: extrapolare + netezire; cele parcate stau pe loc. Victim-authoritative: masina care vine spre tine te loveste.
  private updateCars(dt: number, now: number) {
    const k = 1 - Math.exp(-dt / 90),
      me = this.cfg.me.id;
    for (const c of this.cars) {
      if (c === this.driving) continue;
      if (c.d && now - c.t > STALE_MS) {
        c.d = "";
        c.v = 0;
        c.w = 0;
      }
      let tx = c.x,
        ty = c.y,
        ta = c.a;
      if (c.d) {
        const ahead = Math.min(now - c.t, 1500) / 1000;
        ta = c.a + c.w * ahead;
        tx = c.x + Math.cos((c.a + ta) / 2) * c.v * ahead;
        ty = c.y + Math.sin((c.a + ta) / 2) * c.v * ahead;
        if (this.isWall(tx, ty)) {
          tx = c.x;
          ty = c.y;
        }
      }
      c.dx += (tx - c.dx) * k;
      c.dy += (ty - c.dy) * k;
      c.da += Phaser.Math.Angle.Wrap(ta - c.da) * k;
      c.img
        .setPosition(c.dx, c.dy)
        .setRotation(c.da)
        .setVisible(this.see(c.dx, c.dy));

      if (
        c.d &&
        c.d !== me &&
        Math.abs(c.v) > 140 &&
        !this.driving &&
        !this.dying &&
        now > this.protectedUntil &&
        now > this.carHitAt &&
        Phaser.Math.Distance.Between(c.dx, c.dy, this.player.x, this.player.y) <
          26
      ) {
        this.carHitAt = now + 700;
        this.hurt(
          Math.round((32 * Math.abs(c.v)) / CAR_MAX),
          c.d,
          Math.cos(c.a) * c.v,
          Math.sin(c.a) * c.v,
        );
      }
    }
  }

  // ---------- sange si cadavre ----------
  private splat(x: number, y: number, wall: boolean, scale = 1) {
    const img = this.add
      .image(x, y, wall ? "bloodw" : "blood")
      .setDepth(wall ? 2.5 : 1.5)
      .setRotation(wall ? 0 : Math.random() * 6.28)
      .setScale((0.5 + Math.random() * 0.9) * scale)
      .setAlpha(0.55 + Math.random() * 0.35);
    this.decals.push(img);
    if (this.decals.length > MAX_DECALS) this.decals.shift()!.destroy();
  }

  // Stropi zburand in directia (vx,vy): se opresc pe podea (balta) sau pe primul perete (dara)
  private blood(
    x: number,
    y: number,
    vx: number,
    vy: number,
    n = 9,
    spread = 1.1,
  ) {
    const a0 = Math.atan2(vy, vx);
    for (let i = 0; i < n; i++) {
      const a = a0 + (Math.random() - 0.5) * spread,
        d = 14 + Math.random() * 46;
      let ex = x,
        ey = y,
        wall = false;
      for (let s = 4; s <= d; s += 4) {
        ex = x + Math.cos(a) * s;
        ey = y + Math.sin(a) * s;
        if (this.isWall(ex, ey)) {
          wall = true;
          break;
        }
      }
      const drop = this.add
        .image(x, y, "dot")
        .setDepth(6)
        .setTint(0xb71c1c)
        .setScale(0.6 + Math.random() * 0.6);
      this.tweens.add({
        targets: drop,
        x: ex,
        y: ey,
        duration: 90 + d * 2,
        onComplete: () => {
          drop.destroy();
          this.splat(ex, ey, wall);
        },
      });
    }
  }

  private addCorpse(x: number, y: number, name: string) {
    const g = this.add
      .image(x, y, "corpse")
      .setDepth(2.8)
      .setRotation(Math.random() * 6.28)
      .setVisible(false);
    const label = this.add
      .text(x, y - 18, `† ${name}`, {
        font: "11px monospace",
        color: "#ff8a80",
      })
      .setOrigin(0.5)
      .setDepth(6)
      .setVisible(false);
    this.corpses.push({ g, label, until: this.time.now + CORPSE_MS, x, y });
    this.splat(x, y, false, 2.2);
    this.blood(x, y, 0, 0, 16, Math.PI * 2);
  }

  private updateCorpses(now: number) {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      if (now > c.until) {
        c.g.destroy();
        c.label.destroy();
        this.corpses.splice(i, 1);
        continue;
      }
      const v = this.see(c.x, c.y);
      c.g.setVisible(v);
      c.label.setVisible(v);
    }
  }

  // ---------- trimitere pozitie (dead reckoning: trimitem doar la schimbare de directie + corectie rara) ----------
  private sendPos(now: number, force = false) {
    const b = this.player.body as Phaser.Physics.Arcade.Body;
    const drv = !!this.driving; // in masina pozitia vine din mesajele `car`; aici doar semnal de viata
    const vx = drv ? 0 : Math.round(b.velocity.x),
      vy = drv ? 0 : Math.round(b.velocity.y);
    const moving = vx !== 0 || vy !== 0;
    const n = this.humans() + 1;
    // Fiecare mesaj ajunge la (n-1) clienti si toate sunt numarate (plafon 100/s pe Free) => rata de corectie scade cu n^2
    const correct = Phaser.Math.Clamp(
      ((n * n * 1000) / MSG_BUDGET) * 6,
      1000,
      5000,
    );
    const changed = vx !== this.last.vx || vy !== this.last.vy;
    const elapsed = now - this.last.t;
    if (
      force ||
      (changed && elapsed >= POS_MIN_MS) ||
      elapsed >= (moving ? correct : HEARTBEAT_MS)
    ) {
      this.last = { vx, vy, t: now };
      const m: PosMsg = {
        id: this.cfg.me.id,
        n: this.cfg.me.name,
        x: Math.round(this.player.x),
        y: Math.round(this.player.y),
        vx,
        vy,
        hp: this.hp,
      };
      void this.net.send("pos", m);
    }
  }

  // ---------- jucatori la distanta ----------
  private onPos(m: PosMsg) {
    if (m.id === this.cfg.me.id) return;
    if (isBot(m.id) && !m.id.startsWith(`bot:${this.hostSeen}:`)) return; // boti de la un host vechi
    let r = this.remotes.get(m.id);
    if (!r) {
      r = {
        g: this.add
          .image(m.x, m.y, "remote")
          .setDepth(4)
          .setTint(isBot(m.id) ? 0xff8a65 : 0xffffff),
        label: this.add
          .text(m.x, m.y - 24, m.n, {
            font: "11px monospace",
            color: "#ffffff",
          })
          .setOrigin(0.5)
          .setDepth(6),
        n: m.n,
        x: m.x,
        y: m.y,
        vx: m.vx,
        vy: m.vy,
        hp: m.hp,
        t: this.time.now,
        dx: m.x,
        dy: m.y,
      };
      this.remotes.set(m.id, r);
    }
    Object.assign(r, {
      n: m.n,
      x: m.x,
      y: m.y,
      vx: m.vx,
      vy: m.vy,
      hp: m.hp,
      t: this.time.now,
    });
  }

  private updateRemotes(dt: number, now: number) {
    const k = 1 - Math.exp(-dt / 90);
    for (const [id, r] of this.remotes) {
      if (now - r.t > STALE_MS) {
        this.removeRemote(id);
        continue;
      }
      const car = this.cars.find((c) => c.d === id); // soferii stau in masina: pozitia vine de la ea
      if (car) {
        r.dx = car.dx;
        r.dy = car.dy;
      } else {
        const ahead = Math.min(now - r.t, 1500) / 1000; // extrapolam max 1.5s
        let tx = r.x + r.vx * ahead,
          ty = r.y + r.vy * ahead;
        if (this.isWall(tx, ty)) {
          tx = r.x;
          ty = r.y;
        }
        r.dx += (tx - r.dx) * k;
        r.dy += (ty - r.dy) * k;
      }
      const vis = this.see(r.dx, r.dy);
      r.g.setPosition(r.dx, r.dy).setVisible(vis && !car);
      if (!car && (r.vx || r.vy)) r.g.setRotation(Math.atan2(r.vy, r.vx));
      r.label.setPosition(r.dx, r.dy - 24).setVisible(vis);
      if (vis) {
        this.bar
          .fillStyle(0x000000, 0.6)
          .fillRect(r.dx - 16, r.dy - 18, 32, 4)
          .fillStyle(0xe53935)
          .fillRect(r.dx - 16, r.dy - 18, (32 * Math.max(0, r.hp)) / HP_MAX, 4);
      }
    }
  }

  private removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    for (const c of this.cars)
      if (c.d === id && c !== this.driving) {
        c.d = "";
        c.v = 0;
        c.w = 0;
      } // soferul a plecat: masina ramane parcata
    r.g.destroy();
    r.label.destroy();
    this.remotes.delete(id);
  }

  // ---------- tragere ----------
  private aimAndShoot(now: number) {
    if (this.driving) return;
    const ptr = this.input.activePointer;
    const w = ptr.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const p = this.player;
    const raw = this.aim(w);
    if (raw.x || raw.y) p.setRotation(Math.atan2(raw.y, raw.x));
    const g = this.gun();
    const { d, lock } = this.assist(raw, w, (g.speed * g.life) / 1000);
    if (!this.inv && !this.shop && (raw.x || raw.y)) {
      // linie fina spre cursor (se opreste in primul perete) + cerculet la capat; capatul devine portocaliu cand tinta e "agatata"
      const full = lock ? lock.dist : Phaser.Math.Distance.Between(p.x, p.y, w.x, w.y);
      let len = 16;
      while (len < full && !this.isShot(p.x + d.x * len, p.y + d.y * len))
        len += 8;
      len = Math.min(len, full);
      const ex = p.x + d.x * len,
        ey = p.y + d.y * len;
      this.bar
        .lineStyle(1, 0xffffff, 0.2)
        .lineBetween(p.x + d.x * 14, p.y + d.y * 14, ex, ey)
        .lineStyle(1, lock ? 0xff7043 : 0xffffff, lock ? 0.8 : 0.45)
        .strokeCircle(ex, ey, lock ? 7 : 5);
    }
    if (
      !this.inv &&
      !this.shop &&
      !this.reloading &&
      ptr.isDown &&
      now - this.lastShot >= g.fire
    ) {
      this.lastShot = now;
      if (d.x === 0 && d.y === 0) return;
      if (this.magNow() <= 0) {
        this.startReload();
        return;
      } // incarcator gol: reincarca automat
      this.mag.set(this.wkey(), this.magNow() - 1);
      const m: ShotMsg = {
        id: this.cfg.me.id,
        x: Math.round(p.x + d.x * 12),
        y: Math.round(p.y + d.y * 12),
        dx: +d.x.toFixed(3),
        dy: +d.y.toFixed(3),
        dm: g.dmg,
        sp: g.speed,
        lf: g.life,
        n: g.pellets,
        sg: g.spread,
        sd: Math.floor(Math.random() * 1e6),
      };
      this.spawnShot(m);
      this.burst(m.x, m.y, 0xffee58, 3);
      void this.net.send("shot", m); // un singur mesaj, chiar si pentru shotgun: alicele se deduc din seed
      if (this.magNow() <= 0) this.startReload();
    }
  }

  // Linie libera (fara pereti care opresc gloantele) intre doua puncte
  private clearLine(x0: number, y0: number, x1: number, y1: number) {
    const dx = x1 - x0,
      dy = y1 - y0,
      n = Math.ceil(Math.hypot(dx, dy) / 8);
    for (let i = 1; i < n; i++)
      if (this.isShot(x0 + (dx * i) / n, y0 + (dy * i) / n)) return false;
    return true;
  }

  // Aim assist: cel mai apropiat inamic vizibil de cursor (in ASSIST_R px), cu linie libera si in raza armei, atrage directia de tragere.
  // `lock` = inamicul agatat (distanta pana la el) sau null; `d` = directia finala.
  private assist(
    d: Phaser.Math.Vector2,
    w: { x: number; y: number },
    range: number,
  ) {
    if (!d.x && !d.y) return { d, lock: null };
    const p = this.player;
    let best: { x: number; y: number; m: number } | null = null;
    const test = (x: number, y: number) => {
      const m = Phaser.Math.Distance.Between(x, y, w.x, w.y);
      if (m > ASSIST_R || (best && m >= best.m)) return;
      const dist = Phaser.Math.Distance.Between(x, y, p.x, p.y);
      if (dist < 20 || dist > range || !this.clearLine(p.x, p.y, x, y)) return;
      best = { x, y, m };
    };
    for (const bot of this.bots.values())
      if (bot.hp > 0 && this.see(bot.x, bot.y)) test(bot.x, bot.y);
    for (const r of this.remotes.values())
      if (r.hp > 0 && r.g.visible) test(r.dx, r.dy);
    const t = best as { x: number; y: number; m: number } | null;
    if (!t) return { d, lock: null };
    const k = ASSIST_MAX * Phaser.Math.Clamp((ASSIST_R - t.m) / (ASSIST_R - 8), 0, 1);
    const to = new Phaser.Math.Vector2(t.x - p.x, t.y - p.y);
    const dist = to.length();
    to.normalize();
    const out = new Phaser.Math.Vector2(
      d.x * (1 - k) + to.x * k,
      d.y * (1 - k) + to.y * k,
    ).normalize();
    return { d: out, lock: { dist } };
  }

  private aim(w: { x: number; y: number }) {
    const v = new Phaser.Math.Vector2(w.x - this.player.x, w.y - this.player.y);
    return v.lengthSq() ? v.normalize() : v;
  }

  private spawnShot(m: ShotMsg) {
    const mine = m.id === this.cfg.me.id;
    const rng = rngFrom(String(m.sd ?? 0)),
      base = Math.atan2(m.dy, m.dx),
      sg = m.sg ?? 0.04,
      sp = m.sp ?? BULLET_SPEED;
    for (let i = 0; i < (m.n ?? 1); i++) {
      const a = base + (rng() - 0.5) * 2 * sg;
      this.bullets.push({
        g: this.add
          .image(m.x, m.y, "bullet")
          .setDepth(4)
          .setTint(mine ? 0xffee58 : 0xff7043)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setRotation(a),
        x: m.x,
        y: m.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: m.lf ?? BULLET_LIFE_MS,
        owner: m.id,
        dm: m.dm ?? DAMAGE,
      });
    }
  }

  private onShot(m: ShotMsg) {
    if (m.id !== this.cfg.me.id) this.spawnShot(m);
  }

  // Fiecare client simuleaza toate gloantele; DOAR victima aplica damage-ul pe ea insasi (victim-authoritative)
  private updateBullets(dt: number, now: number) {
    const s = dt / 1000,
      me = this.cfg.me.id;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const ox = b.x,
        oy = b.y;
      b.x += b.vx * s;
      b.y += b.vy * s;
      b.life -= dt;
      b.g
        .setPosition(b.x, b.y)
        .setVisible(b.owner === me || this.see(b.x, b.y));
      let gone = b.life <= 0 || this.isShot(b.x, b.y);
      if (!gone && this.hostSeen === me && !isBot(b.owner)) {
        // hostul aplica damage-ul pe boti
        for (const bot of this.bots.values()) {
          if (segDist(bot.x, bot.y, ox, oy, b.x, b.y) < HIT_R) {
            gone = true;
            this.hitBot(bot, b.owner, b.dm);
            this.blood(b.x, b.y, b.vx, b.vy);
            break;
          }
        }
      }
      if (!gone) {
        for (const [id, r] of this.remotes) {
          if (id === b.owner || (isBot(id) && isBot(b.owner))) continue;
          if (segDist(r.dx, r.dy, ox, oy, b.x, b.y) < HIT_R) {
            gone = true;
            this.blood(b.x, b.y, b.vx, b.vy);
            break;
          }
        }
      }
      if (
        !gone &&
        b.owner !== me &&
        now > this.protectedUntil &&
        !this.dying &&
        segDist(this.player.x, this.player.y, ox, oy, b.x, b.y) < HIT_R
      ) {
        gone = true;
        this.hurt(b.dm, b.owner, b.vx, b.vy);
      }
      if (gone) {
        if (b.life > 0 && b.g.visible) this.burst(b.x, b.y, 0xffcc80, 5); // impact (nu si pentru gloante nevazute)
        b.g.destroy();
        this.bullets.splice(i, 1);
      }
    }
  }

  // Damage primit (glont sau masina); armura reduce damage-ul
  private hurt(dm: number, by: string, vx: number, vy: number) {
    if (this.dying) return;
    this.hp = Math.max(
      0,
      this.hp - Math.max(1, Math.round(dm * (1 - this.armor()))),
    );
    this.healing = null; // heal-ul se intrerupe cand esti lovit
    this.stealing = null;
    this.drawHp();
    this.blood(this.player.x, this.player.y, vx, vy);
    this.cameras.main.shake(120, 0.006);
    this.hud.root.classList.remove("hit");
    void this.hud.root.offsetWidth; // restart animatie
    this.hud.root.classList.add("hit");
    this.player.setTint(0xff5555);
    this.time.delayedCall(
      120,
      () => this.player.active && this.player.clearTint(),
    );
    this.sendPos(this.time.now, true);
    if (this.hp <= 0) void this.die(by, false);
  }

  // Alt jucator a luat iteme dintr-un container: le scoatem si la noi (operatie comutativa, deci ordinea nu conteaza)
  private onLooted(m: LootedMsg) {
    const c = this.byId.get(m.k);
    if (!c) return;
    for (const t of m.taken) {
      const i = c.items.findIndex((x) => x.item_type === t.item_type);
      if (i >= 0) c.items.splice(i, 1);
    }
    this.touched.add(m.k);
    this.recolor(c);
    this.refreshChest(c);
  }

  private refreshChest(c: Container) {
    if (c !== this.chestC) return;
    this.syncChest();
    this.inv?.render();
  }

  // ---------- moarte / drop ----------
  private onDead(m: DeadMsg) {
    const name = m.n ?? this.remotes.get(m.id)?.n ?? "Player";
    this.removeRemote(m.id);
    if (m.id === this.cfg.me.id) return;
    this.addCorpse(m.x, m.y, name);
    this.addDrop(m);
    const killer = m.by
      ? m.by === this.cfg.me.id
        ? "you"
        : (this.remotes.get(m.by)?.n ?? "someone")
      : null;
    this.say(
      killer === "you"
        ? "You eliminated a player! Search their loot (E)"
        : "A player died: their loot is on the ground (E)",
    );
  }

  // Cheie unica per moarte (`did`): acelasi jucator poate muri de mai multe ori si lasa de fiecare data loot
  private addDrop(m: DeadMsg) {
    const k = `d${m.did ?? m.id}`;
    if (this.byId.has(k) || !m.loot.length) return;
    const tx = Math.floor(m.x / TILE),
      ty = Math.floor(m.y / TILE);
    const c: Container = {
      x: tx,
      y: ty,
      px: m.x,
      py: m.y,
      zone: zoneAt(tx, ty),
      items: m.loot.map((l) => ({ ...l })),
    };
    this.map.containers.push(c);
    this.register(k, c);
    this.drops.set(k, m);
    this.boxes.set(
      c,
      this.add.image(m.x, m.y, "drop").setDepth(3).setVisible(false),
    );
  }

  // ---------- jucator nou in sesiune ----------
  private onHello(to: string) {
    const containers: Record<string, Loot[]> = {};
    for (const k of this.touched) {
      const c = this.byId.get(k);
      if (c) containers[k] = c.items;
    }
    const cars = this.cars.filter((c) => c.moved).map((c) => this.carMsg(c));
    void this.net.send("state", {
      to,
      e: this.epoch,
      containers,
      drops: [...this.drops.values()],
      doors: [...this.opened],
      cars,
    } satisfies StateMsg);
    this.sendPos(this.time.now, true);
  }

  private onState(m: StateMsg) {
    if (m.to !== this.cfg.me.id) return;
    m.drops.forEach((d) => this.addDrop(d));
    m.cars?.forEach((c) => this.onCar(c));
    if (m.e !== this.epoch) return; // starea containerelor e valabila doar in acelasi epoch de loot
    for (const [k, items] of Object.entries(m.containers)) {
      const c = this.byId.get(k);
      if (c) {
        c.items = items;
        this.touched.add(k);
        this.recolor(c);
        this.refreshChest(c);
      }
    }
    m.doors?.forEach((id) => this.setOpen(id, true));
  }

  // ---------- boti (simulati doar de host = cel mai mic id dintre jucatori; ceilalti ii primesc ca `pos` cu id bot:<host>:<n>) ----------
  private humans() {
    return [...this.remotes.keys()].filter((id) => !isBot(id)).length;
  }

  private electHost() {
    const me = this.cfg.me.id;
    const h = [
      me,
      ...[...this.remotes.keys()].filter((id) => !isBot(id)),
    ].sort()[0];
    if (h === this.hostSeen) return;
    this.hostSeen = h;
    for (const id of [...this.remotes.keys()])
      if (isBot(id)) this.removeRemote(id);
    this.bots.clear();
    if (h === me) for (let i = 0; i < BOT_COUNT; i++) this.spawnBot();
  }

  private spawnBot() {
    const me = this.cfg.me.id;
    if (this.hostSeen !== me) return;
    for (let i = 0; i < 50; i++) {
      const tx = 2 + Math.floor(Math.random() * (W - 4)),
        ty = 2 + Math.floor(Math.random() * (H - 4));
      if (zoneAt(tx, ty) === "green" || this.wallSet.has(ty * 1000 + tx))
        continue;
      const id = `bot:${me}:${this.botSeq++}`;
      this.bots.set(id, {
        id,
        x: mid(tx),
        y: mid(ty),
        hp: HP_MAX,
        dir: { x: 0, y: 0 },
        turn: 0,
        shot: 0,
        go: null,
        last: { vx: 0, vy: 0, t: 0 },
      });
      return;
    }
  }

  // shortcut: fara pathfinding, botii se pot bloca dupa pereti; upgrade: A* pe grila de tile-uri
  private updateBots(dt: number, now: number) {
    const s = dt / 1000;
    const people = [...this.remotes]
      .filter(([id]) => !isBot(id))
      .map(([, r]) => ({ x: r.dx, y: r.dy }));
    if (!this.dying) people.push({ x: this.player.x, y: this.player.y });
    for (const b of this.bots.values()) {
      let tgt: { x: number; y: number } | null = null,
        best = BOT_SIGHT;
      for (const h of people) {
        const d = Math.hypot(h.x - b.x, h.y - b.y);
        // acelasi raycast ca vizibilitatea jucatorului: peretii blocheaza vederea botului
        if (
          d > 1 &&
          d < best &&
          this.cast(b.x, b.y, (h.x - b.x) / d, (h.y - b.y) / d, d) >= d
        ) {
          tgt = h;
          best = d;
        }
      }
      let dx = 0,
        dy = 0;
      if (tgt) {
        if (best > BOT_KEEP) {
          dx = (tgt.x - b.x) / best;
          dy = (tgt.y - b.y) / best;
        }
        if (now - b.shot >= BOT_FIRE_MS) {
          b.shot = now;
          const a =
            Math.atan2(tgt.y - b.y, tgt.x - b.x) + (Math.random() - 0.5) * 0.3;
          const m: ShotMsg = {
            id: b.id,
            x: Math.round(b.x + Math.cos(a) * 12),
            y: Math.round(b.y + Math.sin(a) * 12),
            dx: +Math.cos(a).toFixed(3),
            dy: +Math.sin(a).toFixed(3),
          };
          this.spawnShot(m);
          void this.net.send("shot", m);
        }
      } else if (b.go && now < b.go.until) {
        const d = Math.hypot(b.go.x - b.x, b.go.y - b.y);
        if (d < 24) b.go = null;
        else {
          dx = (b.go.x - b.x) / d;
          dy = (b.go.y - b.y) / d;
        }
      } else {
        if (now > b.turn) {
          const a = Math.random() * Math.PI * 2;
          b.dir =
            Math.random() < 0.2
              ? { x: 0, y: 0 }
              : { x: Math.cos(a), y: Math.sin(a) };
          b.turn = now + 1500 + Math.random() * 2000;
        }
        dx = b.dir.x;
        dy = b.dir.y;
      }
      const nx = b.x + dx * BOT_SPEED * s,
        ny = b.y + dy * BOT_SPEED * s;
      let vx = 0,
        vy = 0;
      if (!this.isWall(nx + Math.sign(dx) * 10, b.y)) {
        b.x = nx;
        vx = dx * BOT_SPEED;
      }
      if (!this.isWall(b.x, ny + Math.sign(dy) * 10)) {
        b.y = ny;
        vy = dy * BOT_SPEED;
      }
      if ((dx || dy) && !vx && !vy) b.turn = 0; // blocat: alege alta directie

      const m: PosMsg = {
        id: b.id,
        n: "Bot",
        x: Math.round(b.x),
        y: Math.round(b.y),
        vx: Math.round(vx),
        vy: Math.round(vy),
        hp: b.hp,
      };
      this.onPos(m); // hostul isi vede botii prin aceeasi cale ca ceilalti
      const l = b.last;
      if (
        ((m.vx !== l.vx || m.vy !== l.vy) && now - l.t >= 400) ||
        now - l.t >= 2000
      ) {
        b.last = { vx: m.vx, vy: m.vy, t: now };
        void this.net.send("pos", m);
      }
    }
  }

  private hitBot(b: Bot, by: string, dm: number) {
    b.hp -= dm;
    if (b.hp > 0) return;
    this.bots.delete(b.id);
    const zone = zoneAt(Math.floor(b.x / TILE), Math.floor(b.y / TILE));
    const m: DeadMsg = {
      id: b.id,
      x: Math.round(b.x),
      y: Math.round(b.y),
      loot: rollItems(Math.random, zone, [...this.cfg.defs.values()]),
      by,
      n: "Bot",
      did: Math.random().toString(36).slice(2, 8),
    };
    this.onDead(m);
    void this.net.send("dead", m);
    this.time.delayedCall(BOT_RESPAWN_MS, () => this.spawnBot());
  }

  private onAlarm(m: AlarmMsg) {
    this.say("ALARM! Someone took a legendary item");
    for (const b of this.bots.values()) {
      if (Math.hypot(b.x - m.x, b.y - m.y) < ALARM_R)
        b.go = { x: m.x, y: m.y, until: this.time.now + 20000 };
    }
  }

  // ---------- efecte / UI / reset ----------
  private burst(x: number, y: number, tint: number, n: number) {
    for (let i = 0; i < n; i++) {
      const s = this.add
        .image(x, y, "dot")
        .setDepth(6)
        .setTint(tint)
        .setBlendMode(Phaser.BlendModes.ADD);
      const a = Math.random() * Math.PI * 2,
        d = 8 + Math.random() * 14;
      this.tweens.add({
        targets: s,
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        alpha: 0,
        duration: 250,
        onComplete: () => s.destroy(),
      });
    }
  }

  private drawHp() {
    this.lastHud = "";
    this.updateHud();
  } // HUD-ul se redeseneaza imediat dupa schimbarea vietii

  // Loot nou in containerele hartii (si usile se reincuie); drop-urile jucatorilor raman
  private resetLoot() {
    this.epoch = epochNow();
    rerollLoot(
      this.map,
      this.epoch,
      [...this.cfg.defs.values()],
      this.baseCount,
    );
    for (const k of this.touched) if (k[0] === "c") this.touched.delete(k);
    for (const c of this.map.containers.slice(0, this.baseCount))
      this.boxes.get(c)?.setTexture("box");
    for (const id of [...this.opened]) {
      // nu relocam o usa in care stai (ai ramane blocat in perete)
      const near = this.lockObjs.some(
        (o) =>
          o.l.id === id &&
          Math.hypot(mid(o.l.x) - this.player.x, mid(o.l.y) - this.player.y) <
            80,
      );
      if (!near) this.setOpen(id, false);
    }
    if (this.chestC) this.refreshChest(this.chestC);
    this.say("Loot reset across the city!");
  }

  // ---------- finalul raidului ----------
  private async finish(note: string, failed = false) {
    window.removeEventListener("keydown", this.onKey);
    this.closeInv();
    this.closeShop();
    this.hud.root.remove();
    this.net.leave();
    this.cfg.end(note, failed);
  }

  private async die(by: string | null, abandoned: boolean) {
    if (this.dying) return;
    this.dying = true;
    this.busy = true;
    this.healing = null;
    this.reloading = null;
    this.stealing = null;
    if (this.driving) this.exitCar(true);
    this.closeInv();
    this.closeShop();
    const loot: Loot[] = this.packItems().map((i) => ({
      item_type: i.type,
      quantity: i.qty,
    })); // tot ce ai asupra ta cade pe jos
    await this.net.send("dead", {
      id: this.cfg.me.id,
      x: Math.round(this.player.x),
      y: Math.round(this.player.y),
      loot,
      by,
      n: this.cfg.me.name,
      did: Math.random().toString(36).slice(2, 8),
    } satisfies DeadMsg);
    const { data, error } = await rpcRetry(
      "die_in_raid",
      { p_raid_id: this.cfg.raidId },
      8,
    );
    if (error && !error.message.includes("not in raid")) {
      // retea cazuta: hub-ul arata ecranul de recuperare (reintra / abandoneaza) in loc sa te blocheze in bucla
      return this.finish(`Network error on exit (${error.message}).`, true);
    }
    const lost = error ? 0 : data;
    const who = by ? ` by ${this.remotes.get(by)?.n ?? "a player"}` : "";
    await this.finish(
      error
        ? "The raid had already ended."
        : abandoned
          ? `You abandoned the raid. You lost ${lost} items.`
          : `You were eliminated${who}. You lost ${lost} items.`,
    );
  }

  private async extract() {
    this.busy = true;
    this.closeInv();
    this.closeShop();
    // stack-urile mari se trimit in bucati de max MAX_STACK (limita pe rand din extract_player)
    let loot: Loot[] = this.packItems()
      .filter((i) => i.found && i.qty > 0)
      .flatMap((i) => {
        const out: Loot[] = [];
        for (let q = i.qty; q > 0; q -= MAX_STACK)
          out.push({ item_type: i.type, quantity: Math.min(MAX_STACK, q) });
        return out;
      });
    let xp = this.xp;
    let { data, error } = await rpcRetry(
      "extract_player",
      { p_raid_id: this.cfg.raidId, p_loot: loot, p_xp: xp },
      5,
    );
    // Serverul refuza loot-ul (limita din SQL): nu te lasam blocat in raid, poti iesi doar cu itemele aduse
    if (
      error &&
      /limit|exceed/i.test(error.message) &&
      (await this.ask({
        title: "The server rejected the loot",
        text: "The limit in the SQL function extract_player rejected the items you found. You can only extract with the items you brought; the loot found in this raid is lost.",
        ok: "Extract without loot",
        cancel: "Stay in the raid",
        danger: true,
      }))
    ) {
      loot = [];
      xp = 0;
      ({ data, error } = await rpcRetry(
        "extract_player",
        { p_raid_id: this.cfg.raidId, p_loot: loot, p_xp: xp },
        5,
      ));
    }
    if (error) {
      if (error.message.includes("not in raid"))
        return this.finish("The raid had already ended.");
      this.busy = false;
      this.extractMs = 0;
      this.blockedUntil = this.time.now + 4000;
      return this.say(
        error.message.includes("not extractable")
          ? "Extraction opens 60s after entering"
          : error.message,
      );
    }
    const full = data?.skipped_stash_full
      ? ` (${data.skipped_stash_full} lost: stash full)`
      : "";
    await this.net.send("gone", { id: this.cfg.me.id });
    await this.finish(
      `Extraction successful! +${xp} xp, ${loot.length} items saved${full}`,
    );
  }
}

export async function runRaid(
  parent: HTMLElement,
  raidId: string,
  code: string,
  me: { id: string; name: string },
  end: (note: string, failed?: boolean) => void,
) {
  let defs, brought, prof;
  try {
    [defs, brought, prof] = await Promise.all([
      supabase.from("item_defs").select("*"),
      supabase
        .from("stash_items")
        .select("id,item_type,quantity")
        .eq("raid_id", raidId),
      supabase.from("profiles").select("money").eq("id", me.id).single(),
    ]);
  } catch (e) {
    return end(
      `Cannot load the raid: ${String((e as Error)?.message ?? e)}`,
      true,
    );
  }
  if (!defs.data || !brought.data)
    return end(
      defs.error?.message ?? brought.error?.message ?? "Cannot load the raid",
      true,
    );

  registerDefs(defs.data as Def[]); // armuri / arme / heal / chei din baza de date devin utilizabile
  // Ecran complet: containerul acopera toata fereastra, canvas-ul se redimensioneaza odata cu ea (fara bare negre)
  Object.assign(parent.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    zIndex: "5",
    background: "#000",
  });
  document.body.style.overflow = "hidden";
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#000000",
    physics: { default: "arcade" },
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
    scene: [],
  });
  const init: Init = {
    raidId,
    code,
    me,
    parent,
    money: Number(prof.data?.money ?? 0),
    defs: new Map((defs.data as ItemDef[]).map((d) => [d.item_type, d])),
    brought: brought.data,
    end: (note, failed) => {
      game.destroy(true);
      document.body.style.overflow = "";
      end(note, failed);
    },
  };
  game.scene.add("raid", RaidScene, true, init);
}