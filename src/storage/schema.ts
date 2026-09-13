export const LOCAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS completions (
    member_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    task_date TEXT NOT NULL,
    status TEXT NOT NULL,
    revision INTEGER NOT NULL,
    sync_status TEXT NOT NULL,
    last_operation_id TEXT,
    PRIMARY KEY (member_id, plan_id, task_date)
  );
`;
