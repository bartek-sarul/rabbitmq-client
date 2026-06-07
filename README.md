# RabbitMQ Desktop Client

A lightweight, premium, cross-platform desktop application for interacting with RabbitMQ queues and exchanges. Built with Tauri v2 (Rust backend) + React 19 + TypeScript + Zustand + Vite.

## Project Documentation

We have compiled a complete, detailed design specification and architectural guide inside [PROJECT_DOCUMENTATION.md](file:///Users/bartoszs/UEFA/sandbox/rabbit-client/PROJECT_DOCUMENTATION.md).

Refer to that file for:
- System Architecture & Data Flow
- Configuration System Format
- Rust Backend Session Management
- Tauri IPC Commands & Events API
- Frontend Zustand State Schemas & Selectors
- React UI Layouts & Components
- Memory Leak Prevention Guides
- Verification & Compilation Guidelines

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Development App
```bash
npm run tauri dev
```

### 3. Run Test Suite
```bash
# Frontend tests
npm run test

# Backend Rust tests
cargo test --manifest-path src-tauri/Cargo.toml
```

### 4. Build Production Bundle
```bash
npm run tauri build
```
