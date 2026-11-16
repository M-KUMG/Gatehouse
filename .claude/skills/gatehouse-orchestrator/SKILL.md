---
name: "gatehouse-orchestrator"
description: "Project context and step-by-step orchestration for Gatehouse, a web and Electron simulator for Arduino and RP2040 boards plus circuits that runs real firmware. Use for any Gatehouse request, one task at a time."
---

# Gatehouse orchestrator

This skill gives you the picture of what Gatehouse is, so every prompt lands in the right place. It is not a script for building everything. The user works through the project one prompt at a time, and each prompt is usually one small task.

## The one rule: do only what this prompt asks

- Treat each message as a single task. Do that task well, then stop.
- Do not start other phases, scaffold the whole monorepo, or build features the user did not ask for. The big picture below is background so your choices fit, not a to-do list.
- If the task depends on something that does not exist yet, say so and do the smallest stub or interface needed, or ask. Do not quietly build the missing piece in full.
- At the end, give a short result and, at most, one natural next step the user could ask for. They decide whether to take it.
- If the user explicitly asks for a plan or roadmap, give it, but still do not execute it unless asked.

Why: the user is a student building this over many sessions, often on a phone. Small, finished, verifiable steps are easier for them to follow, review and keep consistent than large dumps.

## What Gatehouse is

A university project: a circuit and microcontroller simulator that runs in the browser (hosted on the user's own VPS) and as an Electron desktop app, sharing one codebase.

Its defining ideas:
- **Real code:** user sketches are compiled to firmware and executed on an emulated CPU, not scripted fake behavior.
- **Boards:** Arduino AVR (Uno, Nano, Mega) and Raspberry Pi Pico (RP2040), with room for more targets later.
- **Circuits:** a breadboard-style editor with common parts (LED, button, resistor, potentiometer, display, sensors) and a basic analog solver.
- **Multi-app structures:** one project can hold several boards, each with its own multi-file firmware project, wired together over GPIO, UART, I2C and SPI.

## Default architecture (use it for consistency, change only for a stated reason)

TypeScript monorepo, pnpm workspaces:
- `packages/core`: simulation clock, event scheduler, pin/net model, interfaces for components and MCU targets, project file format.
- `packages/mcu-avr` (avr8js) and `packages/mcu-rp2040` (rp2040js): emulator wrappers.
- `packages/analog`: analog solver (modified nodal analysis, or ngspice via WASM).
- `packages/components`: one file per part (pins, behavior, symbol).
- `packages/compiler`: compile pipeline (arduino-cli) with local and remote implementations.
- `packages/ui`: React editor, code editor, serial monitor.
- `apps/web`, `apps/desktop` (Electron), `apps/server` (VPS compile and storage).

Why this shape: core and emulators must run headless so they can be unit-tested and run in Web Workers, one worker per board, so several boards run in parallel and the UI never freezes.

## Rules that keep pieces compatible

- **Timing:** drive everything from cycle counts on a global timeline, never wall-clock timers. Boards run in time slices that sync at bus events, so boards with different clock speeds stay consistent.
- **Mixed-signal:** digital pin changes trigger an analog solve at that timestamp, and results feed back as pin voltages. Keep this boundary in one module.
- **Deterministic:** same project and inputs give the same output, which makes tests reliable.
- **Project format:** one versioned JSON file (boards, wiring, parts, per-board source tree).
- **Compile service safety:** it compiles untrusted code on the VPS, so it needs a sandbox (container, no network, CPU, memory and time limits) and rate limiting. The Electron app compiles locally.
- **Interfaces before implementations:** if a task touches a package boundary, check the existing interface in `core` first and extend it deliberately rather than bypassing it.

## How to work on a single task

1. Look at the current repo state and `docs/PLAN.md` if they exist, so you build on what is there. If there is no repo yet, ask where to create it, or create only what the task needs.
2. Place the work in the right package using the architecture above.
3. Implement the smallest complete version, with a test or a runnable demo where it makes sense.
4. Run the tests or demo and report what actually ran.
5. If the task is big enough to split, delegate pieces to subagents with disjoint files and a clear brief (goal, interface, files owned, how to test, what not to touch), then integrate and verify yourself. For small tasks, just do it directly.
6. Add a line to `docs/PLAN.md` (create it if useful) noting what was done and any open decision, so later sessions have context. Keep it short.

## Background roadmap (for orientation only, do not run it unprompted)

One-board slice with a blink demo, then component library and serial monitor, then RP2040, then multi-board wiring and buses, then the analog solver and mixed-signal sync, then persistence, compile server and Electron shell, then polish and docs. Use this only to judge what a task depends on and what can wait.

## Naming and legal

The project is called Gatehouse; keep the name in one constant or config so renaming is a one-line change. It is non-commercial. Do not put Arduino, Raspberry Pi or Pico in the product name or branding; descriptive compatibility mentions are fine. Check dependency licenses before bundling (avr8js and rp2040js are MIT).

## Style

Lead with the outcome, keep replies short, ask a question only when a decision is expensive to reverse.