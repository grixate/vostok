//! Tauri command handlers bridging the webview to libsignal-protocol.
//!
//! All commands are `async`, take a `State<SignalState>` that owns the
//! shared SQLite connection, and return either a typed JSON-serializable
//! result or a `String` error. Errors are stringified so the frontend can
//! display them without pulling in a custom error type across the IPC
//! boundary.

use std::time::SystemTime;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use libsignal_protocol::{
    kem, message_decrypt_prekey, message_decrypt_signal, message_encrypt,
    process_prekey_bundle, CiphertextMessageType, DeviceId, GenericSignedPreKey, IdentityKey,
    IdentityKeyPair, KeyPair, KyberPreKeyRecord, PreKeyBundle, PreKeyRecord, PreKeySignalMessage,
    PreKeyStore, ProtocolAddress, PublicKey, SignalMessage, SignedPreKeyRecord,
    SignedPreKeyStore, Timestamp, KyberPreKeyStore,
};
use futures::executor::block_on;
use rand::TryRngCore as _;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::state::SignalState;
use super::store::SqliteSignalStore;

// ---------------------------------------------------------------------------
// DTOs mirroring the wire shapes used by the Elixir server.
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct RegisterIdentityResult {
    pub registration_id: u32,
    pub identity_public_key_b64: String,
    pub signed_prekey: SignedPreKeyDto,
    pub one_time_prekeys: Vec<PreKeyDto>,
    pub kyber_prekey: KyberPreKeyDto,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SignedPreKeyDto {
    pub key_id: u32,
    pub public_key_b64: String,
    pub signature_b64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct PreKeyDto {
    pub key_id: u32,
    pub public_key_b64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct KyberPreKeyDto {
    pub key_id: u32,
    pub public_key_b64: String,
    pub signature_b64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RemotePreKeyBundle {
    pub device_id: u32,
    pub registration_id: u32,
    pub identity_public_key_b64: String,
    pub signed_prekey_id: u32,
    pub signed_prekey_public_b64: String,
    pub signed_prekey_signature_b64: String,
    pub one_time_prekey_id: Option<u32>,
    pub one_time_prekey_public_b64: Option<String>,
    pub kyber_prekey_id: u32,
    pub kyber_prekey_public_b64: String,
    pub kyber_prekey_signature_b64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct EncryptResult {
    /// libsignal ciphertext message type (1 = Whisper, 3 = PreKey).
    pub message_type: u8,
    pub ciphertext_b64: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn parse_address(name: &str, device_id: u32) -> Result<ProtocolAddress, String> {
    let did = DeviceId::try_from(device_id).map_err(err)?;
    Ok(ProtocolAddress::new(name.to_owned(), did))
}

fn now() -> SystemTime {
    SystemTime::now()
}

fn unix_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Generate a fresh local identity, signed prekey, N one-time prekeys, and a
/// Kyber prekey. Persists everything to the store and returns the publishable
/// bundle in the shape the Vostok server's /api/v1/prekey/publish endpoint
/// expects.
#[tauri::command]
pub fn signal_register_identity(
    state: State<'_, SignalState>,
    server_id: String,
    one_time_count: u32,
) -> Result<RegisterIdentityResult, String> {
    block_on(register_identity_inner(state, server_id, one_time_count))
}

async fn register_identity_inner(
    state: State<'_, SignalState>,
    server_id: String,
    one_time_count: u32,
) -> Result<RegisterIdentityResult, String> {
    let mut store = SqliteSignalStore::new(state.conn(), &server_id);
    // rand 0.9: OsRng implements TryRngCore; unwrap_err() wraps it into an
    // infallible RngCore+CryptoRng for libsignal's trait bounds.
    let mut rng = rand::rngs::OsRng.unwrap_err();

    // Identity + registration id.
    let identity = IdentityKeyPair::generate(&mut rng);
    let registration_id: u32 = rand::Rng::random_range(&mut rng, 1u32..16380u32);
    store
        .save_local_identity(&identity, registration_id)
        .map_err(err)?;

    // Signed prekey.
    let signed_prekey_id: u32 = 1;
    let signed_kp = KeyPair::generate(&mut rng);
    let signed_signature: Vec<u8> = identity
        .private_key()
        .calculate_signature(&signed_kp.public_key.serialize(), &mut rng)
        .map_err(err)?
        .into_vec();
    let signed_record: SignedPreKeyRecord = <SignedPreKeyRecord as GenericSignedPreKey>::new(
        signed_prekey_id.into(),
        Timestamp::from_epoch_millis(unix_now_ms()),
        &signed_kp,
        &signed_signature,
    );
    store
        .signed_pre_key
        .save_signed_pre_key(signed_prekey_id.into(), &signed_record)
        .await
        .map_err(err)?;

    // One-time prekeys.
    let mut one_time = Vec::with_capacity(one_time_count as usize);
    for i in 0..one_time_count {
        let key_id = i + 1;
        let kp = KeyPair::generate(&mut rng);
        let rec = PreKeyRecord::new(key_id.into(), &kp);
        store
            .pre_key
            .save_pre_key(key_id.into(), &rec)
            .await
            .map_err(err)?;
        one_time.push(PreKeyDto {
            key_id,
            public_key_b64: B64.encode(kp.public_key.serialize()),
        });
    }

    // Kyber prekey (Kyber1024 for ML-KEM; feature flag kyber768 is the
    // classic Signal v1 variant).
    let kyber_prekey_id: u32 = 1;
    let kyber_record =
        KyberPreKeyRecord::generate(kem::KeyType::Kyber1024, kyber_prekey_id.into(), identity.private_key())
            .map_err(err)?;
    let kyber_public_b64 = B64.encode(
        <KyberPreKeyRecord as GenericSignedPreKey>::public_key(&kyber_record)
            .map_err(err)?
            .serialize(),
    );
    let kyber_sig_b64 = B64.encode(
        <KyberPreKeyRecord as GenericSignedPreKey>::signature(&kyber_record).map_err(err)?,
    );
    store
        .kyber_pre_key
        .save_kyber_pre_key(kyber_prekey_id.into(), &kyber_record)
        .await
        .map_err(err)?;

    Ok(RegisterIdentityResult {
        registration_id,
        identity_public_key_b64: B64.encode(identity.public_key().serialize()),
        signed_prekey: SignedPreKeyDto {
            key_id: signed_prekey_id,
            public_key_b64: B64.encode(signed_kp.public_key.serialize()),
            signature_b64: B64.encode(&signed_signature),
        },
        one_time_prekeys: one_time,
        kyber_prekey: KyberPreKeyDto {
            key_id: kyber_prekey_id,
            public_key_b64: kyber_public_b64,
            signature_b64: kyber_sig_b64,
        },
    })
}

/// Consume a remote prekey bundle and build the initial Double Ratchet
/// session. Called the first time we send a message to a device.
#[tauri::command]
pub fn signal_process_prekey_bundle(
    state: State<'_, SignalState>,
    server_id: String,
    address_name: String,
    bundle: RemotePreKeyBundle,
) -> Result<(), String> {
    block_on(process_prekey_bundle_inner(state, server_id, address_name, bundle))
}

async fn process_prekey_bundle_inner(
    state: State<'_, SignalState>,
    server_id: String,
    address_name: String,
    bundle: RemotePreKeyBundle,
) -> Result<(), String> {
    let mut store = SqliteSignalStore::new(state.conn(), &server_id);
    let address = parse_address(&address_name, bundle.device_id)?;

    let identity_key = IdentityKey::decode(&B64.decode(&bundle.identity_public_key_b64).map_err(err)?)
        .map_err(err)?;
    let signed_pub = PublicKey::deserialize(
        &B64.decode(&bundle.signed_prekey_public_b64).map_err(err)?,
    )
    .map_err(err)?;
    let signed_sig = B64.decode(&bundle.signed_prekey_signature_b64).map_err(err)?;

    let one_time = match (bundle.one_time_prekey_id, bundle.one_time_prekey_public_b64) {
        (Some(id), Some(pk_b64)) => {
            let pk = PublicKey::deserialize(&B64.decode(&pk_b64).map_err(err)?).map_err(err)?;
            Some((id.into(), pk))
        }
        _ => None,
    };

    let kyber_pub = kem::PublicKey::deserialize(
        &B64.decode(&bundle.kyber_prekey_public_b64).map_err(err)?,
    )
    .map_err(err)?;
    let kyber_sig = B64.decode(&bundle.kyber_prekey_signature_b64).map_err(err)?;
    let device_id = DeviceId::try_from(bundle.device_id).map_err(err)?;

    let pre_key_bundle = PreKeyBundle::new(
        bundle.registration_id,
        device_id,
        one_time,
        bundle.signed_prekey_id.into(),
        signed_pub,
        signed_sig,
        bundle.kyber_prekey_id.into(),
        kyber_pub,
        kyber_sig,
        identity_key,
    )
    .map_err(err)?;

    let mut rng = rand::rngs::OsRng.unwrap_err();
    process_prekey_bundle(
        &address,
        &mut store.session,
        &mut store.identity,
        &pre_key_bundle,
        now(),
        &mut rng,
    )
    .await
    .map_err(err)?;

    Ok(())
}

/// Encrypt a plaintext payload for a single remote device.
/// `local_address` is the sender's own ProtocolAddress (needed by libsignal
/// for sealed-sender/pqxdh local identity lookup).
#[tauri::command]
pub fn signal_encrypt(
    state: State<'_, SignalState>,
    server_id: String,
    local_name: String,
    local_device_id: u32,
    address_name: String,
    device_id: u32,
    plaintext_b64: String,
) -> Result<EncryptResult, String> {
    block_on(encrypt_inner(
        state,
        server_id,
        local_name,
        local_device_id,
        address_name,
        device_id,
        plaintext_b64,
    ))
}

async fn encrypt_inner(
    state: State<'_, SignalState>,
    server_id: String,
    local_name: String,
    local_device_id: u32,
    address_name: String,
    device_id: u32,
    plaintext_b64: String,
) -> Result<EncryptResult, String> {
    let mut store = SqliteSignalStore::new(state.conn(), &server_id);
    let remote = parse_address(&address_name, device_id)?;
    let local = parse_address(&local_name, local_device_id)?;
    let plaintext = B64.decode(&plaintext_b64).map_err(err)?;

    let mut rng = rand::rngs::OsRng.unwrap_err();
    let message = message_encrypt(
        &plaintext,
        &remote,
        &local,
        &mut store.session,
        &mut store.identity,
        now(),
        &mut rng,
    )
    .await
    .map_err(err)?;

    let (message_type, ciphertext) = match message.message_type() {
        CiphertextMessageType::PreKey => (3u8, message.serialize().to_vec()),
        CiphertextMessageType::Whisper => (1u8, message.serialize().to_vec()),
        other => return Err(format!("unexpected ciphertext type {other:?}")),
    };

    Ok(EncryptResult {
        message_type,
        ciphertext_b64: B64.encode(ciphertext),
    })
}

/// Decrypt a ciphertext from a remote device. `message_type` must be 1
/// (Whisper) or 3 (PreKey).
#[tauri::command]
pub fn signal_decrypt(
    state: State<'_, SignalState>,
    server_id: String,
    local_name: String,
    local_device_id: u32,
    address_name: String,
    device_id: u32,
    message_type: u8,
    ciphertext_b64: String,
) -> Result<String, String> {
    block_on(decrypt_inner(
        state,
        server_id,
        local_name,
        local_device_id,
        address_name,
        device_id,
        message_type,
        ciphertext_b64,
    ))
}

async fn decrypt_inner(
    state: State<'_, SignalState>,
    server_id: String,
    local_name: String,
    local_device_id: u32,
    address_name: String,
    device_id: u32,
    message_type: u8,
    ciphertext_b64: String,
) -> Result<String, String> {
    let mut store = SqliteSignalStore::new(state.conn(), &server_id);
    let remote = parse_address(&address_name, device_id)?;
    let local = parse_address(&local_name, local_device_id)?;
    let bytes = B64.decode(&ciphertext_b64).map_err(err)?;

    let mut rng = rand::rngs::OsRng.unwrap_err();
    let plaintext = match message_type {
        3 => {
            let msg = PreKeySignalMessage::try_from(bytes.as_slice()).map_err(err)?;
            message_decrypt_prekey(
                &msg,
                &remote,
                &local,
                &mut store.session,
                &mut store.identity,
                &mut store.pre_key,
                &store.signed_pre_key,
                &mut store.kyber_pre_key,
                &mut rng,
            )
            .await
            .map_err(err)?
        }
        1 => {
            let msg = SignalMessage::try_from(bytes.as_slice()).map_err(err)?;
            let _ = &local; // unused for Whisper messages
            message_decrypt_signal(
                &msg,
                &remote,
                &mut store.session,
                &mut store.identity,
                &mut rng,
            )
            .await
            .map_err(err)?
        }
        other => return Err(format!("invalid message_type {other}")),
    };

    Ok(B64.encode(plaintext))
}

/// Delete all crypto state for a server_id. Used on logout or forced
/// re-registration.
#[tauri::command]
pub fn signal_wipe_all(
    state: State<'_, SignalState>,
    server_id: String,
) -> Result<(), String> {
    let store = SqliteSignalStore::new(state.conn(), &server_id);
    store.wipe().map_err(err)
}
