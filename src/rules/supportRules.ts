/**
 * 临时支撑巡检与复位放行 —— 规则层
 * 纯函数，不依赖 React 与存档实现，页面与存档共同调用。
 */

export const DISPLACEMENT_LIMIT_MM = 3;
export const RETEST_MIN_GAP_MS = 2 * 60 * 60 * 1000;

export const TILT_DIRECTIONS = [
  "无明显倾斜",
  "向东倾斜",
  "向西倾斜",
  "向南倾斜",
  "向北倾斜",
] as const;
export type TiltDirection = (typeof TILT_DIRECTIONS)[number];

export type DossierStatus = "monitoring" | "retest" | "resettable" | "released";

export const STATUS_LABEL: Record<DossierStatus, string> = {
  monitoring: "监测中",
  retest: "待复测",
  resettable: "可复位",
  released: "已销记",
};

/** 支撑销记前不接第二件：仅空闲支撑可支顶构件 */
export function canAttach(componentOnSupport: string | null): boolean {
  return componentOnSupport === null;
}

/** 仅“可复位”状态可拆撑复位放行 */
export function canRelease(status: DossierStatus): boolean {
  return status === "resettable";
}

/** 监测正常方可直接销记；待复测/可复位未闭环不得销记 */
export function canSignOff(status: DossierStatus): boolean {
  return status === "monitoring";
}

export interface ReadingInput {
  /** 巡检时刻，datetime-local 格式 yyyy-MM-ddTHH:mm */
  at: string;
  inspector: string;
  /** 横向位移 mm（带符号） */
  dx: number;
  /** 纵向位移 mm（带符号） */
  dy: number;
  tilt: TiltDirection;
}

export interface Reading extends ReadingInput {
  kind: "inspection" | "retest";
}

export interface ReadingEvaluation {
  /** 读数是否登记入档；时刻早于上一回时拒收，原记录保留 */
  acceptReading: boolean;
  nextStatus: DossierStatus;
  title: string;
  reasons: string[];
  requirements: string[];
  conclusion: string | null;
}

export function timeOf(at: string): number {
  return new Date(at).getTime();
}

