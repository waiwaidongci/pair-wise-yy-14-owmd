// 规则承载：临时支撑巡检与复位放行的全部判定规则，纯函数，不碰存储与界面。

export const DISPLACEMENT_LIMIT_MM = 3; // 位移限值：超过 3 毫米转待复测
export const RECHECK_INTERVAL_HOURS = 2; // 贯穿裂缝构件复测间隔：隔两小时
export const TILT_DIRECTIONS = ["东", "南", "西", "北", "无明显倾斜"] as const;

export type TiltDirection = (typeof TILT_DIRECTIONS)[number];
export type ReadingKind = "初测" | "复测";
export type CaseStatus = "待复测" | "可复位" | "已销记" | "已失效";
export type InvalidReason = "补测尺寸" | "更换支撑";

export interface Reading {
  id: string;
  kind: ReadingKind;
  horizontal: number; // 横向位移（毫米）
  vertical: number; // 纵向位移（毫米）
  tiltDirection: TiltDirection; // 倾斜方向
  inspectedAt: string; // 巡检时刻（ISO / datetime-local）
  inspector: string; // 巡检人
}

export interface SupportCase {
  id: string;
  supportNo: string; // 支撑编号
  memberNo: string; // 关联构件编号
  throughCrack: boolean; // 是否贯穿裂缝构件
  readings: Reading[]; // 原记录保留：只追加，不改写
  invalidReason?: InvalidReason; // 补测尺寸或更换支撑后原结论失效
  closedAt?: string; // 复位放行（销记）时刻
}

export type IssueCode = "位移超限" | "时刻倒挂" | "未换人复测" | "间隔不足两小时" | "方向未回落" | "复测待办";

export interface ReadingIssue {
  code: IssueCode;
  detail: string;
}

const HOUR_MS = 3600 * 1000;

export function lastReading(supportCase: SupportCase): Reading | undefined {
  return supportCase.readings[supportCase.readings.length - 1];
}

export function previousReading(supportCase: SupportCase): Reading | undefined {
  return supportCase.readings[supportCase.readings.length - 2];
}

/** 单回读数判定：位移超过 3 毫米，或读数时刻早于上一回，即异常。 */
export function evaluateReading(reading: Reading, previous?: Reading): ReadingIssue[] {
  const issues: ReadingIssue[] = [];
  if (Math.abs(reading.horizontal) > DISPLACEMENT_LIMIT_MM || Math.abs(reading.vertical) > DISPLACEMENT_LIMIT_MM) {
    issues.push({
      code: "位移超限",
      detail: `横 ${reading.horizontal}mm / 纵 ${reading.vertical}mm，限值 ${DISPLACEMENT_LIMIT_MM}mm`,
    });
  }
  if (previous && new Date(reading.inspectedAt).getTime() < new Date(previous.inspectedAt).getTime()) {
    issues.push({
      code: "时刻倒挂",
      detail: `读数 ${reading.inspectedAt} 早于上一回 ${previous.inspectedAt}`,
    });
  }
  return issues;
}

/** 两个方向都回落：横、纵位移绝对值均小于上一回。 */
export function bothDirectionsEased(current: Reading, previous: Reading): boolean {
  return Math.abs(current.horizontal) < Math.abs(previous.horizontal) && Math.abs(current.vertical) < Math.abs(previous.vertical);
}

/** 贯穿裂缝构件的复测资格：换人，且与上一回隔两小时。 */
export function recheckIssues(reading: Reading, previous: Reading): ReadingIssue[] {
  const issues: ReadingIssue[] = [];
  if (reading.inspector.trim() === previous.inspector.trim()) {
    issues.push({ code: "未换人复测", detail: `复测人 ${reading.inspector} 与上一回相同` });
  }
  const gap = new Date(reading.inspectedAt).getTime() - new Date(previous.inspectedAt).getTime();
  if (gap < RECHECK_INTERVAL_HOURS * HOUR_MS) {
    issues.push({ code: "间隔不足两小时", detail: `距上一回 ${(gap / HOUR_MS).toFixed(1)} 小时` });
  }
  return issues;
}

/** 由读数序列推导支撑状态（已销记、已失效优先，不再回退）。 */
export function deriveStatus(supportCase: SupportCase): CaseStatus {
  if (supportCase.invalidReason) return "已失效";
  if (supportCase.closedAt) return "已销记";

  const last = lastReading(supportCase);
  if (!last) return "待复测";
  const prev = previousReading(supportCase);

  if (evaluateReading(last, prev).length > 0) return "待复测";

  if (supportCase.throughCrack) {
    // 贯穿裂缝：必须有一回合格的复测（换人、隔两小时），且两个方向都回落，才可复位。
    if (last.kind !== "复测" || !prev) return "待复测";
    if (recheckIssues(last, prev).length > 0) return "待复测";
    if (!bothDirectionsEased(last, prev)) return "待复测";
  }
  return "可复位";
}

/** 复位放行判定：仅可复位状态允许拆撑销记。 */
export function canRelease(supportCase: SupportCase): { ok: boolean; reason: string } {
  const status = deriveStatus(supportCase);
  if (status === "已销记") return { ok: false, reason: "已销记" };
  if (status === "已失效") return { ok: false, reason: `原结论已失效（${supportCase.invalidReason}）` };
  if (status !== "可复位") {
    return {
      ok: false,
      reason: supportCase.throughCrack
        ? "贯穿裂缝构件须换人隔两小时复测，且两个方向都回落"
        : "存在超限或倒挂读数，待复测回落",
    };
  }
  return { ok: true, reason: "读数合格，允许拆撑复位" };
}

/** 未销记的支撑（一个销记前不接第二件）。 */
export function openCase(cases: SupportCase[]): SupportCase | undefined {
  return cases.find((item) => {
    const status = deriveStatus(item);
    return status === "待复测" || status === "可复位";
  });
}

/** 接件闸门：存在未销记支撑时，不接第二件。 */
export function gateOpen(cases: SupportCase[]): boolean {
  return openCase(cases) === undefined;
}

/** 读数序列中全部异常（供关系图同步标注）。 */
export function caseIssues(supportCase: SupportCase): ReadingIssue[] {
  return supportCase.readings.flatMap((reading, index) => {
    const prev = index > 0 ? supportCase.readings[index - 1] : undefined;
    const issues = evaluateReading(reading, prev);
    if (supportCase.throughCrack && reading.kind === "复测" && prev) {
      return issues.concat(recheckIssues(reading, prev));
    }
    return issues;
  });
}

/** 当前待办异常：决定最新状态的问题清单（供清单与关系图展示）。 */
export function standingIssues(supportCase: SupportCase): ReadingIssue[] {
  const last = lastReading(supportCase);
  if (!last) return [{ code: "复测待办", detail: "尚无读数" }];
  const prev = previousReading(supportCase);
  const issues = evaluateReading(last, prev);
  if (supportCase.throughCrack) {
    if (last.kind !== "复测" || !prev) {
      issues.push({ code: "复测待办", detail: "贯穿裂缝构件须换人隔两小时复测" });
    } else {
      const recheck = recheckIssues(last, prev);
      issues.push(...recheck);
      if (recheck.length === 0 && !bothDirectionsEased(last, prev)) {
        issues.push({ code: "方向未回落", detail: "横纵两个方向都回落才可拆撑复位" });
      }
    }
  }
  return issues;
}
