# Chat Tools Block Context

Context for the chat tooling layer that defines available model tools, runtime execution hooks, persisted context, and persisted block metadata.

## Context Log

[2026-04-04T00:00:00.000Z] Added persistent context and block metadata support for the chat tooling layer. The runtime now exposes Context and Block tools, stores reusable context in `.odex/context`, stores block schemas in `.odex/blocks`, and updates model instructions so context is loaded before execution and at least one affected block is updated after project changes.
