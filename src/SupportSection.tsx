// 页面承载：临时支撑巡检与复位放行的界面。规则取自 supportRules，存取走 supportArchive。
import { useMemo, useState } from "react";
import {
  CaseStatus,
  DISPLACEMENT_LIMIT_MM,
  RECHECK_INTERVAL_HOURS,
  ReadingIssue,
  SupportCase,
  TILT_DIRECTIONS,
  TiltDirection,
  canRelease,
  evaluateReading,
  openCase,
  recheckIssues,
  standingIssues,
} from "./supportRules";
import {
  appendReading,
  invalidateCase,
  loadArchive,
  registerCase,
  releaseCase,
  saveArchive,
  selectByStatus,
  toViews,
} from "./supportArchive";

const MEMBERS = [
  { no: "梁架A-03", x: 150, y: 56 },
  { no: "柱网C-12", x: 70, y: 176 },
  { no: "斗拱D-07", x: 260, y: 176 },
  { no: "枋木F-02", x: 420, y: 96 },
];

const LINKS = [
  { from: "梁架A-03", to: "柱网C-12", joint: "透榫" },
  { from: "梁架A-03", to: "斗拱D-07", joint: "半榫" },
  { from: "斗拱D-07", to: "枋木F-02", joint: "燕尾榫" },
];

const STATUS_COLOR: Record<CaseStatus, string> = {
  待复测: "#dc2626",
  可复位: "#0f766e",
  已销记: "#475569",
  已失效: "#94a3b8",
};

const FILTER_OPTIONS: Array<CaseStatus | "全部"> = ["全部", "待复测", "可复位", "已销记", "已失效"];

function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 单回读数在卡片上要展示的异常（含贯穿裂缝复测资格）。 */
function readingIssues(supportCase: SupportCase, index: number): ReadingIssue[] {
  const reading = supportCase.readings[index];
  const prev = index > 0 ? supportCase.readings[index - 1] : undefined;
  const issues = evaluateReading(reading, prev);
  if (supportCase.throughCrack && reading.kind === "复测" && prev) {
    issues.push(...recheckIssues(reading, prev));
  }
  return issues;
}

interface FormState {
  supportNo: string;
  memberNo: string;
  throughCrack: boolean;
  horizontal: string;
  vertical: string;
  tiltDirection: TiltDirection;
  inspectedAt: string;
  inspector: string;
}

const emptyForm = (): FormState => ({
  supportNo: "",
  memberNo: MEMBERS[0].no,
  throughCrack: false,
  horizontal: "",
  vertical: "",
  tiltDirection: "无明显倾斜",
  inspectedAt: nowLocal(),
  inspector: "",
});

