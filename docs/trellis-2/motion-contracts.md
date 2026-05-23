# Trellis 2.0: Motion Contracts

Status: initial product spec.

Trellis 2.0 is GTM engineering infrastructure for making GTM motions testable before launch and evidence-backed after execution.

It is not a CRM, sequencer, enrichment provider, broad analytics platform, or AI SDR. Trellis owns the contract layer, validation layer, evidence layer, and agent-safe learning layer around existing GTM systems.

## Core primitive

A Motion Contract is a versioned spec for one GTM motion:

- hypothesis
- target segment and persona
- systems involved
- required input fields
- variants
- success metrics
- guardrails
- agent permissions
- outcome mapping requirements

The contract creates the golden thread that ties inputs to outputs:

```text
motion_id -> motion_run_id -> subject_id -> enrollment_id -> variant_id
```

These Trellis IDs must be propagated into Clay/source rows, the sequencer, and ideally the CRM. If the IDs do not survive downstream, Trellis can run a diagnostic, but it cannot certify the motion.

## CI/CD translation

### CI: preflight

Before a motion launches, Trellis checks whether it is learnable:

- required fields exist and are populated
- values match allowed variants/enums
- sample size is sufficient per variant
- field coverage meets guardrails
- sequencer and CRM mappings exist
- success metrics are measurable
- agent actions have approval rules

The output is either `CERTIFIED` or `BLOCKED`.

### CD: controlled launch artifacts

Trellis does not need to send emails or run campaigns. In v1, deployment means generating the artifacts GTM engineers need to launch safely:

- Clay required columns
- Clay HTTP API payload
- sequencer custom fields
- CRM field recommendations
- agent permission file
- launch checklist

Native write APIs can come later for systems where that is safe and requested.

## Clay flow

Clay is a source/workbench, not the Trellis system of record.

1. GTM engineer creates a Motion Contract in Trellis.
2. Trellis compiles a Clay implementation pack.
3. GTM engineer builds a Clay table with required columns.
4. Clay HTTP API column calls Trellis row-by-row.
5. Trellis returns certification status plus Trellis IDs.
6. Only certified rows are pushed to Smartlead/Instantly/CRM.

## Output/evidence flow

After launch:

1. Sequencer events are ingested from Smartlead/Instantly/etc.
2. CRM outcome events are ingested from HubSpot/Salesforce/etc.
3. Trellis joins events back to enrollments using Trellis IDs.
4. Trellis compiles an Evidence Pack.
5. A human approves or rejects learning candidates.
6. Approved learnings become agent-readable GTM memory.

## Certified vs diagnostic runs

### Certified run

The motion had a contract before launch and propagated Trellis IDs downstream. Trellis can produce certified analytics.

### Diagnostic run

Historical or messy data did not follow a contract. Trellis can still analyze what exists, but findings carry attribution and coverage caveats.

## Analytics boundary

Trellis owns motion-native analytics:

- did the motion work?
- which variant/segment/persona performed?
- what evidence supports the conclusion?
- what was unlearnable?
- what should we test next?

Trellis should not become a generic BI platform, CRM reporting replacement, or arbitrary chat-over-GTM-data tool.
