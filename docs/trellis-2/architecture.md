# Trellis 2.0 Architecture

Status: initial implementation plan.

## System shape

```text
Trellis API/control plane
  - Motion Contracts
  - field registry
  - validation
  - certification
  - approvals
  - permissions

Trellis Evidence Store
  - candidates/enrollments
  - raw source snapshots
  - normalized sequencer events
  - normalized CRM outcomes
  - field coverage snapshots
  - evidence-pack inputs
  - metric rollups

Interfaces
  - CLI
  - web app later
  - MCP server
  - Clay HTTP API columns
  - connector workers
```

The CLI is not the product backend. It is one interface to the Trellis control plane.

## MotherDuck role

MotherDuck remains useful, but its role changes from generic analytics substrate to **Motion Evidence Warehouse**.

Recommended split:

```text
App DB
  orgs, users, contracts, permissions, approvals, config

MotherDuck
  enrollments, field values, events, outcomes, preflight snapshots, evidence rollups

Object storage
  raw CSVs, raw webhook payloads, large JSON snapshots, evidence artifacts
```

Trellis is warehouse-like, but it should not market itself as the customer's full GTM warehouse. It stores the evidence needed to validate GTM motions.

## Core tables

```text
motion_contracts
motion_contract_versions
motion_runs
field_registry
subjects
enrollments
external_bindings
raw_events
normalized_events
outcome_events
preflight_results
evidence_packs
learning_candidates
approved_learnings
audit_logs
```

`enrollments` is the core join table. It says: this subject entered this motion run under this variant.

## Event normalization

Trellis should preserve raw provider labels and map them deterministically:

```text
raw_label = provider's label
normalized_label = Trellis enum
label_source = smartlead | instantly | hubspot | salesforce | trellis | human
```

In v1, if Smartlead says a reply is positive, Trellis can map it as `positive_reply`, but it should not pretend that label is absolute truth.

## Non-negotiable ID propagation

Every certified run should propagate these fields downstream:

```text
motion_id
motion_run_id
subject_id
enrollment_id
variant_id
```

At minimum, sequencers must keep `motion_run_id`, `enrollment_id`, and `variant_id`. CRM propagation is ideal and required for certified outcome analytics.