export default function SupportSection() {
  const [cases, setCases] = useState<SupportCase[]>(loadArchive);
  const [filter, setFilter] = useState<CaseStatus | "全部">("全部");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const views = useMemo(() => toViews(cases), [cases]);
  const open = useMemo(() => openCase(cases), [cases]);
  const counts = useMemo(() => {
    const tally: Record<CaseStatus, number> = { 待复测: 0, 可复位: 0, 已销记: 0, 已失效: 0 };
    views.forEach((view) => {
      tally[view.status] += 1;
    });
    return tally;
  }, [views]);

  function commit(next: SupportCase[], text: string) {
    setCases(next);
    saveArchive(next);
    setMessage({ kind: "ok", text });
  }

  function submitReading(event: React.FormEvent) {
    event.preventDefault();
    const horizontal = Number(form.horizontal);
    const vertical = Number(form.vertical);
    if (!open && !form.supportNo.trim()) return setMessage({ kind: "err", text: "请填写支撑编号" });
    if (!form.inspector.trim()) return setMessage({ kind: "err", text: "请填写巡检人" });
    if (!form.inspectedAt) return setMessage({ kind: "err", text: "请填写巡检时刻" });
    if (!Number.isFinite(horizontal) || !Number.isFinite(vertical) || form.horizontal === "" || form.vertical === "") {
      return setMessage({ kind: "err", text: "横、纵位移需为数字（毫米）" });
    }

    const reading = {
      horizontal,
      vertical,
      tiltDirection: form.tiltDirection,
      inspectedAt: form.inspectedAt,
      inspector: form.inspector.trim(),
    };

    if (open) {
      // 有未销记支撑：不接第二件，本次登记作为该支撑的复测读数。
      const next = appendReading(cases, open.id, reading);
      commit(next, `支撑 ${open.supportNo} 复测读数已存档，原记录保留`);
    } else {
      const result = registerCase(cases, {
        supportNo: form.supportNo.trim(),
        memberNo: form.memberNo,
        throughCrack: form.throughCrack,
        firstReading: reading,
      });
      if (!result.ok) return setMessage({ kind: "err", text: result.message });
      commit(result.cases, result.message);
    }
    setForm({ ...emptyForm(), inspectedAt: nowLocal() });
  }

  function memberCase(memberNo: string) {
    return views.find((view) => view.data.memberNo === memberNo);
  }

  const anomalies = views.filter((view) => view.status === "待复测");

  return (
    <section className="panel support-section">
      <div className="heading">
        <div>
          <p>临时支撑</p>
          <h2>巡检与复位放行</h2>
        </div>
        <div className={`gate-banner ${open ? "blocked" : "free"}`}>
          {open ? `支撑 ${open.supportNo} 未销记 · 暂不接第二件` : "当前无在测支撑 · 可登记新一件"}
        </div>
      </div>

      <ul className="rule-strip">
        <li>位移超过 {DISPLACEMENT_LIMIT_MM} 毫米或读数早于上一回：原记录保留，转待复测</li>
        <li>贯穿裂缝构件：换人、隔 {RECHECK_INTERVAL_HOURS} 小时复测，两个方向都回落才拆撑复位</li>
        <li>补测尺寸或更换支撑后，原结论失效</li>
        <li>一个支撑销记前，不接第二件</li>
      </ul>

      <div className="support-grid">
        <form className="sub-panel" onSubmit={submitReading}>
          <h3>{open ? `复测登记 · 支撑 ${open.supportNo}（${open.memberNo}）` : "新支撑巡检登记"}</h3>
          {message && <p className={`form-message ${message.kind}`}>{message.text}</p>}
          {open?.throughCrack && (
            <p className="hint">贯穿裂缝构件：复测须换人、与上一回隔 {RECHECK_INTERVAL_HOURS} 小时，两个方向都回落才拆撑复位。</p>
          )}
          <div className="field-grid">
            {!open && (
              <>
                <label>
                  <span>支撑编号</span>
                  <input
                    value={form.supportNo}
                    onChange={(e) => setForm({ ...form, supportNo: e.target.value })}
                    placeholder="如 ZC-06"
                  />
                </label>
                <label>
                  <span>关联构件</span>
                  <select value={form.memberNo} onChange={(e) => setForm({ ...form, memberNo: e.target.value })}>
                    {MEMBERS.map((member) => (
                      <option key={member.no} value={member.no}>
                        {member.no}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label>
              <span>横向位移（mm）</span>
              <input
                value={form.horizontal}
                onChange={(e) => setForm({ ...form, horizontal: e.target.value })}
                placeholder="如 1.2"
                inputMode="decimal"
              />
            </label>
            <label>
              <span>纵向位移（mm）</span>
              <input
                value={form.vertical}
                onChange={(e) => setForm({ ...form, vertical: e.target.value })}
                placeholder="如 0.8"
                inputMode="decimal"
              />
            </label>
            <label>
              <span>倾斜方向</span>
              <select
                value={form.tiltDirection}
                onChange={(e) => setForm({ ...form, tiltDirection: e.target.value as TiltDirection })}
              >
                {TILT_DIRECTIONS.map((direction) => (
                  <option key={direction} value={direction}>
                    {direction}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>巡检时刻</span>
              <input
                type="datetime-local"
                value={form.inspectedAt}
                onChange={(e) => setForm({ ...form, inspectedAt: e.target.value })}
              />
            </label>
            <label>
              <span>巡检人</span>
              <input
                value={form.inspector}
                onChange={(e) => setForm({ ...form, inspector: e.target.value })}
                placeholder={open?.throughCrack ? "复测须换人" : "姓名"}
              />
            </label>
            {!open && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={form.throughCrack}
                  onChange={(e) => setForm({ ...form, throughCrack: e.target.checked })}
                />
                <span>贯穿裂缝构件</span>
              </label>
            )}
          </div>
          <button className="primary" type="submit">
            {open ? "登记复测读数" : "登记巡检"}
          </button>
        </form>

        <div className="sub-panel relation">
          <h3>构件关系视图 · 异常同步标注</h3>
          <svg viewBox="0 0 500 220" role="img" aria-label="构件关系图">
            {LINKS.map((link) => {
              const from = MEMBERS.find((m) => m.no === link.from)!;
              const to = MEMBERS.find((m) => m.no === link.to)!;
              return (
                <g key={`${link.from}-${link.to}`}>
                  <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#cbd5e1" strokeWidth={2} />
                  <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 6} textAnchor="middle" fontSize={11} fill="#64748b">
                    {link.joint}
                  </text>
                </g>
              );
            })}
            {MEMBERS.map((member) => {
              const view = memberCase(member.no);
              const color = view ? STATUS_COLOR[view.status] : "#cbd5e1";
              const anomalous = view?.status === "待复测";
              return (
                <g key={member.no}>
                  <circle cx={member.x} cy={member.y} r={24} fill="#ffffff" stroke={color} strokeWidth={anomalous ? 4 : 2.5} />
                  {anomalous && (
                    <text x={member.x} y={member.y + 5} textAnchor="middle" fontSize={16} fill={color}>
                      ⚠
                    </text>
                  )}
                  <text x={member.x} y={member.y + 40} textAnchor="middle" fontSize={12} fill="#172033" fontWeight={600}>
                    {member.no}
                  </text>
                  {view && (
                    <text x={member.x} y={member.y - 32} textAnchor="middle" fontSize={11} fill={color} fontWeight={700}>
                      {view.data.supportNo} · {view.status}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <div className="legend">
            {(Object.keys(STATUS_COLOR) as CaseStatus[]).map((status) => (
              <span key={status}>
                <i style={{ background: STATUS_COLOR[status] }} />
                {status} {counts[status]}
              </span>
            ))}
          </div>
          {anomalies.length > 0 && (
            <ul className="anomaly-lines">
              {anomalies.map((view) => (
                <li key={view.data.id}>
                  ⚠ {view.data.memberNo} · {view.data.supportNo}：
                  {standingIssues(view.data)
                    .map((issue) => issue.code)
                    .join("、")}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="heading">
        <div>
          <p>支撑清单</p>
          <h2>巡检台账</h2>
        </div>
        <div className="filter-row">
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option}
              className={filter === option ? "active" : ""}
              onClick={() => setFilter(option)}
              type="button"
            >
              {option}
              {option !== "全部" ? ` ${counts[option]}` : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="case-list">
        {selectByStatus(cases, filter).map((view) => {
          const supportCase = view.data;
          const release = canRelease(supportCase);
          const isOpen = view.status === "待复测" || view.status === "可复位";
          return (
            <article className="case-card" key={supportCase.id}>
              <div className="case-head">
                <div>
                  <strong>{supportCase.supportNo}</strong>
                  <span className="hint"> · {supportCase.memberNo}</span>
                  {supportCase.throughCrack && <span className="tag-crack">贯穿裂缝</span>}
                </div>
                <span className="badge" style={{ background: STATUS_COLOR[view.status] }}>
                  {view.status}
                </span>
              </div>

              {view.status === "待复测" && (
                <p className="form-message err">
                  待办：{standingIssues(supportCase).map((issue) => `${issue.code}（${issue.detail}）`).join("；")}
                </p>
              )}

              <div className="reading-list">
                {supportCase.readings.map((reading, index) => {
                  const issues = readingIssues(supportCase, index);
                  return (
                    <div className={`reading-item ${issues.length > 0 ? "has-issue" : ""}`} key={reading.id}>
                      <b>{reading.kind}</b> · {reading.inspectedAt} · 横 {reading.horizontal}mm / 纵 {reading.vertical}mm ·
                      倾斜 {reading.tiltDirection} · {reading.inspector}
                      {issues.length > 0 && (
                        <span className="issue-line">
                          {issues.map((issue) => (
                            <span className="issue-tag" key={issue.code} title={issue.detail}>
                              {issue.code}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {supportCase.closedAt && <p className="hint">已于 {supportCase.closedAt} 拆撑复位并销记。</p>}
              {supportCase.invalidReason && (
                <p className="hint">因「{supportCase.invalidReason}」原结论失效，档案保留备查。</p>
              )}

              {isOpen && (
                <div className="case-actions">
                  <button
                    className="primary"
                    type="button"
                    disabled={!release.ok}
                    title={release.reason}
                    onClick={() => commit(releaseCase(cases, supportCase.id, nowLocal()), `支撑 ${supportCase.supportNo} 已复位放行并销记`)}
                  >
                    复位放行 · 销记
                  </button>
                  <button type="button" onClick={() => commit(invalidateCase(cases, supportCase.id, "补测尺寸"), `支撑 ${supportCase.supportNo} 已补测尺寸，原结论失效`)}>
                    补测尺寸
                  </button>
                  <button type="button" onClick={() => commit(invalidateCase(cases, supportCase.id, "更换支撑"), `支撑 ${supportCase.supportNo} 已更换支撑，原结论失效`)}>
                    更换支撑
                  </button>
                </div>
              )}
            </article>
          );
        })}
        {selectByStatus(cases, filter).length === 0 && <p className="hint">当前筛选下暂无支撑档案。</p>}
      </div>
    </section>
  );
}
