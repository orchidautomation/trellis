# Motion Contract Example

This example shows the Trellis 2.0 loop using files only:

```bash
npm run trellis -- motion validate examples/motion-contracts/ai-visibility-risk.yaml
npm run trellis -- motion compile examples/motion-contracts/ai-visibility-risk.yaml --output /tmp/trellis-ai-visibility
npm run trellis -- motion preflight examples/motion-contracts/ai-visibility-risk.yaml --leads examples/motion-contracts/leads.csv --run ai_visibility_risk_q3_demo
npm run trellis -- motion evidence examples/motion-contracts/ai-visibility-risk.yaml --enrollments examples/motion-contracts/leads.csv --events examples/motion-contracts/events.csv --outcomes examples/motion-contracts/outcomes.csv --run ai_visibility_risk_q3_demo
```

In production, Clay would call the generated HTTP API payload row-by-row, the sequencer would receive certified rows with Trellis IDs, and Trellis would ingest sequencer + CRM events to compile the evidence pack.
