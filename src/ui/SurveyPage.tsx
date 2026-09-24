import { useMemo, useState, useSyncExternalStore } from "react";
import { archiveStore } from "../archive/archive";
import {
  DISPLACEMENT_LIMIT_MM,
  TILT_DIRECTIONS,
  TiltDirection,
  formatAt,
  formatDuration,
  throughCrackGates,
  timeOf,
} from "../rules/supportRules";
import { StatusBadge } from "./StatusBadge";
import { RelationGraph } from "./RelationGraph";

type FilterKey = "all" | "retest" | "resettable";

interface Feedback {
  ok: boolean;
  message: string;
}

function nowInput(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "retest", label: "待复测" },
  { key: "resettable", label: "可复位" },
];

const RULE_POINTS = [
  `一个支撑销记前不接第二件，未回收的支撑不得再支顶`,
  `横向或纵向位移超过 ${DISPLACEMENT_LIMIT_MM}mm：读数保留，转待复测`,
  `巡检时刻早于或等于上一回：本次读数拒收，原记录保留，转待复测`,
  `贯穿裂缝构件须换人复测、间隔不少于 2 小时，横纵两个方向都回落才拆撑复位`,
  `补测尺寸或换支撑后，原结论立即失效并转待复测`,
];

export function SurveyPage() {
  const state = useSyncExternalStore(archiveStore.subscribe, archiveStore.getSnapshot);
  const dossiers = Object.values(state.dossiers);

  const [filter, setFilter] = useState<FilterKey>("all");
  const [selectedNo, setSelectedNo] = useState<string>(dossiers[0]?.componentNo ?? "");
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [attachSupport, setAttachSupport] = useState("");
  const [at, setAt] = useState(nowInput());
  const [inspector, setInspector] = useState("");
  const [dx, setDx] = useState("");
  const [dy, setDy] = useState("");
  const [tilt, setTilt] = useState<TiltDirection>(TILT_DIRECTIONS[0]);
  const [sizeInput, setSizeInput] = useState("");
  const [newSupport, setNewSupport] = useState("");

  const selected = state.dossiers[selectedNo] ?? dossiers[0];

  const counts = useMemo(
    () => ({
      total: dossiers.length,
      retest: dossiers.filter((d) => d.status === "retest").length,
      resettable: dossiers.filter((d) => d.status === "resettable").length,
      occupied: state.supports.filter((s) => s.componentNo).length,
    }),
    [dossiers, state.supports],
  );

  const filtered = dossiers.filter((d) => {
    if (filter === "all") return true;
    return d.status === filter;
  });

  const occupiedSupport = selected
    ? state.supports.find((s) => s.supportNo === selected.supportNo) ?? null
    : null;
  const freeSupports = state.supports.filter((s) => !s.componentNo);
  const lastReading = selected?.readings[selected.readings.length - 1] ?? null;
  const isRetestStage = selected?.status === "retest";
  const dxNum = parseFloat(dx);
  const dyNum = parseFloat(dy);
  const liveGates =
    selected?.throughCrack && isRetestStage && lastReading && at && inspector
      ? throughCrackGates(
          {
            at,
            inspector,
            dx: Number.isFinite(dxNum) ? dxNum : 0,
            dy: Number.isFinite(dyNum) ? dyNum : 0,
            tilt,
          },
          lastReading,
        )
      : null;

  function announce(r: { ok: boolean; message: string }) {
    setFeedback(r);
  }

  function resetReadingForm() {
    setAt(nowInput());
    setInspector("");
    setDx("");
    setDy("");
    setTilt(TILT_DIRECTIONS[0]);
  }

  function handleAttach() {
    if (!selected || !attachSupport) return;
    announce(archiveStore.attach(attachSupport, selected.componentNo));
    setAttachSupport("");
  }

  function handleReading() {
    if (!selected) return;
    if (!at || !inspector.trim()) {
      announce({ ok: false, message: "请填写巡检时刻与巡检人" });
      return;
    }
    if (!Number.isFinite(dxNum) || !Number.isFinite(dyNum)) {
      announce({ ok: false, message: "请填写横向、纵向位移数值（mm）" });
      return;
    }
    const input = { at, inspector: inspector.trim(), dx: dxNum, dy: dyNum, tilt };
    const r = isRetestStage
      ? archiveStore.retest(selected.componentNo, input)
      : archiveStore.inspection(selected.componentNo, input);
    announce(r);
    if (r.ok) resetReadingForm();
  }

  function handleSupplement() {
    if (!selected || !sizeInput.trim()) {
      announce({ ok: false, message: "请填写补测尺寸" });
      return;
    }
    announce(archiveStore.supplement(selected.componentNo, sizeInput.trim()));
    setSizeInput("");
  }

  function handleReplace() {
    if (!selected || !selected.supportNo || !newSupport) return;
    announce(archiveStore.replace(selected.supportNo, newSupport, selected.componentNo));
    setNewSupport("");
  }

  const metrics = [
    ["构件档案", counts.total],
    ["待复测", counts.retest],
    ["可复位", counts.resettable],
    ["占用支撑", `${counts.occupied}/${state.supports.length}`],
  ];

  return (
    <main className="app">
      <section className="hero hero-compact">
        <p>临时支撑巡检 · 补测复测 · 复位放行</p>
        <h1>木结构构件测绘 · 支撑巡检台</h1>
        <span>
          补测后临时支撑状态不再依赖口头确认：登记支撑编号与横纵位移、倾斜方向、巡检时刻，系统按规则判定待复测与复位放行，读数与结论全程留档。
        </span>
      </section>

      <section className="metrics">
        {metrics.map(([label, value]) => (
          <article key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="workspace workspace-wide">
        <aside className="panel side-panel">
          <h2>支撑占用</h2>
          <div className="support-list">
            {state.supports.map((s) => (
              <article key={s.supportNo} className={s.componentNo ? "" : "free"}>
                <b>{s.supportNo}</b>
                <div>
                  <h3>{s.kind}</h3>
                  <p>{s.componentNo ? `支顶 ${s.componentNo} · 销记前不接第二件` : "空闲可支顶"}</p>
                </div>
              </article>
            ))}
          </div>

          <h2 className="rule-title">判定规则</h2>
          <ul className="rule-list">
            {RULE_POINTS.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </aside>

        <section className="panel form-panel">
          {feedback && (
            <div className={`banner ${feedback.ok ? "banner-ok" : "banner-danger"}`}>
              {feedback.ok ? "✓ " : "✕ "}
              {feedback.message}
            </div>
          )}

          <div className="heading">
            <div>
              <p>巡检与复位放行</p>
              <h2>{selected ? selected.componentNo : "请选择构件"}</h2>
            </div>
            {selected && <StatusBadge status={selected.status} />}
          </div>

          {selected && (
            <>
              <div className="dossier-meta">
                <span>{selected.building}</span>
                <span>{selected.memberType}</span>
                <span>{selected.disease}</span>
                {selected.throughCrack && <span className="tag tag-danger">贯穿裂缝</span>}
                {selected.measuredSize && <span className="tag">补测尺寸 {selected.measuredSize}</span>}
                <span className={occupiedSupport ? "tag" : "tag tag-muted"}>
                  {occupiedSupport
                    ? `支撑 ${occupiedSupport.supportNo}（${occupiedSupport.kind}）`
                    : "暂无支撑"}
                </span>
              </div>

              {!occupiedSupport && selected.status !== "released" && (
                <div className="sub-block">
                  <h3>支顶登记</h3>
                  <div className="inline-form">
                    <select value={attachSupport} onChange={(e) => setAttachSupport(e.target.value)}>
                      <option value="">选择空闲支撑编号</option>
                      {freeSupports.map((s) => (
                        <option key={s.supportNo} value={s.supportNo}>
                          {s.supportNo} · {s.kind}
                        </option>
                      ))}
                    </select>
                    <button className="primary" onClick={handleAttach} disabled={!attachSupport}>
                      支顶构件
                    </button>
                  </div>
                  <p className="hint">已被占用的支撑不在列表内：销记前不接第二件。</p>
                </div>
              )}

              {selected.status !== "released" && (
                <div className="sub-block">
                  <h3>{isRetestStage ? "复测登记" : "巡检登记"}</h3>
                  {isRetestStage && (
                    <p className={`hint ${selected.throughCrack ? "hint-danger" : ""}`}>
                      {selected.throughCrack
                        ? "贯穿裂缝构件：须换人、间隔不少于 2 小时，横纵两个方向均回落，复测通过后才可拆撑复位。"
                        : `复测横纵位移回落至 ${DISPLACEMENT_LIMIT_MM}mm 限值内恢复监测。`}
                    </p>
                  )}
                  <div className="field-grid">
                    <label>
                      <span>支撑编号</span>
                      <input value={selected.supportNo ?? "未支顶"} readOnly />
                    </label>
                    <label>
                      <span>巡检时刻</span>
                      <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
                    </label>
                    <label>
                      <span>横向位移（mm，带符号）</span>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="如 1.2"
                        value={dx}
                        onChange={(e) => setDx(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>纵向位移（mm，带符号）</span>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="如 -0.6"
                        value={dy}
                        onChange={(e) => setDy(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>巡检人</span>
                      <input
                        placeholder="复测须换人时填写另一人"
                        value={inspector}
                        onChange={(e) => setInspector(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>倾斜方向</span>
                      <select value={tilt} onChange={(e) => setTilt(e.target.value as TiltDirection)}>
                        {TILT_DIRECTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {liveGates && (
                    <div className="gates">
                      {liveGates.map((g) => {
                        const pass = g.pass;
                        return (
                          <div key={g.key} className={`gate ${pass ? "gate-pass" : "gate-fail"}`}>
                            <b>{pass ? "✓" : "○"}</b>
                            <div>
                              <h4>{g.label}</h4>
                              <p>{g.detail}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="action-row">
                    <button className="primary" onClick={handleReading}>
                      {isRetestStage ? "提交复测判定" : "提交巡检登记"}
                    </button>
                    <button
                      onClick={() => announce(archiveStore.release(selected.componentNo))}
                      disabled={selected.status !== "resettable"}
                      className="btn-ok"
                    >
                      拆撑复位放行
                    </button>
                    <button
                      onClick={() => announce(archiveStore.signOff(selected.componentNo))}
                      disabled={selected.status !== "monitoring"}
                    >
                      监测正常直接销记
                    </button>
                  </div>
                </div>
              )}

              {selected.status !== "released" && (
                <div className="sub-block two-col">
                  <div>
                    <h3>补测尺寸</h3>
                    <p className="hint">补测尺寸后原结论失效，转待复测重新评估。</p>
                    <div className="inline-form">
                      <input
                        placeholder="如 截面 178×238mm"
                        value={sizeInput}
                        onChange={(e) => setSizeInput(e.target.value)}
                      />
                      <button onClick={handleSupplement} disabled={!sizeInput.trim()}>
                        补测登记
                      </button>
                    </div>
                  </div>
                  <div>
                    <h3>换支撑</h3>
                    <p className="hint">换支撑后原结论失效，转待复测重新巡检。</p>
                    <div className="inline-form">
                      <select value={newSupport} onChange={(e) => setNewSupport(e.target.value)}>
                        <option value="">选择新支撑编号</option>
                        {freeSupports.map((s) => (
                          <option key={s.supportNo} value={s.supportNo}>
                            {s.supportNo} · {s.kind}
                          </option>
                        ))}
                      </select>
                      <button onClick={handleReplace} disabled={!newSupport}>
                        更换并重新评估
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="sub-block">
                <h3>读数记录与结论（原始记录保留）</h3>
                <div className="readings">
                  {selected.readings.length === 0 && <p className="hint">尚无读数登记。</p>}
                  {[...selected.readings].reverse().map((r, i) => (
                    <article key={`${r.at}-${i}`} className="reading-row">
                      <b className={r.kind === "retest" ? "kind kind-retest" : "kind"}>
                        {r.kind === "retest" ? "复测" : "巡检"}
                      </b>
                      <div>
                        <h4>
                          {formatAt(r.at)} · {r.inspector}
                          {lastReading && r === lastReading && selected.status !== "monitoring" && (
                            <span className="tag tag-danger">最新</span>
                          )}
                        </h4>
                        <p>
                          横 {r.dx.toFixed(1)}mm · 纵 {r.dy.toFixed(1)}mm · {r.tilt}
                          {Math.abs(r.dx) > DISPLACEMENT_LIMIT_MM ||
                          Math.abs(r.dy) > DISPLACEMENT_LIMIT_MM
                            ? " · 超限"
                            : ""}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="conclusions">
                  {[...selected.conclusions].reverse().map((c) => (
                    <div key={c.id} className={`conclusion conclusion-${c.state}`}>
                      <div>
                        <b>v{c.version}</b>
                        <span className="tag">{c.basis}</span>
                        <span
                          className={
                            c.state === "active"
                              ? "tag tag-ok"
                              : c.state === "invalidated"
                                ? "tag tag-danger"
                                : "tag tag-muted"
                          }
                        >
                          {c.state === "active"
                            ? "现行"
                            : c.state === "invalidated"
                              ? "已失效"
                              : "被替代"}
                        </span>
                      </div>
                      <p>{c.text}</p>
                      <small>{formatAt(c.createdAt)}</small>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      </section>

      <section className="panel list-panel">
        <div className="heading">
          <div>
            <p>构件清单</p>
            <h2>待复测与可复位筛选</h2>
          </div>
          <div className="chips">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={filter === f.key ? "chip-on" : ""}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
            <button className="btn-reset" onClick={() => archiveStore.resetDemo()}>
              重置演示数据
            </button>
          </div>
        </div>
        <div className="dossier-table">
          <table>
            <thead>
              <tr>
                <th>构件编号</th>
                <th>所属建筑</th>
                <th>病害</th>
                <th>支撑</th>
                <th>最新读数</th>
                <th>距上一回</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const last = d.readings[d.readings.length - 1];
                const prev = d.readings[d.readings.length - 2];
                const gap =
                  last && prev
                    ? formatDuration(timeOf(last.at) - timeOf(prev.at))
                    : last
                      ? "首条"
                      : "—";
                return (
                  <tr
                    key={d.componentNo}
                    className={d.componentNo === selected?.componentNo ? "row-on" : ""}
                    onClick={() => setSelectedNo(d.componentNo)}
                  >
                    <td>
                      <b>{d.componentNo}</b>
                      {d.throughCrack && <span className="tag tag-danger">贯穿裂缝</span>}
                    </td>
                    <td>{d.building}</td>
                    <td>{d.disease}</td>
                    <td>{d.supportNo ?? "—"}</td>
                    <td>
                      {last
                        ? `横 ${last.dx.toFixed(1)} / 纵 ${last.dy.toFixed(1)}mm`
                        : "无读数"}
                    </td>
                    <td>{gap}</td>
                    <td>
                      <StatusBadge status={d.status} />
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    当前筛选下暂无构件
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>单栋建筑构件关系视图</p>
            <h2>构件—支撑关系图（异常同步标注）</h2>
          </div>
        </div>
        <RelationGraph state={state} />
      </section>

      <section className="panel archive-panel">
        <div className="heading">
          <div>
            <p>存档</p>
            <h2>操作流水（只追加）</h2>
          </div>
          <span className="hint">读数拒收不删旧记录；补测尺寸与换支撑仅令旧结论失效，全部留痕。</span>
        </div>
        <div className="event-log">
          {state.events.map((e) => (
            <article key={e.id} className={`event event-${e.tone}`}>
              <time>{formatAt(e.at)}</time>
              <span className="event-type">{e.type === "rejected" ? "拒收" : labelOf(e.type)}</span>
              <p>{e.message}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function labelOf(type: string): string {
  const map: Record<string, string> = {
    attach: "支顶",
    inspection: "巡检",
    retest: "复测",
    resettable: "放行判定",
    supplement: "补测尺寸",
    replace: "换支撑",
    release: "复位放行",
    signoff: "销记",
  };
  return map[type] ?? type;
}
