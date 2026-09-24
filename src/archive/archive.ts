import {
  DISPLACEMENT_LIMIT_MM,
  DossierStatus,
  Reading,
  ReadingInput,
  STATUS_LABEL,
  TILT_DIRECTIONS,
  TiltDirection,
  evaluateInspection,
  evaluateRetest,
  formatAt,
  timeOf,
} from "../rules/supportRules";

/** 构件档案 */
export interface Dossier {
  componentNo: string;
  building: string;
  memberType: string;
  disease: string;
  /** 贯穿裂缝构件：复测须换人、隔2小时、双方向回落 */
  throughCrack: boolean;
  status: DossierStatus;
  supportNo: string | null;
  /** 原补测尺寸；补测尺寸后原结论失效 */
  measuredSize: string | null;
  readings: Reading[];
  conclusions: Conclusion[];
}

/** 结论版本：只追加，状态推进时旧结论置 superseded */
export interface Conclusion {
  id: string;
  version: number;
  createdAt: string;
  basis: string;
  text: string;
  state: "active" | "superseded" | "invalidated";
}

export interface Support {
  supportNo: string;
  kind: string;
  componentNo: string | null;
}

export interface Event {
  id: string;
  at: string;
  type:
    | "attach"
    | "inspection"
    | "rejected"
    | "retest"
    | "resettable"
    | "supplement"
    | "replace"
    | "release"
    | "signoff";
  supportNo: string | null;
  componentNo: string;
  message: string;
  tone: "normal" | "warn" | "danger" | "ok";
}

export interface ArchiveState {
  dossiers: Record<string, Dossier>;
  supports: Support[];
  events: Event[];
}

export const EVENT_LABEL: Record<Event["type"], string> = {
  attach: "支顶",
  inspection: "巡检",
  rejected: "拒收",
  retest: "复测",
  resettable: "放行判定",
  supplement: "补测尺寸",
  replace: "换支撑",
  release: "复位放行",
  signoff: "销记",
};

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

function bump(status: DossierStatus): number {
  return status === "monitoring" ? 0 : status === "retest" ? 1 : status === "resettable" ? 2 : 3;
}

function pushConclusion(d: Dossier, createdAt: string, basis: string, text: string): void {
  for (const c of d.conclusions) {
    if (c.state === "active") c.state = "superseded";
  }
  d.conclusions.push({
    id: uid("con"),
    version: d.conclusions.length + 1,
    createdAt,
    basis,
    text,
    state: "active",
  });
}

/** 补测尺寸或换支撑后原结论失效 */
function invalidateConclusions(d: Dossier, at: string, reason: string): void {
  for (const c of d.conclusions) c.state = "invalidated";
  d.conclusions.push({
    id: uid("con"),
    version: d.conclusions.length + 1,
    createdAt: at,
    basis: reason,
    text: "原结论失效，需重新巡检评估",
    state: "active",
  });
}

function addEvent(
  events: Event[],
  at: string,
  type: Event["type"],
  supportNo: string | null,
  componentNo: string,
  message: string,
  tone: Event["tone"],
): void {
  events.unshift({ id: uid("evt"), at, type, supportNo, componentNo, message, tone });
}

function getDossier(state: ArchiveState, componentNo: string): Dossier {
  const d = state.dossiers[componentNo];
  if (!d) throw new Error(`未找到构件 ${componentNo}`);
  return d;
}

function getSupport(state: ArchiveState, supportNo: string): Support {
  const s = state.supports.find((x) => x.supportNo === supportNo);
  if (!s) throw new Error(`未找到支撑 ${supportNo}`);
  return s;
}

