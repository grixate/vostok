//! Signal protocol integration: bridges the webview to libsignal-protocol
//! over Tauri IPC commands and owns the SQLite-backed protocol store.
//!
//! Module layout:
//! - `schema.sql`  : DDL for the protocol store
//! - `store.rs`    : SqliteSignalStore implementing libsignal's *Store traits
//! - `state.rs`    : SignalState (Tauri-managed shared connection)
//! - `commands.rs` : #[tauri::command] handlers
//!
//! All commands are registered from `main.rs`.

pub mod commands;
pub mod state;
pub mod store;

#[cfg(test)]
mod tests;
