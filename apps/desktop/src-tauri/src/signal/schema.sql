-- Vostok Signal protocol store schema (SQLite).
--
-- Backs libsignal-protocol's IdentityKeyStore, SessionStore, PreKeyStore,
-- SignedPreKeyStore, and KyberPreKeyStore traits.
--
-- Every table is namespaced by `server_id` so a single signal.db can hold
-- crypto state for multiple Vostok servers (matches the multi-server model
-- already present in apps/web — see activeServerId / resolveServerScope).
--
-- Records are stored as their libsignal serialized byte form (the crate's
-- canonical on-disk representation), not as parsed fields. This keeps the
-- schema forward-compatible with libsignal version bumps.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

-- One row per (server_id). Holds the local device's identity key pair and
-- registration id. Created at registration time, never updated.
CREATE TABLE IF NOT EXISTS local_identity (
    server_id         TEXT    NOT NULL PRIMARY KEY,
    identity_key_pair BLOB    NOT NULL,  -- IdentityKeyPair::serialize()
    registration_id   INTEGER NOT NULL,
    created_at        INTEGER NOT NULL   -- unix ms
);

-- Trusted remote identity keys (TOFU — trust on first use). Updated when
-- save_identity is called; is_trusted_identity consults this table.
CREATE TABLE IF NOT EXISTS trusted_identities (
    server_id     TEXT    NOT NULL,
    address_name  TEXT    NOT NULL,  -- username or uuid
    device_id     INTEGER NOT NULL,
    identity_key  BLOB    NOT NULL,  -- IdentityKey::serialize()
    updated_at    INTEGER NOT NULL,
    PRIMARY KEY (server_id, address_name, device_id)
);

-- Double Ratchet sessions. One row per peer device.
CREATE TABLE IF NOT EXISTS sessions (
    server_id    TEXT    NOT NULL,
    address_name TEXT    NOT NULL,
    device_id    INTEGER NOT NULL,
    record       BLOB    NOT NULL,  -- SessionRecord::serialize()
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (server_id, address_name, device_id)
);

-- One-time prekeys. Soft-deleted via `consumed_at` rather than DELETE so we
-- can audit replay attempts if needed.
CREATE TABLE IF NOT EXISTS pre_keys (
    server_id   TEXT    NOT NULL,
    key_id      INTEGER NOT NULL,
    record      BLOB    NOT NULL,  -- PreKeyRecord::serialize()
    created_at  INTEGER NOT NULL,
    consumed_at INTEGER,
    PRIMARY KEY (server_id, key_id)
);

-- Signed prekeys. Rotated weekly (or on demand). We keep superseded rows
-- around for a grace period so in-flight messages can still decrypt.
CREATE TABLE IF NOT EXISTS signed_pre_keys (
    server_id   TEXT    NOT NULL,
    key_id      INTEGER NOT NULL,
    record      BLOB    NOT NULL,  -- SignedPreKeyRecord::serialize()
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (server_id, key_id)
);

-- Kyber (ML-KEM) prekeys for PQXDH. Rotated alongside signed prekeys.
-- `used` tracks which kyber prekey consumed which ec base key, for replay
-- protection per libsignal's mark_kyber_pre_key_used contract.
CREATE TABLE IF NOT EXISTS kyber_pre_keys (
    server_id   TEXT    NOT NULL,
    key_id      INTEGER NOT NULL,
    record      BLOB    NOT NULL,  -- KyberPreKeyRecord::serialize()
    created_at  INTEGER NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (server_id, key_id)
);

CREATE INDEX IF NOT EXISTS idx_pre_keys_live
    ON pre_keys(server_id) WHERE consumed_at IS NULL;
