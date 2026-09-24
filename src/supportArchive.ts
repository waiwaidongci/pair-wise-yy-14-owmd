// 存档承载：支撑巡检档案的持久化与流转。读数只追加不改写，原记录保留。

import {
  CaseStatus,
  InvalidReason,
  Reading,
  SupportCase,
  deriveStatus,
  gateOpen,
} from "./supportRules";

const STORAGE_KEY = "hxyfront-62013:support-archive";

export interface CaseDraft {
  supportNo: string;
  memberNo: string;
  throughCrack: boolean;
  firstReading: Omit<Reading, "id" | "kind">;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 种子档案：覆盖待复测、可复位、已销记、已失效四种状态，便于首次打开即有完整台账。 */
function seedArchive(): SupportCase[] {
  return [
    {
      id: "case-zc05",
      supportNo: "ZC-05",
      memberNo: "梁架A-03",
      throughCrack: true,
      closedAt: "2026-09-24T11:30",
      readings: [
        {
          id: "rd-zc05-1",
          kind: "初测",
          horizontal: 3.6,
          vertical: 2.1,
          tiltDirection: "东",
          inspectedAt: "2026-09-24T08:30",
          inspector: "陈测",
        },
        {
          id: "rd-zc05-2",
          kind: "复测",
          horizontal: 2.4,
          vertical: 1.2,
          tiltDirection: "东",
          inspectedAt: "2026-09-24T11:00",
          inspector: "林复",
        },
      ],
    },
    {
      id: "case-zc04",
      supportNo: "ZC-04",
      memberNo: "柱网C-12",
      throughCrack: false,
      readings: [
        {
          id: "rd-zc04-1",
          kind: "初测",
          horizontal: 1.1,
          vertical: 0.8,
          tiltDirection: "无明显倾斜",
          inspectedAt: "2026-09-23T15:10",
          inspector: "陈测",
        },
        {
          id: "rd-zc04-2",
          kind: "复测",
          horizontal: 4.2,
          vertical: 1.0,
          tiltDirection: "南",
          inspectedAt: "2026-09-23T14:40",
          inspector: "林复",
        },
      ],
    },
    {
      id: "case-zc03",
      supportNo: "ZC-03",
      memberNo: "斗拱D-07",
      throughCrack: false,
      closedAt: "2026-09-22T17:20",
      readings: [
        {
          id: "rd-zc03-1",
          kind: "初测",
          horizontal: 0.9,
          vertical: 0.6,
          tiltDirection: "无明显倾斜",
          inspectedAt: "2026-09-22T09:00",
          inspector: "陈测",
        },
      ],
    },
    {
      id: "case-zc02",
      supportNo: "ZC-02",
      memberNo: "枋木F-02",
      throughCrack: false,
      invalidReason: "补测尺寸",
      readings: [
        {
          id: "rd-zc02-1",
          kind: "初测",
          horizontal: 1.4,
          vertical: 1.9,
          tiltDirection: "西",
          inspectedAt: "2026-09-21T10:20",
          inspector: "林复",
        },
      ],
    },
  ];
}

export function loadArchive(): SupportCase[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SupportCase[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // 本地存档不可读时回落到种子档案
  }
  return seedArchive();
}

export function saveArchive(cases: SupportCase[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
  } catch {
    // 存档写失败不阻断页面操作
  }
}

/** 登记新支撑：受闸门约束，一个支撑销记前不接第二件。 */
export function registerCase(cases: SupportCase[], draft: CaseDraft): { ok: boolean; message: string; cases: SupportCase[] } {
  if (!gateOpen(cases)) {
    return { ok: false, message: "存在未销记支撑，暂不接第二件", cases };
  }
  const supportCase: SupportCase = {
    id: uid("case"),
    supportNo: draft.supportNo,
    memberNo: draft.memberNo,
    throughCrack: draft.throughCrack,
    readings: [{ ...draft.firstReading, id: uid("rd"), kind: "初测" }],
  };
  return { ok: true, message: `支撑 ${draft.supportNo} 已登记`, cases: [supportCase, ...cases] };
}

/** 追加一回读数（初测异常后的复测）：原记录保留，只增不改。 */
export function appendReading(cases: SupportCase[], caseId: string, reading: Omit<Reading, "id" | "kind">): SupportCase[] {
  return cases.map((item) =>
    item.id === caseId
      ? { ...item, readings: [...item.readings, { ...reading, id: uid("rd"), kind: "复测" as const }] }
      : item,
  );
}

/** 复位放行：拆撑后销记。 */
export function releaseCase(cases: SupportCase[], caseId: string, closedAt: string): SupportCase[] {
  return cases.map((item) => (item.id === caseId ? { ...item, closedAt } : item));
}

/** 补测尺寸或更换支撑：原结论失效，档案保留。 */
export function invalidateCase(cases: SupportCase[], caseId: string, reason: InvalidReason): SupportCase[] {
  return cases.map((item) => (item.id === caseId ? { ...item, invalidReason: reason } : item));
}

export interface CaseView {
  data: SupportCase;
  status: CaseStatus;
}

export function toViews(cases: SupportCase[]): CaseView[] {
  return cases.map((item) => ({ data: item, status: deriveStatus(item) }));
}

/** 清单筛选：待复测 / 可复位 / 已销记 / 已失效 / 全部。 */
export function selectByStatus(cases: SupportCase[], status: CaseStatus | "全部"): CaseView[] {
  const views = toViews(cases);
  return status === "全部" ? views : views.filter((view) => view.status === status);
}
