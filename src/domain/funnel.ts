import { FUNNEL_STAGES, parentStage, STAGE_LABELS, type FunnelStage } from "./progress.js";

export interface FlowNode {
  id: FunnelStage;
  label: string;
  count: number;
  stock: number;
  parent: FunnelStage | null;
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

export function buildFlow(stages: readonly { stage: FunnelStage }[]): FlowDiagram {
  const stock = new Map<FunnelStage, number>();
  for (const stage of FUNNEL_STAGES) {
    stock.set(stage, 0);
  }
  for (const row of stages) {
    stock.set(row.stage, (stock.get(row.stage) ?? 0) + 1);
  }
  const count = new Map<FunnelStage, number>();
  const throughput = (stage: FunnelStage): number => {
    const saved = count.get(stage);
    if (saved !== undefined) {
      return saved;
    }
    let total = stock.get(stage) ?? 0;
    for (const child of FUNNEL_STAGES) {
      if (parentStage(child) === stage) {
        total += throughput(child);
      }
    }
    count.set(stage, total);
    return total;
  };
  for (const stage of FUNNEL_STAGES) {
    throughput(stage);
  }
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  for (const stage of FUNNEL_STAGES) {
    const reached = count.get(stage) ?? 0;
    if (reached <= 0) {
      continue;
    }
    const parent = parentStage(stage);
    nodes.push({
      id: stage,
      label: STAGE_LABELS[stage],
      count: reached,
      stock: stock.get(stage) ?? 0,
      parent,
    });
    if (parent) {
      links.push({ source: parent, target: stage, value: reached });
    }
  }
  return { nodes, links };
}
