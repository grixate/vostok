//! Round-trip tests for the SQLite-backed Signal protocol store.
//!
//! These tests bypass Tauri entirely — they instantiate the store directly
//! against an in-memory SQLite database and drive libsignal's async
//! encrypt/decrypt functions with Alice and Bob identities.

use std::sync::{Arc, Mutex};

use libsignal_protocol::{
    kem, message_decrypt_prekey, message_encrypt, process_prekey_bundle, CiphertextMessageType,
    DeviceId, GenericSignedPreKey, IdentityKeyPair, KeyPair, KyberPreKeyRecord, KyberPreKeyStore,
    PreKeyBundle, PreKeyRecord, PreKeySignalMessage, PreKeyStore, ProtocolAddress,
    SignedPreKeyRecord, SignedPreKeyStore, Timestamp,
};
use rand::TryRngCore as _;
use rusqlite::Connection;

use super::store::{SharedConnection, SqliteSignalStore};

const SCHEMA_SQL: &str = include_str!("schema.sql");

fn fresh_store(server_id: &str) -> SqliteSignalStore {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch(SCHEMA_SQL).expect("apply schema");
    let shared: SharedConnection = Arc::new(Mutex::new(conn));
    SqliteSignalStore::new(shared, server_id)
}

fn register_identity(store: &SqliteSignalStore) -> (IdentityKeyPair, u32) {
    let mut rng = rand::rngs::OsRng.unwrap_err();
    let identity = IdentityKeyPair::generate(&mut rng);
    let reg_id: u32 = 1234;
    store
        .save_local_identity(&identity, reg_id)
        .expect("save identity");
    (identity, reg_id)
}

#[tokio::test]
async fn round_trip_direct_message_with_pqxdh() {
    let mut alice_store = fresh_store("server-a");
    let mut bob_store = fresh_store("server-a");

    let (_alice_identity, _alice_reg) = register_identity(&alice_store);
    let (bob_identity, bob_reg) = register_identity(&bob_store);

    // Bob generates prekeys and Kyber prekey.
    let mut rng = rand::rngs::OsRng.unwrap_err();
    let bob_signed_kp = KeyPair::generate(&mut rng);
    let bob_signed_sig = bob_identity
        .private_key()
        .calculate_signature(&bob_signed_kp.public_key.serialize(), &mut rng)
        .expect("sign")
        .into_vec();
    let bob_signed_rec: SignedPreKeyRecord = <SignedPreKeyRecord as GenericSignedPreKey>::new(
        1u32.into(),
        Timestamp::from_epoch_millis(0),
        &bob_signed_kp,
        &bob_signed_sig,
    );
    bob_store
        .signed_pre_key
        .save_signed_pre_key(1u32.into(), &bob_signed_rec)
        .await
        .expect("save signed prekey");

    let bob_onetime_kp = KeyPair::generate(&mut rng);
    let bob_onetime_rec = PreKeyRecord::new(2u32.into(), &bob_onetime_kp);
    bob_store
        .pre_key
        .save_pre_key(2u32.into(), &bob_onetime_rec)
        .await
        .expect("save one-time prekey");

    let bob_kyber = KyberPreKeyRecord::generate(
        kem::KeyType::Kyber1024,
        3u32.into(),
        bob_identity.private_key(),
    )
    .expect("gen kyber");
    bob_store
        .kyber_pre_key
        .save_kyber_pre_key(3u32.into(), &bob_kyber)
        .await
        .expect("save kyber");

    // Alice builds a prekey bundle for Bob and processes it.
    let bob_address = ProtocolAddress::new("bob".to_string(), DeviceId::new(1).unwrap());
    let bundle = PreKeyBundle::new(
        bob_reg,
        DeviceId::new(1).unwrap(),
        Some((2u32.into(), bob_onetime_kp.public_key.clone())),
        1u32.into(),
        bob_signed_kp.public_key.clone(),
        bob_signed_sig.clone(),
        3u32.into(),
        <KyberPreKeyRecord as GenericSignedPreKey>::public_key(&bob_kyber).expect("kyber pub"),
        <KyberPreKeyRecord as GenericSignedPreKey>::signature(&bob_kyber).expect("kyber sig"),
        *bob_identity.identity_key(),
    )
    .expect("build bundle");

    process_prekey_bundle(
        &bob_address,
        &mut alice_store.session,
        &mut alice_store.identity,
        &bundle,
        std::time::SystemTime::now(),
        &mut rng,
    )
    .await
    .expect("process bundle");

    // Alice encrypts, Bob decrypts.
    let plaintext = b"the eagle has landed";
    let alice_address = ProtocolAddress::new("alice".to_string(), DeviceId::new(1).unwrap());
    let ciphertext = message_encrypt(
        plaintext,
        &bob_address,
        &alice_address,
        &mut alice_store.session,
        &mut alice_store.identity,
        std::time::SystemTime::now(),
        &mut rng,
    )
    .await
    .expect("encrypt");

    // First message must be a PreKey message.
    assert!(matches!(
        ciphertext.message_type(),
        CiphertextMessageType::PreKey
    ));

    let prekey_msg = PreKeySignalMessage::try_from(ciphertext.serialize()).expect("parse");
    let decrypted = message_decrypt_prekey(
        &prekey_msg,
        &alice_address,
        &bob_address,
        &mut bob_store.session,
        &mut bob_store.identity,
        &mut bob_store.pre_key,
        &bob_store.signed_pre_key,
        &mut bob_store.kyber_pre_key,
        &mut rng,
    )
    .await
    .expect("decrypt");

    assert_eq!(decrypted.as_slice(), plaintext);
}
