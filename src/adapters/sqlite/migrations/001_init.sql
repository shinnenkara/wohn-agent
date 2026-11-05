CREATE TABLE IF NOT EXISTS listings (
    scout_id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT,
    salutation TEXT,
    price_cold REAL,
    rooms REAL,
    area_sqm REAL,
    address TEXT,
    price_warm REAL,
    extra_costs REAL,
    deposit TEXT,
    floor TEXT,
    move_in TEXT,
    description TEXT,
    snapshot TEXT,
    is_plus_only INTEGER DEFAULT 0,
    status TEXT NOT NULL,
    filter_reason TEXT,
    error_code TEXT,
    retry_count INTEGER DEFAULT 0,
    discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    applied_at DATETIME
);

CREATE TABLE IF NOT EXISTS selector_cache (
    action_key TEXT PRIMARY KEY,
    instruction TEXT NOT NULL,
    selector TEXT NOT NULL,
    method TEXT NOT NULL,
    fail_count INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scout_id TEXT,
    step TEXT NOT NULL,
    error_type TEXT,
    dom_snippet TEXT,
    resolution_action TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
