import { ArchiveState, Dossier } from "../archive/archive";
import { STATUS_LABEL } from "../rules/supportRules";

/**
 * 单栋建筑构件关系视图：构件—支撑关系同步标注异常状态。
 * 纯展示，状态来自存档；不在这里做任何放行操作。
 */
export function RelationGraph({ state }: { state: ArchiveState }) {
  const buildings = new Map<string, Dossier[]>();
  for (const d of Object.values(state.dossiers)) {
    const list = buildings.get(d.building) ?? [];
    list.push(d);
    buildings.set(d.building, list);
  }

  const freeSupports = state.supports.filter((s) => !s.componentNo);
  const colW = 250;
  const width = Math.max(620, buildings.size * colW + 120);
  const buildingH = 330;
  const poolH = freeSupports.length > 0 ? 92 : 24;
  const height = 70 + buildingH + poolH;

  const statusColor: Record<string, string> = {
    monitoring: "#0f766e",
    retest: "#b91c1c",
    resettable: "#b45309",
    released: "#64748b",
  };

  return (
    <div className="graph-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="构件关系图">
        {[...buildings.entries()].map(([building, list], bi) => {
          const x = 40 + bi * colW;
          return (
            <g key={building}>
              <rect
                x={x}
                y={20}
                width={colW - 30}
                height={buildingH - 40}
                rx={10}
                fill="#fbfdff"
                stroke="#d9e2ef"
              />
              <text x={x + 16} y={48} className="graph-building">
                {building}
              </text>
              {list.map((d, i) => {
                const nx = x + 20 + i * 0;
                const ny = 70 + i * 118;
                const nw = colW - 70;
                const color = statusColor[d.status];
                const abnormal = d.status === "retest" || d.status === "resettable";
                const sx = state.supports.find((s) => s.supportNo === d.supportNo);
                const supportY = ny + 78;
                return (
                  <g key={d.componentNo}>
                    {sx && (
                      <line
                        x1={nx + nw / 2}
                        y1={ny + 50}
                        x2={nx + nw / 2}
                        y2={supportY}
                        stroke={color}
                        strokeWidth={2}
                        strokeDasharray={d.status === "released" ? "5 4" : undefined}
                      />
                    )}
                    <rect
                      x={nx}
                      y={ny}
                      width={nw}
                      height={54}
                      rx={8}
                      fill="#ffffff"
                      stroke={color}
                      strokeWidth={abnormal ? 2.5 : 1.5}
                    />
                    {abnormal && (
                      <g>
                        <circle cx={nx + nw - 16} cy={ny + 14} r={9} fill={color} />
                        <text
                          x={nx + nw - 16}
                          y={ny + 18}
                          textAnchor="middle"
                          className="graph-mark"
                        >
                          !
                        </text>
                      </g>
                    )}
                    <text x={nx + 12} y={ny + 22} className="graph-node">
                      {d.componentNo}
                    </text>
                    <text x={nx + 12} y={ny + 41} className="graph-sub" fill={color}>
                      {d.memberType}
                      {d.throughCrack ? " · 贯穿裂缝" : ""} · {STATUS_LABEL[d.status]}
                    </text>
                    {sx ? (
                      <g>
                        <rect
                          x={nx + nw / 2 - 62}
                          y={supportY}
                          width={124}
                          height={30}
                          rx={6}
                          fill={color}
                          opacity={0.12}
                          stroke={color}
                        />
                        <text
                          x={nx + nw / 2}
                          y={supportY + 20}
                          textAnchor="middle"
                          className="graph-sub"
                          fill={color}
                        >
                          支撑 {sx.supportNo}
                        </text>
                      </g>
                    ) : (
                      <text
                        x={nx + nw / 2}
                        y={supportY + 18}
                        textAnchor="middle"
                        className="graph-sub"
                        fill="#94a3b8"
                      >
                        {d.status === "released" ? "支撑已销记回收" : "暂未支顶"}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {freeSupports.length > 0 && (
          <g>
            <text x={40} y={buildingH + 22} className="graph-building">
              空闲支撑池（可支顶）
            </text>
            {freeSupports.map((s, i) => (
              <g key={s.supportNo}>
                <rect
                  x={40 + i * 172}
                  y={buildingH + 34}
                  width={158}
                  height={40}
                  rx={8}
                  fill="#f0fdfa"
                  stroke="#0f766e"
                />
                <text x={54 + i * 172} y={buildingH + 52} className="graph-node">
                  {s.supportNo}
                </text>
                <text x={54 + i * 172} y={buildingH + 68} className="graph-sub">
                  {s.kind} · 空闲
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
      <div className="graph-legend">
        <span>
          <i className="dot dot-ok" /> 监测中
        </span>
        <span>
          <i className="dot dot-danger" /> 待复测（异常）
        </span>
        <span>
          <i className="dot dot-warn" /> 可复位
        </span>
        <span>
          <i className="dot dot-muted" /> 已销记
        </span>
      </div>
    </div>
  );
}