function freeSupport(s: Support): void {
  s.componentNo = null;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

// ---- 存档操作（规则判定来自 rules 层，原始读数与结论只追加不覆盖） ----

function attach(
  state: ArchiveState,
  supportNo: string,
  componentNo: string,
  at: string,
): ActionResult {
  const s = getSupport(state, supportNo);
  const d = getDossier(state, componentNo);
  if (s.componentNo && s.componentNo !== componentNo) {
    return {
      ok: false,
      message: `支撑 ${supportNo} 仍在支顶 ${s.componentNo}，销记前不接第二件`,
    };
  }
  if (d.supportNo && d.supportNo !== supportNo) {
    return {
      ok: false,
      message: `构件 ${componentNo} 已由 ${d.supportNo} 支顶，如需更换请走“换支撑”`,
    };
  }
  if (d.status === "released") {
    return { ok: false, message: `构件 ${componentNo} 已销记复位，不能再支顶` };
  }
  s.componentNo = componentNo;
  d.supportNo = supportNo;
  addEvent(
    state.events,
    at,
    "attach",
    supportNo,
    componentNo,
    `支撑 ${supportNo} 支顶构件 ${componentNo}`,
    "normal",
  );
  return { ok: true, message: `支撑 ${supportNo} 已支顶 ${componentNo}` };
}

function recordInspection(
  state: ArchiveState,
  componentNo: string,
  input: ReadingInput,
  at: string,
): ActionResult {
  const d = getDossier(state, componentNo);
  const prev = d.readings[d.readings.length - 1] ?? null;
  const ev = evaluateInspection(input, prev, d.throughCrack);

  if (!ev.acceptReading) {
    // 读数早于上一回：原记录保留，本次不登记，转待复测
    d.status = "retest";
    addEvent(
      state.events,
      at,
      "rejected",
      d.supportNo,
      componentNo,
      ev.reasons.join("；"),
      "danger",
    );
    return { ok: false, message: ev.title };
  }

  d.readings.push({ ...input, kind: "inspection" });
  d.status = ev.nextStatus;
  if (ev.nextStatus === "retest") {
    pushConclusion(d, at, `巡检 ${formatAt(input.at)}`, ev.title);
    addEvent(
      state.events,
      at,
      "inspection",
      d.supportNo,
      componentNo,
      `横 ${input.dx.toFixed(1)} / 纵 ${input.dy.toFixed(1)}mm，${input.tilt} —— ${ev.title}`,
      "danger",
    );
    return { ok: true, message: ev.title };
  }

  pushConclusion(d, at, `巡检 ${formatAt(input.at)}`, ev.conclusion ?? ev.title);
  addEvent(
    state.events,
    at,
    "inspection",
    d.supportNo,
    componentNo,
    `横 ${input.dx.toFixed(1)} / 纵 ${input.dy.toFixed(1)}mm，${input.tilt} —— 监测中`,
    "normal",
  );
  return { ok: true, message: ev.title };
}

function recordRetest(
  state: ArchiveState,
  componentNo: string,
  input: ReadingInput,
  at: string,
): ActionResult {
  const d = getDossier(state, componentNo);
  const prev = d.readings[d.readings.length - 1] ?? null;
  if (!prev) return { ok: false, message: "该构件尚无巡检读数，先登记巡检" };

  const ev = evaluateRetest(input, prev, d.throughCrack);
  if (!ev.acceptReading) {
    d.status = "retest";
    addEvent(
      state.events,
      at,
      "rejected",
      d.supportNo,
      componentNo,
      ev.reasons.join("；"),
      "danger",
    );
    return { ok: false, message: ev.title };
  }

  d.readings.push({ ...input, kind: "retest" });
  if (bump(ev.nextStatus) > bump(d.status) || d.status === "monitoring") {
    d.status = ev.nextStatus;
  }
  pushConclusion(d, at, `复测 ${formatAt(input.at)}`, ev.conclusion ?? ev.title);
  addEvent(
    state.events,
    at,
    ev.nextStatus === "resettable" ? "resettable" : "retest",
    d.supportNo,
    componentNo,
    `横 ${input.dx.toFixed(1)} / 纵 ${input.dy.toFixed(1)}mm，${input.tilt} —— ${ev.title}`,
    ev.nextStatus === "resettable" ? "ok" : "warn",
  );
  return { ok: true, message: ev.title };
}

function supplementSize(
  state: ArchiveState,
  componentNo: string,
  size: string,
  at: string,
): ActionResult {
  const d = getDossier(state, componentNo);
  d.measuredSize = size;
  invalidateConclusions(d, at, `补测尺寸 ${size}`);
  d.status = "retest";
  addEvent(
    state.events,
    at,
    "supplement",
    d.supportNo,
    componentNo,
    `补测尺寸 ${size}，原结论失效，转待复测`,
    "warn",
  );
  return { ok: true, message: `已补测尺寸，${componentNo} 原结论失效，转待复测` };
}

function replaceSupport(
  state: ArchiveState,
  oldSupportNo: string,
  newSupportNo: string,
  componentNo: string,
  at: string,
): ActionResult {
  if (oldSupportNo === newSupportNo) {
    return { ok: false, message: "新旧支撑编号相同，无需更换" };
  }
  const oldS = getSupport(state, oldSupportNo);
  const newS = getSupport(state, newSupportNo);
  const d = getDossier(state, componentNo);
  if (newS.componentNo && newS.componentNo !== componentNo) {
    return {
      ok: false,
      message: `支撑 ${newSupportNo} 仍在支顶 ${newS.componentNo}，销记前不接第二件`,
    };
  }
  if (oldS.componentNo !== componentNo) {
    return { ok: false, message: `支撑 ${oldSupportNo} 当前未支顶 ${componentNo}` };
  }
  freeSupport(oldS);
  newS.componentNo = componentNo;
  d.supportNo = newSupportNo;
  invalidateConclusions(d, at, `换支撑 ${oldSupportNo} → ${newSupportNo}`);
  d.status = "retest";
  addEvent(
    state.events,
    at,
    "replace",
    newSupportNo,
    componentNo,
    `换支撑 ${oldSupportNo} → ${newSupportNo}，原结论失效，转待复测`,
    "warn",
  );
  return { ok: true, message: `已换用 ${newSupportNo}，原结论失效，转待复测` };
}

function release(state: ArchiveState, componentNo: string, at: string): ActionResult {
  const d = getDossier(state, componentNo);
  if (d.status !== "resettable") {
    return { ok: false, message: `仅“${STATUS_LABEL.resettable}”构件可拆撑复位放行` };
  }
  const supportNo = d.supportNo;
  d.status = "released";
  if (supportNo) {
    const s = state.supports.find((x) => x.supportNo === supportNo);
    if (s) freeSupport(s);
  }
  d.supportNo = null;
  pushConclusion(d, at, "复位放行", "双方向回落复测通过，拆撑复位并放行，支撑销记回收");
  addEvent(
    state.events,
    at,
    "release",
    supportNo,
    componentNo,
    "双方向回落复测通过，拆撑复位放行，支撑销记回收",
    "ok",
  );
  return { ok: true, message: `${componentNo} 已拆撑复位放行，支撑销记` };
}

function signOff(state: ArchiveState, componentNo: string, at: string): ActionResult {
  const d = getDossier(state, componentNo);
  if (d.status !== "monitoring") {
    return { ok: false, message: "仅监测正常且无待办复测的构件可直接销记" };
  }
  const supportNo = d.supportNo;
  d.status = "released";
  if (supportNo) {
    const s = state.supports.find((x) => x.supportNo === supportNo);
    if (s) freeSupport(s);
  }
  d.supportNo = null;
  pushConclusion(d, at, "销记", "巡检正常，支撑销记回收，构件恢复监测归档");
  addEvent(
    state.events,
    at,
    "signoff",
    supportNo,
    componentNo,
    "巡检正常，支撑销记回收",
    "ok",
  );
  return { ok: true, message: `${componentNo} 已销记，支撑回收` };
}

// ---- 演示种子：覆盖待复测 / 可复位 / 销记占用三类清单 ----

function seed(): ArchiveState {
  const state: ArchiveState = { dossiers: {}, supports: [], events: [] };
  const D = "2026-09-24";

  state.supports = [
    { supportNo: "ZC-101", kind: "钢管支撑", componentNo: "梁架A-03" },
    { supportNo: "ZC-102", kind: "木顶撑", componentNo: "柱网C-12" },
    { supportNo: "ZC-103", kind: "可调钢支撑", componentNo: "斗拱D-07" },
    { supportNo: "ZC-104", kind: "钢管支撑", componentNo: null },
  ];

  const addD = (
    componentNo: string,
    building: string,
    memberType: string,
    disease: string,
    throughCrack: boolean,
    supportNo: string | null,
    measuredSize: string | null,
  ) => {
    state.dossiers[componentNo] = {
      componentNo,
      building,
      memberType,
      disease,
      throughCrack,
      status: "monitoring",
      supportNo,
      measuredSize,
      readings: [],
      conclusions: [],
    };
  };

  addD("梁架A-03", "正殿", "梁架", "端部贯穿裂缝", true, "ZC-101", null);
  addD("柱网C-12", "正殿", "柱网", "柱脚糟朽", false, "ZC-102", null);
  addD("斗拱D-07", "偏殿", "斗拱", "轻微变形", false, "ZC-103", null);

  attach(state, "ZC-101", "梁架A-03", `${D}T08:00`);
  attach(state, "ZC-102", "柱网C-12", `${D}T08:05`);
  attach(state, "ZC-103", "斗拱D-07", `${D}T08:10`);

  // 梁架A-03：超限 → 换人隔2小时双方向回落复测 → 可复位
  recordInspection(
    state,
    "梁架A-03",
    { at: `${D}T08:30`, inspector: "张工", dx: 4.2, dy: 1.0, tilt: "向东倾斜" },
    `${D}T08:30`,
  );
  recordRetest(
    state,
    "梁架A-03",
    { at: `${D}T10:40`, inspector: "李工", dx: 1.4, dy: 0.4, tilt: "向东倾斜" },
    `${D}T10:40`,
  );

  // 柱网C-12：正常巡检
  recordInspection(
    state,
    "柱网C-12",
    { at: `${D}T09:00`, inspector: "王工", dx: 0.8, dy: 0.6, tilt: "无明显倾斜" },
    `${D}T09:00`,
  );

  // 斗拱D-07：超限待复测（普通构件）
  recordInspection(
    state,
    "斗拱D-07",
    { at: `${D}T09:20`, inspector: "赵工", dx: 1.2, dy: 3.6, tilt: "向南倾斜" },
    `${D}T09:20`,
  );

  return state;
}

// ---- 存档单例：localStorage 持久化，页面经 useArchive 订阅 ----

const STORAGE_KEY = "hxyfront-62013-archive-v1";

function load(): ArchiveState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ArchiveState;
      if (parsed.dossiers && parsed.supports && parsed.events) return parsed;
    }
  } catch {
    // 存储不可用时退回内存种子
  }
  return seed();
}

