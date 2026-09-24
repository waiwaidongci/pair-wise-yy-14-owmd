import { DossierStatus, STATUS_LABEL } from "../rules/supportRules";

const BADGE_CLASS: Record<DossierStatus, string> = {
  monitoring: "badge badge-ok",
  retest: "badge badge-danger",
  resettable: "badge badge-warn",
  released: "badge badge-muted",
};

export function StatusBadge({ status }: { status: DossierStatus }) {
  return <span className={BADGE_CLASS[status]}>{STATUS_LABEL[status]}</span>;
}

export const LIST_FILTERS: { key: "retest" | "resettable"; label: string }[] = [
  { key: "retest", label: "待复测" },
  { key: "resettable", label: "可复位" },
];
