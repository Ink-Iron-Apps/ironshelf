-- Cloud authentication configuration.
-- Stores the claim_token and cloud service URL for central auth relay.
CREATE TABLE IF NOT EXISTS cloud_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
