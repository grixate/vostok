# @vostok/crypto-core

Shared crypto contract package for web/desktop clients.

- `src/index.ts` exposes portable runtime helpers used by the app.
- `rust/` contains the Rust core crate intended for WASM bindings.

To build the Rust WASM artifact locally:

```bash
cd packages/crypto-core/rust
cargo build --target wasm32-unknown-unknown
```