class ArchiveStore {
  private state: ArchiveState;
  private listeners = new Set<() => void>();

  constructor() {
    this.state = load();
  }

  getSnapshot = (): ArchiveState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private commit(): void {
    this.state = structuredClone(this.state);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // 忽略持久化失败
    }
    this.listeners.forEach((l) => l());
  }

  private now(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
      d.getHours(),
    )}:${p(d.getMinutes())}`;
  }

  attach(supportNo: string, componentNo: string): ActionResult {
    const r = attach(this.state, supportNo, componentNo, this.now());
    this.commit();
    return r;
  }
  inspection(componentNo: string, input: ReadingInput): ActionResult {
    const r = recordInspection(this.state, componentNo, input, this.now());
    this.commit();
    return r;
  }
  retest(componentNo: string, input: ReadingInput): ActionResult {
    const r = recordRetest(this.state, componentNo, input, this.now());
    this.commit();
    return r;
  }
  supplement(componentNo: string, size: string): ActionResult {
    const r = supplementSize(this.state, componentNo, size, this.now());
    this.commit();
    return r;
  }
  replace(oldSupportNo: string, newSupportNo: string, componentNo: string): ActionResult {
    const r = replaceSupport(this.state, oldSupportNo, newSupportNo, componentNo, this.now());
    this.commit();
    return r;
  }
  release(componentNo: string): ActionResult {
    const r = release(this.state, componentNo, this.now());
    this.commit();
    return r;
  }
  signOff(componentNo: string): ActionResult {
    const r = signOff(this.state, componentNo, this.now());
    this.commit();
    return r;
  }
  resetDemo(): void {
    this.state = seed();
    this.commit();
  }
}

export const archiveStore = new ArchiveStore();

export { DISPLACEMENT_LIMIT_MM, TILT_DIRECTIONS, timeOf };
export type { TiltDirection };
