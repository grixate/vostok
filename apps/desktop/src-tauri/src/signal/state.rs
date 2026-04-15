//! Tauri-managed state that holds the shared SQLite connection for the
//! Signal protocol store.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use super::store::{open_database, SharedConnection};

pub struct SignalState {
    conn: SharedConnection,
}

impl SignalState {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Arc::new(Mutex::new(conn)),
        }
    }

    pub fn conn(&self) -> SharedConnection {
        Arc::clone(&self.conn)
    }
}

/// Resolve the signal.db path inside Tauri's app-data dir and open/create it.
pub fn init_signal_state(app: &AppHandle) -> Result<SignalState, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create dir {dir:?}: {e}"))?;
    let path: PathBuf = dir.join("signal.db");
    let conn = open_database(&path).map_err(|e| format!("open signal.db: {e}"))?;
    Ok(SignalState::new(conn))
}