export function formatAt(at: string): string {
  return at.replace("T", " ").slice(0, 16);
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}小时` : `${h}小时${m}分`;
}

function overLimitAxes(r: ReadingInput): string[] {
  const axes: string[] = [];
  if (Math.abs(r.dx) > DISPLACEMENT_LIMIT_MM) {
    axes.push(`横向位移 ${r.dx.toFixed(1)}mm 超过 ${DISPLACEMENT_LIMIT_MM}mm 限值`);
  }
  if (Math.abs(r.dy) > DISPLACEMENT_LIMIT_MM) {
    axes.push(`纵向位移 ${r.dy.toFixed(1)}mm 超过 ${DISPLACEMENT_LIMIT_MM}mm 限值`);
  }
  return axes;
}

function earlierThanPrevious(input: ReadingInput, prev: Reading): boolean {
  return timeOf(input.at) <= timeOf(prev.at);
}

/**
 * 常规巡检判定：
 * - 读数时刻早于（或等于）上一回：拒收本次读数，原记录保留，转待复测
 * - 横/纵任一方向位移超过 3mm：保留读数，转待复测
 * - 贯穿裂缝构件超限：须换人、隔 2 小时、双方向回落复测
 */
export function evaluateInspection(
  input: ReadingInput,
  prev: Reading | null,
  throughCrack: boolean,
): ReadingEvaluation {
  if (prev && earlierThanPrevious(input, prev)) {
    return {
      acceptReading: false,
      nextStatus: "retest",
      title: "读数时刻异常，转待复测",
      reasons: [
        `巡检时刻 ${formatAt(input.at)} 早于或等于上一回 ${formatAt(prev.at)}，本次读数不予登记`,
        "原巡检记录保留，不覆盖、不删除",
      ],
      requirements: ["核对巡检设备时钟后重新复测"],
      conclusion: null,
    };
  }

  const axes = overLimitAxes(input);
  if (axes.length > 0) {
    return {
      acceptReading: true,
      nextStatus: "retest",
      title: "位移超限，转待复测",
      reasons: axes,
      requirements: throughCrack
        ? [
            "贯穿裂缝构件须换由他人复测",
            `复测与本次读数间隔不少于 2 小时`,
            "横向、纵向两个方向均回落，方可拆撑复位",
          ]
        : ["重新复测，横纵位移回落至 3mm 限值内后恢复监测"],
      conclusion: null,
    };
  }

  return {
    acceptReading: true,
    nextStatus: "monitoring",
    title: "读数正常，继续监测",
    reasons: [],
    requirements: [],
    conclusion: `横纵位移均在 ${DISPLACEMENT_LIMIT_MM}mm 限值内（横 ${input.dx.toFixed(
      1,
    )} / 纵 ${input.dy.toFixed(1)}mm），倾斜：${input.tilt}`,
  };
}

export interface Gate {
  key: string;
  label: string;
  pass: boolean;
  detail: string;
}

/** 贯穿裂缝复测四项闸门：换人、隔 2 小时、横向回落、纵向回落 */
export function throughCrackGates(input: ReadingInput, prev: Reading): Gate[] {
  const gap = timeOf(input.at) - timeOf(prev.at);
  return [
    {
      key: "person",
      label: "换人复测",
      pass: input.inspector.trim() !== prev.inspector.trim() && input.inspector.trim() !== "",
      detail: `上一回 ${prev.inspector} → 本次 ${input.inspector || "未填写"}`,
    },
    {
      key: "gap",
      label: "间隔不少于2小时",
      pass: gap >= RETEST_MIN_GAP_MS,
      detail: gap > 0 ? `实际间隔 ${formatDuration(gap)}` : "时刻早于上一回",
    },
    {
      key: "fallback-x",
      label: "横向回落",
      pass: Math.abs(input.dx) < Math.abs(prev.dx),
      detail: `${Math.abs(prev.dx).toFixed(1)}mm → ${Math.abs(input.dx).toFixed(1)}mm`,
    },
    {
      key: "fallback-y",
      label: "纵向回落",
      pass: Math.abs(input.dy) < Math.abs(prev.dy),
      detail: `${Math.abs(prev.dy).toFixed(1)}mm → ${Math.abs(input.dy).toFixed(1)}mm`,
    },
  ];
}

/**
 * 复测判定：
 * - 贯穿裂缝：换人 + 隔 2 小时 + 两个方向均回落，方可复位放行；任一不满足仍待复测
 * - 普通构件：复测回落至限值内恢复监测，否则继续待复测
 */
export function evaluateRetest(
  input: ReadingInput,
  prev: Reading,
  throughCrack: boolean,
): ReadingEvaluation {
  if (earlierThanPrevious(input, prev)) {
    return {
      acceptReading: false,
      nextStatus: "retest",
      title: "复测时刻异常，维持待复测",
      reasons: [
        `复测时刻 ${formatAt(input.at)} 早于或等于上一回 ${formatAt(prev.at)}，本次读数不予登记`,
        "原巡检记录保留，不覆盖、不删除",
      ],
      requirements: ["核对巡检设备时钟后重新复测"],
      conclusion: null,
    };
  }

  if (throughCrack) {
    const gates = throughCrackGates(input, prev);
    const failed = gates.filter((g) => !g.pass);
    if (failed.length === 0) {
      return {
        acceptReading: true,
        nextStatus: "resettable",
        title: "复测通过，可拆撑复位",
        reasons: [],
        requirements: [],
        conclusion: `已换人（${prev.inspector} → ${input.inspector}）隔 ${formatDuration(
          timeOf(input.at) - timeOf(prev.at),
        )} 复测，横纵两个方向均回落，准予拆撑复位放行`,
      };
    }
    return {
      acceptReading: true,
      nextStatus: "retest",
      title: "复测未达放行条件，维持待复测",
      reasons: failed.map((g) => `${g.label}未满足（${g.detail}）`),
      requirements: [
        "贯穿裂缝构件须换由他人复测",
        "复测与本次读数间隔不少于 2 小时",
        "横向、纵向两个方向均回落，方可拆撑复位",
      ],
      conclusion: null,
    };
  }

  const axes = overLimitAxes(input);
  if (axes.length > 0) {
    return {
      acceptReading: true,
      nextStatus: "retest",
      title: "复测仍超限，维持待复测",
      reasons: axes,
      requirements: ["重新复测，横纵位移回落至 3mm 限值内后恢复监测"],
      conclusion: null,
    };
  }

  return {
    acceptReading: true,
    nextStatus: "monitoring",
    title: "复测恢复正常，恢复监测",
    reasons: [],
    requirements: [],
    conclusion: `复测横纵位移回落至 ${DISPLACEMENT_LIMIT_MM}mm 限值内（横 ${input.dx.toFixed(
      1,
    )} / 纵 ${input.dy.toFixed(1)}mm），恢复监测`,
  };
}
