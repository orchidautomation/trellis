import { describe, expect, it } from "vitest";

import {
  compileMotionEvidencePack,
  compileMotionImplementationPack,
  parseMotionContract,
  preflightMotionRun,
  validateCandidateRow,
} from "./motion-contracts.js";

const contract = parseMotionContract({
  motion_id: "ai_visibility_risk_q3",
  owner: "gtm_engineering",
  hypothesis: {
    statement: "CMOs with AI visibility gaps will respond to competitor-risk messaging.",
    persona: ["CMO", "VP Marketing"],
    segment: "Series B-D B2B SaaS",
  },
  systems: {
    research: "clay",
    execution: "smartlead",
    crm: "hubspot",
  },
  required_fields: {
    account: ["company_domain", "ai_visibility_score", "competitor_visibility_gap"],
    person: ["email", "persona"],
    motion: ["pain_hypothesis", "offer_angle", "message_variant", "source_list"],
  },
  variants: [
    { id: "competitor_risk" },
    { id: "traffic_decline" },
  ],
  success_metrics: {
    primary: ["qualified_meeting_booked"],
    secondary: ["positive_reply", "opportunity_created"],
  },
  guardrails: {
    min_rows_per_variant: 1,
    min_field_coverage: 0.8,
    require_crm_outcome_mapping: true,
  },
});

describe("motion contracts", () => {
  it("certifies a complete candidate row and returns stable Trellis IDs", () => {
    const result = validateCandidateRow(contract, {
      company_domain: "example.com",
      email: "maya@example.com",
      persona: "CMO",
      ai_visibility_score: 42,
      competitor_visibility_gap: 18,
      pain_hypothesis: "Competitors are being cited in answer engines.",
      offer_angle: "visibility gap",
      message_variant: "competitor_risk",
      source_list: "clay_ai_visibility_gap",
    }, { runId: "run_001" });

    expect(result).toMatchObject({
      certified: true,
      motion_id: "ai_visibility_risk_q3",
      motion_run_id: "run_001",
      variant_id: "competitor_risk",
      missing_fields: [],
      warnings: [],
      errors: [],
    });
    expect(result.subject_id).toMatch(/^subj_/);
    expect(result.enrollment_id).toMatch(/^enr_/);
  });

  it("blocks preflight when variants are underpowered or fields are missing", () => {
    const result = preflightMotionRun(contract, [
      {
        company_domain: "example.com",
        email: "maya@example.com",
        persona: "CMO",
        ai_visibility_score: 42,
        competitor_visibility_gap: 18,
        pain_hypothesis: "Competitors are being cited in answer engines.",
        offer_angle: "visibility gap",
        message_variant: "competitor_risk",
        source_list: "clay_ai_visibility_gap",
      },
      {
        company_domain: "acme.com",
        email: "ari@acme.com",
        persona: "VP Marketing",
        ai_visibility_score: "",
        competitor_visibility_gap: 12,
        pain_hypothesis: "Traffic is shifting to AI answers.",
        offer_angle: "traffic shift",
        message_variant: "traffic_decline",
        source_list: "clay_ai_visibility_gap",
      },
    ], { runId: "run_001" });

    expect(result.status).toBe("blocked");
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("account.ai_visibility_score"),
    ]));
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("row(s) are missing required field values"),
    ]));
  });

  it("compiles implementation artifacts for Clay, sequencers, CRM, and agents", () => {
    const pack = compileMotionImplementationPack(contract, {
      baseUrl: "https://api.trellis.example",
      runId: "run_001",
    });

    expect(pack.clay.http_api_endpoint).toBe("https://api.trellis.example/v1/motions/ai_visibility_risk_q3/validate-row");
    expect(pack.clay.required_columns).toEqual(expect.arrayContaining([
      "company_domain",
      "motion_run_id",
      "enrollment_id",
      "variant_id",
    ]));
    expect(pack.sequencer.required_propagated_fields).toEqual(["motion_run_id", "enrollment_id", "variant_id"]);
    expect(pack.crm.recommended_fields).toEqual(expect.arrayContaining([
      "trellis_qualified_meeting_booked",
      "trellis_positive_reply",
    ]));
  });

  it("compiles evidence by joining enrollments, sequencer events, and CRM outcomes", () => {
    const enrollments = [
      {
        company_domain: "example.com",
        email: "maya@example.com",
        persona: "CMO",
        ai_visibility_score: 42,
        competitor_visibility_gap: 18,
        pain_hypothesis: "Competitors are being cited in answer engines.",
        offer_angle: "visibility gap",
        message_variant: "competitor_risk",
        source_list: "clay_ai_visibility_gap",
      },
      {
        company_domain: "acme.com",
        email: "ari@acme.com",
        persona: "VP Marketing",
        ai_visibility_score: 33,
        competitor_visibility_gap: 12,
        pain_hypothesis: "Traffic is shifting to AI answers.",
        offer_angle: "traffic shift",
        message_variant: "traffic_decline",
        source_list: "clay_ai_visibility_gap",
      },
    ];
    const first = validateCandidateRow(contract, enrollments[0]!, { runId: "run_001" });

    const pack = compileMotionEvidencePack({
      contract,
      enrollments,
      runId: "run_001",
      events: [
        {
          event_type: "positive_reply",
          enrollment_id: first.enrollment_id,
          source_system: "smartlead",
        },
      ],
      outcomes: [
        {
          event_type: "qualified_meeting_booked",
          enrollment_id: first.enrollment_id,
          source_system: "hubspot",
        },
      ],
    });

    expect(pack.variant_rollups.competitor_risk).toMatchObject({
      enrolled: 1,
      positive_replies: 1,
      qualified_meetings: 1,
    });
    expect(pack.findings[0]).toContain("competitor_risk");
  });
});
