//! SQLite-backed implementation of libsignal's `*Store` traits.
//!
//! libsignal's `message_encrypt` / `message_decrypt_prekey` functions take
//! each protocol store as a separate `&mut dyn` parameter. Passing `&mut` to
//! the same struct multiple times in one call is impossible in safe Rust, so
//! the store is split into **five distinct wrapper types**, one per trait,
//! all holding a shared `Arc<Mutex<Connection>>` (cheap to clone) plus the
//! `server_id` they scope to. Each wrapper locks the shared connection for
//! the duration of a single trait method and drops the guard before yielding
//! at an `await` — so the `?Send` trait bounds are satisfied and no guard is
//! held across suspension points.
//!
//! `SqliteSignalStore` is a bundle struct with one public field per sub-store
//! so commands can pass `&mut store.session`, `&mut store.identity`, ... to
//! libsignal without fighting the borrow checker.

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use libsignal_protocol::{
    Direction, GenericSignedPreKey, IdentityChange, IdentityKey, IdentityKeyPair,
    IdentityKeyStore, KyberPreKeyId, KyberPreKeyRecord, KyberPreKeyStore, PreKeyId, PreKeyRecord,
    PreKeyStore, ProtocolAddress, PublicKey, SessionRecord, SessionStore, SignalProtocolError,
    SignedPreKeyId, SignedPreKeyRecord, SignedPreKeyStore,
};
use rusqlite::{params, Connection, OptionalExtension};

pub type SharedConnection = Arc<Mutex<Connection>>;
type SignalResult<T> = std::result::Result<T, SignalProtocolError>;

const SCHEMA_SQL: &str = include_str!("schema.sql");
const SCHEMA_VERSION: i64 = 1;

