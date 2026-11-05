export interface AgendaEvent {
  id: string;
  title: string;
  description: string;
  start: string;
  end: string;
  place: string;
}

export interface AgendaPage {
  events: AgendaEvent[];
  nextToken: string | null;
  expired: boolean;
}

export interface Agenda {
  listSince(since: Date, till: Date | null): Promise<AgendaPage>;
  changes(token: string): Promise<AgendaPage>;
}
