import type { DatabaseSync } from "node:sqlite";
import type { EventLog } from "../../application/ports/event-log.js";
import type { AgentEvent, AgentStep } from "../../domain/agent-event.js";

interface EventRow {
  scout_id: string | null;
  step: string;
  error_type: string | null;
  dom_snippet: string | null;
  resolution_action: string | null;
  created_at: string;
}

export class SqliteEventLog implements EventLog {
  constructor(private readonly db: DatabaseSync) {}

  append(event: AgentEvent): void {
    this.db
      .prepare(`
        INSERT INTO agent_events (
          scout_id, step, error_type, dom_snippet, resolution_action, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.scoutId,
        event.step,
        event.errorType,
        event.domSnippet,
        event.resolutionAction,
        event.createdAt.toISOString(),
      );
  }

  listAll(): AgentEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM agent_events ORDER BY id ASC")
      .all() as unknown as EventRow[];
    return rows.map((row) => ({
      scoutId: row.scout_id,
      step: row.step as AgentStep,
      errorType: row.error_type,
      domSnippet: row.dom_snippet,
      resolutionAction: row.resolution_action,
      createdAt: new Date(row.created_at),
    }));
  }
}