/// Open or create the signal.db file at the given path and apply the schema.
pub fn open_database(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", &"WAL")?;
    conn.pragma_update(None, "synchronous", &"NORMAL")?;
    conn.pragma_update(None, "foreign_keys", &"ON")?;
    conn.execute_batch(SCHEMA_SQL)?;
    conn.execute(
        "INSERT OR IGNORE INTO schema_version (version) VALUES (?1)",
        params![SCHEMA_VERSION],
    )?;
    Ok(conn)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn db_error(err: rusqlite::Error) -> SignalProtocolError {
    // rusqlite::Error isn't UnwindSafe (via its boxed source), so we can't
    // use ApplicationCallbackError — fall back to the stringly-typed variant.
    SignalProtocolError::FfiBindingError(format!("sqlite: {err}"))
}

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

/// Bundle of five sub-stores sharing one SQLite connection and one server_id.
pub struct SqliteSignalStore {
    pub identity: IdentityStore,
    pub session: SessionStoreImpl,
    pub pre_key: PreKeyStoreImpl,
    pub signed_pre_key: SignedPreKeyStoreImpl,
    pub kyber_pre_key: KyberPreKeyStoreImpl,

    conn: SharedConnection,
    server_id: String,
}

impl SqliteSignalStore {
    pub fn new(conn: SharedConnection, server_id: impl Into<String>) -> Self {
        let server_id = server_id.into();
        Self {
            identity: IdentityStore {
                conn: Arc::clone(&conn),
                server_id: server_id.clone(),
            },
            session: SessionStoreImpl {
                conn: Arc::clone(&conn),
                server_id: server_id.clone(),
            },
            pre_key: PreKeyStoreImpl {
                conn: Arc::clone(&conn),
                server_id: server_id.clone(),
            },
            signed_pre_key: SignedPreKeyStoreImpl {
                conn: Arc::clone(&conn),
                server_id: server_id.clone(),
            },
            kyber_pre_key: KyberPreKeyStoreImpl {
                conn: Arc::clone(&conn),
                server_id: server_id.clone(),
            },
            conn,
            server_id,
        }
    }

    /// Install the local identity (one-time at registration).
    pub fn save_local_identity(
        &self,
        identity: &IdentityKeyPair,
        registration_id: u32,
    ) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        conn.execute(
            "INSERT OR REPLACE INTO local_identity
                (server_id, identity_key_pair, registration_id, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                self.server_id,
                identity.serialize().to_vec(),
                registration_id,
                now_ms(),
            ],
        )?;
        Ok(())
    }

    /// Wipe every row for this server_id. Used by logout / re-registration.
    pub fn wipe(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        let tx = conn.unchecked_transaction()?;
        for table in [
            "local_identity",
            "trusted_identities",
            "sessions",
            "pre_keys",
            "signed_pre_keys",
            "kyber_pre_keys",
        ] {
            tx.execute(
                &format!("DELETE FROM {table} WHERE server_id = ?1"),
                params![self.server_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// IdentityKeyStore
// ---------------------------------------------------------------------------

pub struct IdentityStore {
    conn: SharedConnection,
    server_id: String,
}

#[async_trait(?Send)]
impl IdentityKeyStore for IdentityStore {
    async fn get_identity_key_pair(&self) -> SignalResult<IdentityKeyPair> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        let bytes: Vec<u8> = conn
            .query_row(
                "SELECT identity_key_pair FROM local_identity WHERE server_id = ?1",
                params![self.server_id],
                |row| row.get(0),
            )
            .map_err(db_error)?;
        IdentityKeyPair::try_from(bytes.as_slice())
    }

    async fn get_local_registration_id(&self) -> SignalResult<u32> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        let id: i64 = conn
            .query_row(
                "SELECT registration_id FROM local_identity WHERE server_id = ?1",
                params![self.server_id],
                |row| row.get(0),
            )
            .map_err(db_error)?;
        Ok(id as u32)
    }

    async fn save_identity(
        &mut self,
        address: &ProtocolAddress,
        identity: &IdentityKey,
    ) -> SignalResult<IdentityChange> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        let existing: Option<Vec<u8>> = conn
            .query_row(
                "SELECT identity_key FROM trusted_identities
                 WHERE server_id = ?1 AND address_name = ?2 AND device_id = ?3",
                params![self.server_id, address.name(), u32::from(address.device_id())],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?;

        let new_bytes = identity.serialize().to_vec();
        let changed = match &existing {
            Some(old) => *old != new_bytes,
            None => false, // first save is not a change
        };

        conn.execute(
            "INSERT INTO trusted_identities
                (server_id, address_name, device_id, identity_key, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(server_id, address_name, device_id) DO UPDATE
                SET identity_key = excluded.identity_key,
                    updated_at = excluded.updated_at",
            params![
                self.server_id,
                address.name(),
                u32::from(address.device_id()),
                new_bytes,
                now_ms(),
            ],
        )
        .map_err(db_error)?;

        Ok(if changed {
            IdentityChange::ReplacedExisting
        } else {
            IdentityChange::NewOrUnchanged
        })
    }

    async fn is_trusted_identity(
        &self,
        address: &ProtocolAddress,
        identity: &IdentityKey,
        _direction: Direction,
    ) -> SignalResult<bool> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        let existing: Option<Vec<u8>> = conn
            .query_row(
                "SELECT identity_key FROM trusted_identities
                 WHERE server_id = ?1 AND address_name = ?2 AND device_id = ?3",
                params![self.server_id, address.name(), u32::from(address.device_id())],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?;

        // TOFU: trust on first use. Known keys must match exactly.
        Ok(match existing {
            None => true,
            Some(bytes) => bytes == identity.serialize().to_vec(),
        })
    }

    async fn get_identity(
        &self,
        address: &ProtocolAddress,
    ) -> SignalResult<Option<IdentityKey>> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        let bytes: Option<Vec<u8>> = conn
            .query_row(
                "SELECT identity_key FROM trusted_identities
                 WHERE server_id = ?1 AND address_name = ?2 AND device_id = ?3",
                params![self.server_id, address.name(), u32::from(address.device_id())],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?;

        match bytes {
            Some(b) => Ok(Some(IdentityKey::decode(&b)?)),
            None => Ok(None),
        }
    }
}

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

pub struct SessionStoreImpl {
    conn: SharedConnection,
    server_id: String,
}

#[async_trait(?Send)]
impl SessionStore for SessionStoreImpl {
    async fn load_session(
        &self,
        address: &ProtocolAddress,
    ) -> SignalResult<Option<SessionRecord>> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        let bytes: Option<Vec<u8>> = conn
            .query_row(
                "SELECT record FROM sessions
                 WHERE server_id = ?1 AND address_name = ?2 AND device_id = ?3",
                params![self.server_id, address.name(), u32::from(address.device_id())],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?;

        match bytes {
            Some(b) => Ok(Some(SessionRecord::deserialize(&b)?)),
            None => Ok(None),
        }
    }

    async fn store_session(
        &mut self,
        address: &ProtocolAddress,
        record: &SessionRecord,
    ) -> SignalResult<()> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        conn.execute(
            "INSERT INTO sessions
                (server_id, address_name, device_id, record, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(server_id, address_name, device_id) DO UPDATE
                SET record = excluded.record, updated_at = excluded.updated_at",
            params![
                self.server_id,
                address.name(),
                u32::from(address.device_id()),
                record.serialize()?,
                now_ms(),
            ],
        )
        .map_err(db_error)?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// PreKeyStore
// ---------------------------------------------------------------------------

pub struct PreKeyStoreImpl {
    conn: SharedConnection,
    server_id: String,
}

#[async_trait(?Send)]
impl PreKeyStore for PreKeyStoreImpl {
    async fn get_pre_key(&self, prekey_id: PreKeyId) -> SignalResult<PreKeyRecord> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        let bytes: Vec<u8> = conn
            .query_row(
                "SELECT record FROM pre_keys
                 WHERE server_id = ?1 AND key_id = ?2 AND consumed_at IS NULL",
                params![self.server_id, u32::from(prekey_id)],
                |row| row.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    SignalProtocolError::InvalidPreKeyId
                }
                other => db_error(other),
            })?;
        PreKeyRecord::deserialize(&bytes)
    }

    async fn save_pre_key(
        &mut self,
        prekey_id: PreKeyId,
        record: &PreKeyRecord,
    ) -> SignalResult<()> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        conn.execute(
            "INSERT INTO pre_keys (server_id, key_id, record, created_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(server_id, key_id) DO UPDATE
                SET record = excluded.record,
                    created_at = excluded.created_at,
                    consumed_at = NULL",
            params![
                self.server_id,
                u32::from(prekey_id),
                record.serialize()?,
                now_ms(),
            ],
        )
        .map_err(db_error)?;
        Ok(())
    }

    async fn remove_pre_key(&mut self, prekey_id: PreKeyId) -> SignalResult<()> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        conn.execute(
            "UPDATE pre_keys SET consumed_at = ?1
             WHERE server_id = ?2 AND key_id = ?3",
            params![now_ms(), self.server_id, u32::from(prekey_id)],
        )
        .map_err(db_error)?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// SignedPreKeyStore
// ---------------------------------------------------------------------------

pub struct SignedPreKeyStoreImpl {
    conn: SharedConnection,
    server_id: String,
}

#[async_trait(?Send)]
impl SignedPreKeyStore for SignedPreKeyStoreImpl {
    async fn get_signed_pre_key(
        &self,
        signed_prekey_id: SignedPreKeyId,
    ) -> SignalResult<SignedPreKeyRecord> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        let bytes: Vec<u8> = conn
            .query_row(
                "SELECT record FROM signed_pre_keys WHERE server_id = ?1 AND key_id = ?2",
                params![self.server_id, u32::from(signed_prekey_id)],
                |row| row.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    SignalProtocolError::InvalidSignedPreKeyId
                }
                other => db_error(other),
            })?;
        <SignedPreKeyRecord as GenericSignedPreKey>::deserialize(&bytes)
    }

    async fn save_signed_pre_key(
        &mut self,
        signed_prekey_id: SignedPreKeyId,
        record: &SignedPreKeyRecord,
    ) -> SignalResult<()> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        conn.execute(
            "INSERT INTO signed_pre_keys (server_id, key_id, record, created_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(server_id, key_id) DO UPDATE
                SET record = excluded.record, created_at = excluded.created_at",
            params![
                self.server_id,
                u32::from(signed_prekey_id),
                GenericSignedPreKey::serialize(record)?,
                now_ms(),
            ],
        )
        .map_err(db_error)?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// KyberPreKeyStore
// ---------------------------------------------------------------------------

pub struct KyberPreKeyStoreImpl {
    conn: SharedConnection,
    server_id: String,
}

#[async_trait(?Send)]
impl KyberPreKeyStore for KyberPreKeyStoreImpl {
    async fn get_kyber_pre_key(
        &self,
        kyber_prekey_id: KyberPreKeyId,
    ) -> SignalResult<KyberPreKeyRecord> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        let bytes: Vec<u8> = conn
            .query_row(
                "SELECT record FROM kyber_pre_keys WHERE server_id = ?1 AND key_id = ?2",
                params![self.server_id, u32::from(kyber_prekey_id)],
                |row| row.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    SignalProtocolError::InvalidKyberPreKeyId
                }
                other => db_error(other),
            })?;
        <KyberPreKeyRecord as GenericSignedPreKey>::deserialize(&bytes)
    }

    async fn save_kyber_pre_key(
        &mut self,
        kyber_prekey_id: KyberPreKeyId,
        record: &KyberPreKeyRecord,
    ) -> SignalResult<()> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        conn.execute(
            "INSERT INTO kyber_pre_keys (server_id, key_id, record, created_at, used)
             VALUES (?1, ?2, ?3, ?4, 0)
             ON CONFLICT(server_id, key_id) DO UPDATE
                SET record = excluded.record,
                    created_at = excluded.created_at",
            params![
                self.server_id,
                u32::from(kyber_prekey_id),
                GenericSignedPreKey::serialize(record)?,
                now_ms(),
            ],
        )
        .map_err(db_error)?;
        Ok(())
    }

    async fn mark_kyber_pre_key_used(
        &mut self,
        kyber_prekey_id: KyberPreKeyId,
        _ec_prekey_id: SignedPreKeyId,
        _base_key: &PublicKey,
    ) -> SignalResult<()> {
        let conn = self.conn.lock().expect("signal db mutex poisoned");
        conn.execute(
            "UPDATE kyber_pre_keys SET used = 1
             WHERE server_id = ?1 AND key_id = ?2",
            params![self.server_id, u32::from(kyber_prekey_id)],
        )
        .map_err(db_error)?;
        Ok(())
    }
}
