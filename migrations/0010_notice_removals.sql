-- NMC sometimes deletes notices. A notice not seen for 3 days whose PDF link returns "not found" is marked removed. It stays in history.
ALTER TABLE notices ADD COLUMN removed_at TEXT;
ALTER TABLE notices ADD COLUMN removal_checked_at TEXT;
