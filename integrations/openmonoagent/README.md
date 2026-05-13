# integrations/openmonoagent

OpenMonoAgent integration for Sigma Core OS.

Connects Sigma Dev to the OpenMonoAgent framework for extended coding, tool-use,
and autonomous development workflows.

## Status

Phase 1 stub. Connection planned for Phase 3.

## Planned Integration

- Sigma Dev delegates complex coding tasks to OpenMonoAgent
- OpenMonoAgent handles multi-step workflows (scaffold, test, commit)
- All destructive actions still route through `core/policies` for human approval

## Setup

TBD — pending OpenMonoAgent API documentation.

## Notes

- OpenMonoAgent runs as a subprocess or HTTP service
- Sigma Dev acts as the Sigma Core OS adapter/proxy
- Tool calls from OpenMonoAgent are logged by `core/tools`
