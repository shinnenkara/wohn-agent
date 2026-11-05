import { FUNNEL_STAGES, STAGE_LABELS, type FunnelStage } from "./progress.js";

export interface FlowNode {
  id: FunnelStage;
  label: string;
  count: number;
}

export interface FlowLink {
  source: FunnelStage;
  target: FunnelStage;
  value: number;
}

export interface FlowDiagram {
  nodes: FlowNode[];
  links: FlowLink[];
}

export function buildFlow(
  stages: readonly { stage: FunnelStage }[],
  transitions: readonly { fromStage: FunnelStage; toStage: FunnelStage }[],
): FlowDiagram {
  const counts = new Map<FunnelStage, number>();
  for (const stage of FUNNEL_STAGES) {
    counts.set(stage, 0);
  }
  for (const row of stages) {
    counts.set(row.stage, (counts.get(row.stage) ?? 0) + 1);
  }
  const links = new Map<string, FlowLink>();
  for (const hop of transitions) {
    const key = `${hop.fromStage}>${hop.toStage}`;
    const existing = links.get(key);
    if (existing) {
      existing.value += 1;
    } else {
      links.set(key, { source: hop.fromStage, target: hop.toStage, value: 1 });
    }
  }
  const touched = new Set<FunnelStage>();
  for (const stage of FUNNEL_STAGES) {
    if ((counts.get(stage) ?? 0) > 0) {
      touched.add(stage);
    }
  }
  for (const link of links.values()) {
    touched.add(link.source);
    touched.add(link.target);
  }
  return {
    nodes: FUNNEL_STAGES.filter((stage) => touched.has(stage)).map((stage) => ({
      id: stage,
      label: STAGE_LABELS[stage],
      count: counts.get(stage) ?? 0,
    })),
    links: [...links.values()],
  };
}
