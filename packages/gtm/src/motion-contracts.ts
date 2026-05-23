import { createHash } from "node:crypto";
import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export const motionVariantSchema = z.union([
  nonEmptyString,
  z.object({
    id: nonEmptyString,
    label: z.string().optional(),
    description: z.string().optional(),
  }).passthrough(),
]);

export const motionContractSchema = z.object({
  motion_id: nonEmptyString,
  owner: z.string().optional(),
  hypothesis: z.object({
    statement: nonEmptyString,
    segment: z.union([z.string(), z.array(z.string())]).optional(),
    persona: z.union([z.string(), z.array(z.string())]).optional(),
    trigger: z.union([z.string(), z.array(z.string())]).optional(),
  }).passthrough(),
  systems: z.record(z.string()).optional().default({}),
  required_fields: z.record(z.array(nonEmptyString)).optional().default({}),
  variants: z.array(motionVariantSchema).min(1),
  success_metrics: z.union([
    z.array(nonEmptyString),
    z.object({
      primary: z.array(nonEmptyString).optional().default([]),
      secondary: z.array(nonEmptyString).optional().default([]),
    }).passthrough(),
  ]),
  guardrails: z.object({
    min_rows_per_variant: z.number().int().positive().optional(),
    min_field_coverage: z.number().min(0).max(1).optional(),
    max_bounce_rate: z.number().min(0).max(1).optional(),
    require_crm_outcome_mapping: z.boolean().optional(),
  }).passthrough().optional().default({}),
  agent_permissions: z.object({
    can_read: z.array(nonEmptyString).optional().default([]),
    can_propose: z.array(nonEmptyString).optional().default([]),
    requires_approval: z.array(nonEmptyString).optional().default([]),
  }).passthrough().optional().default({}),
}).passthrough();

export type MotionContract = z.infer<typeof motionContractSchema>;

export type RequiredFieldRef = {
  section: string;
  name: string;
  aliases: string[];
};

export type CandidateRow = Record<string, unknown>;

export type CandidateValidationResult = {
  certified: boolean;
  learnability_score: number;
  motion_id: string;
  motion_run_id: string;
  subject_id: string;
  enrollment_id: string;
  variant_id: string | null;
  missing_fields: string[];
  warnings: string[];
  errors: string[];
};

export type MotionPreflightResult = {
  status: "certified" | "blocked";
  motion_id: string;
  motion_run_id: string;
  candidate_count: number;
  certified_count: number;
  learnability_score: number;
  blockers: string[];
  warnings: string[];
  variant_counts: Record<string, number>;
  field_coverage: Record<string, {
    present: number;
    total: number;
    coverage: number;
  }>;
  rows: CandidateValidationResult[];
};

export type MotionEvent = {
  event_type: string;
  enrollment_id?: string | null;
  motion_run_id?: string | null;
  variant_id?: string | null;
  occurred_at?: string | null;
  source_system?: string | null;
  raw_label?: string | null;
  normalized_label?: string | null;
  payload?: Record<string, unknown>;
};

export type MotionEvidencePack = {
  motion_id: string;
  motion_run_id: string;
  candidate_count: number;
  event_count: number;
  outcome_count: number;
  variant_rollups: Record<string, {
    enrolled: number;
    sent: number;
    bounced: number;
    replies: number;
    positive_replies: number;
    qualified_meetings: number;
    opportunities: number;
  }>;
  caveats: string[];
  findings: string[];
};

export type MotionImplementationPack = {
  motion_id: string;
  motion_run_id: string;
  required_columns: string[];
  trellis_ids: string[];
  clay: {
    required_columns: string[];
    http_api_endpoint: string;
    http_api_payload: Record<string, string>;
  };
  sequencer: {
    custom_fields: string[];
    required_propagated_fields: string[];
  };
  crm: {
    recommended_fields: string[];
    required_outcome_metrics: string[];
  };
  agent_permissions: MotionContract["agent_permissions"];
};

const TRELLIS_ID_FIELDS = [
  "motion_id",
  "motion_run_id",
  "subject_id",
  "enrollment_id",
  "variant_id",
];

export function parseMotionContract(input: unknown): MotionContract {
  return motionContractSchema.parse(input);
}

export function getMotionRunId(contract: MotionContract, options?: { runId?: string; now?: Date }) {
  if (options?.runId) {
    return options.runId;
  }
  const date = (options?.now ?? new Date()).toISOString().slice(0, 10).replace(/-/g, "_");
  return `${slugify(contract.motion_id)}_${date}_v1`;
}

export function flattenRequiredFields(contract: MotionContract): RequiredFieldRef[] {
  return Object.entries(contract.required_fields ?? {}).flatMap(([section, fields]) =>
    fields.map((name) => ({
      section,
      name,
      aliases: buildFieldAliases(section, name),
    })),
  );
}

export function variantIds(contract: MotionContract): string[] {
  return contract.variants.map((variant) => typeof variant === "string" ? variant : variant.id);
}

export function validateCandidateRow(
  contractInput: MotionContract | unknown,
  row: CandidateRow,
  options?: {
    runId?: string;
  },
): CandidateValidationResult {
  const contract = parseMotionContract(contractInput);
  const motionRunId = getMotionRunId(contract, { runId: options?.runId });
  const fields = flattenRequiredFields(contract);
  const missingFields = fields
    .filter((field) => isBlank(readCandidateField(row, field)))
    .map((field) => `${field.section}.${field.name}`);

  const allowedVariants = variantIds(contract);
  const variantId = resolveVariantId(row, allowedVariants);
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!variantId) {
    errors.push(`Missing variant_id/message_variant; allowed variants: ${allowedVariants.join(", ")}`);
  } else if (!allowedVariants.includes(variantId)) {
    errors.push(`Unknown variant "${variantId}"; allowed variants: ${allowedVariants.join(", ")}`);
  }

  if (missingFields.length > 0) {
    warnings.push(`Missing ${missingFields.length} required field(s): ${missingFields.join(", ")}`);
  }

  const email = stringValue(row.email ?? row.person_email ?? row["person.email"]);
  const companyDomain = stringValue(row.company_domain ?? row["account.company_domain"]);
  const subjectSeed = email || companyDomain || stableJson(row);
  const enrollmentSeed = [
    contract.motion_id,
    motionRunId,
    subjectSeed,
    variantId ?? "unknown_variant",
  ].join(":");
  const subjectId = stringValue(row.subject_id) || `subj_${shortHash(subjectSeed)}`;
  const enrollmentId = stringValue(row.enrollment_id) || `enr_${shortHash(enrollmentSeed)}`;
  const baseScore = 100;
  const missingPenalty = fields.length > 0 ? Math.round((missingFields.length / fields.length) * 70) : 0;
  const errorPenalty = errors.length * 25;
  const learnabilityScore = Math.max(0, Math.min(100, baseScore - missingPenalty - errorPenalty));

  return {
    certified: missingFields.length === 0 && errors.length === 0,
    learnability_score: learnabilityScore,
    motion_id: contract.motion_id,
    motion_run_id: motionRunId,
    subject_id: subjectId,
    enrollment_id: enrollmentId,
    variant_id: variantId,
    missing_fields: missingFields,
    warnings,
    errors,
  };
}

export function preflightMotionRun(
  contractInput: MotionContract | unknown,
  rows: CandidateRow[],
  options?: {
    runId?: string;
  },
): MotionPreflightResult {
  const contract = parseMotionContract(contractInput);
  const motionRunId = getMotionRunId(contract, { runId: options?.runId });
  const validations = rows.map((row) => validateCandidateRow(contract, row, { runId: motionRunId }));
  const blockers: string[] = [];
  const warnings: string[] = [];
  const allowedVariants = variantIds(contract);
  const variantCounts = Object.fromEntries(allowedVariants.map((id) => [id, 0]));

  for (const validation of validations) {
    if (validation.variant_id && validation.certified) {
      variantCounts[validation.variant_id] = (variantCounts[validation.variant_id] ?? 0) + 1;
    }
  }

  const fields = flattenRequiredFields(contract);
  const fieldCoverage: MotionPreflightResult["field_coverage"] = {};
  for (const field of fields) {
    const key = `${field.section}.${field.name}`;
    const present = rows.filter((row) => !isBlank(readCandidateField(row, field))).length;
    fieldCoverage[key] = {
      present,
      total: rows.length,
      coverage: rows.length === 0 ? 0 : Number((present / rows.length).toFixed(4)),
    };
  }

  if (rows.length === 0) {
    blockers.push("No candidate rows supplied.");
  }

  const invalidRows = validations.filter((validation) => validation.errors.length > 0);
  if (invalidRows.length > 0) {
    blockers.push(`${invalidRows.length} row(s) have invalid or missing variants.`);
  }

  const incompleteRows = validations.filter((validation) => validation.missing_fields.length > 0);
  if (incompleteRows.length > 0) {
    warnings.push(`${incompleteRows.length} row(s) are missing required field values.`);
  }

  const minRows = contract.guardrails?.min_rows_per_variant;
  if (minRows) {
    for (const variantId of allowedVariants) {
      const count = variantCounts[variantId] ?? 0;
      if (count < minRows) {
        blockers.push(`Variant "${variantId}" has ${count} certified row(s); minimum is ${minRows}.`);
      }
    }
  }

  const minCoverage = contract.guardrails?.min_field_coverage ?? 0.95;
  for (const [field, coverage] of Object.entries(fieldCoverage)) {
    if (coverage.coverage < minCoverage) {
      blockers.push(`Field "${field}" coverage is ${Math.round(coverage.coverage * 100)}%; minimum is ${Math.round(minCoverage * 100)}%.`);
    }
  }

  if (contract.guardrails?.require_crm_outcome_mapping) {
    const crmSystem = contract.systems?.crm;
    if (!crmSystem) {
      blockers.push("CRM outcome mapping is required, but systems.crm is not set.");
    }
  }

  const certifiedCount = validations.filter((validation) => validation.certified).length;
  const learnabilityScore = validations.length === 0
    ? 0
    : Math.round(validations.reduce((sum, validation) => sum + validation.learnability_score, 0) / validations.length);

  return {
    status: blockers.length === 0 ? "certified" : "blocked",
    motion_id: contract.motion_id,
    motion_run_id: motionRunId,
    candidate_count: rows.length,
    certified_count: certifiedCount,
    learnability_score: learnabilityScore,
    blockers,
    warnings,
    variant_counts: variantCounts,
    field_coverage: fieldCoverage,
    rows: validations,
  };
}

export function compileMotionImplementationPack(
  contractInput: MotionContract | unknown,
  options?: {
    baseUrl?: string;
    runId?: string;
  },
): MotionImplementationPack {
  const contract = parseMotionContract(contractInput);
  const motionRunId = getMotionRunId(contract, { runId: options?.runId });
  const requiredColumns = unique([
    ...flattenRequiredFields(contract).map((field) => field.name),
    "variant_id",
    ...TRELLIS_ID_FIELDS,
  ]);
  const baseUrl = (options?.baseUrl ?? "https://api.trellis.local").replace(/\/$/, "");
  return {
    motion_id: contract.motion_id,
    motion_run_id: motionRunId,
    required_columns: requiredColumns,
    trellis_ids: TRELLIS_ID_FIELDS,
    clay: {
      required_columns: requiredColumns,
      http_api_endpoint: `${baseUrl}/v1/motions/${encodeURIComponent(contract.motion_id)}/validate-row`,
      http_api_payload: Object.fromEntries(requiredColumns.map((column) => [column, `{{${column}}}`])),
    },
    sequencer: {
      custom_fields: unique([
        ...TRELLIS_ID_FIELDS,
        "persona",
        "offer_angle",
        "message_variant",
        "source_list",
        "pain_hypothesis",
        "trigger_event",
      ]),
      required_propagated_fields: ["motion_run_id", "enrollment_id", "variant_id"],
    },
    crm: {
      recommended_fields: unique([
        "trellis_motion_id",
        "trellis_motion_run_id",
        "trellis_subject_id",
        "trellis_enrollment_id",
        "trellis_variant_id",
        ...successMetrics(contract).map((metric) => `trellis_${metric}`),
      ]),
      required_outcome_metrics: successMetrics(contract),
    },
    agent_permissions: contract.agent_permissions,
  };
}

export function compileMotionEvidencePack(input: {
  contract: MotionContract | unknown;
  enrollments: CandidateRow[];
  events?: MotionEvent[];
  outcomes?: MotionEvent[];
  runId?: string;
}): MotionEvidencePack {
  const contract = parseMotionContract(input.contract);
  const motionRunId = getMotionRunId(contract, { runId: input.runId });
  const variants = variantIds(contract);
  const rollups: MotionEvidencePack["variant_rollups"] = Object.fromEntries(variants.map((variantId) => [variantId, {
    enrolled: 0,
    sent: 0,
    bounced: 0,
    replies: 0,
    positive_replies: 0,
    qualified_meetings: 0,
    opportunities: 0,
  }]));
  const enrollmentVariant = new Map<string, string>();

  for (const row of input.enrollments) {
    const validation = validateCandidateRow(contract, row, { runId: motionRunId });
    const variantId = validation.variant_id ?? stringValue(row.variant_id) ?? "unknown";
    if (!rollups[variantId]) {
      rollups[variantId] = emptyRollup();
    }
    rollups[variantId].enrolled += 1;
    enrollmentVariant.set(validation.enrollment_id, variantId);
    const rowEnrollmentId = stringValue(row.enrollment_id);
    if (rowEnrollmentId) {
      enrollmentVariant.set(rowEnrollmentId, variantId);
    }
  }

  const caveats: string[] = [];
  let unmatchedEvents = 0;
  for (const event of [...(input.events ?? []), ...(input.outcomes ?? [])]) {
    const variantId = event.variant_id ?? (event.enrollment_id ? enrollmentVariant.get(event.enrollment_id) : null);
    if (!variantId) {
      unmatchedEvents += 1;
      continue;
    }
    if (!rollups[variantId]) {
      rollups[variantId] = emptyRollup();
    }
    applyEventToRollup(rollups[variantId], event.event_type || event.normalized_label || event.raw_label || "");
  }

  if (unmatchedEvents > 0) {
    caveats.push(`${unmatchedEvents} event(s) could not be matched to an enrollment or variant.`);
  }

  const findings = buildFindings(rollups);
  if (findings.length === 0) {
    caveats.push("No strong finding generated yet; add more events or outcomes.");
  }

  return {
    motion_id: contract.motion_id,
    motion_run_id: motionRunId,
    candidate_count: input.enrollments.length,
    event_count: input.events?.length ?? 0,
    outcome_count: input.outcomes?.length ?? 0,
    variant_rollups: rollups,
    caveats,
    findings,
  };
}

function buildFieldAliases(section: string, name: string) {
  return unique([
    name,
    `${section}.${name}`,
    `${section}_${name}`,
    `${section}${capitalize(name)}`,
  ]);
}

function readCandidateField(row: CandidateRow, field: RequiredFieldRef) {
  for (const alias of field.aliases) {
    if (row[alias] !== undefined) {
      return row[alias];
    }
  }
  return undefined;
}

function resolveVariantId(row: CandidateRow, allowedVariants: string[]) {
  const explicit = stringValue(row.variant_id ?? row.message_variant ?? row["motion.message_variant"]);
  if (explicit) {
    return explicit;
  }
  const offerAngle = stringValue(row.offer_angle ?? row["motion.offer_angle"]);
  if (offerAngle && allowedVariants.includes(offerAngle)) {
    return offerAngle;
  }
  return null;
}

function successMetrics(contract: MotionContract) {
  return Array.isArray(contract.success_metrics)
    ? contract.success_metrics
    : unique([...(contract.success_metrics.primary ?? []), ...(contract.success_metrics.secondary ?? [])]);
}

function applyEventToRollup(rollup: MotionEvidencePack["variant_rollups"][string], rawEventType: string) {
  const eventType = rawEventType.toLowerCase().replace(/[\s-]+/g, "_");
  if (["sent", "email_sent", "send"].includes(eventType)) {
    rollup.sent += 1;
  } else if (["bounce", "bounced", "email_bounced"].includes(eventType)) {
    rollup.bounced += 1;
  } else if (["reply", "reply_received", "human_reply", "negative_reply", "neutral_reply", "positive_reply"].includes(eventType)) {
    rollup.replies += 1;
    if (eventType === "positive_reply") {
      rollup.positive_replies += 1;
    }
  } else if (["qualified_meeting", "qualified_meeting_booked", "meeting_booked"].includes(eventType)) {
    rollup.qualified_meetings += 1;
  } else if (["opportunity", "opportunity_created", "opp_created"].includes(eventType)) {
    rollup.opportunities += 1;
  }
}

function buildFindings(rollups: MotionEvidencePack["variant_rollups"]) {
  const rows = Object.entries(rollups)
    .filter(([, rollup]) => rollup.enrolled > 0)
    .map(([variantId, rollup]) => ({
      variantId,
      meetingRate: rollup.qualified_meetings / rollup.enrolled,
      positiveReplyRate: rollup.positive_replies / rollup.enrolled,
      opportunityRate: rollup.opportunities / rollup.enrolled,
    }))
    .sort((a, b) => b.meetingRate - a.meetingRate || b.positiveReplyRate - a.positiveReplyRate || b.opportunityRate - a.opportunityRate);

  const [winner, runnerUp] = rows;
  if (!winner || winner.meetingRate === 0 && winner.positiveReplyRate === 0 && winner.opportunityRate === 0) {
    return [];
  }

  const findings = [
    `${winner.variantId} is the current leading variant by qualified meeting rate (${formatPercent(winner.meetingRate)}).`,
  ];
  if (runnerUp) {
    findings.push(`${winner.variantId} positive reply rate is ${formatPercent(winner.positiveReplyRate)} vs ${formatPercent(runnerUp.positiveReplyRate)} for ${runnerUp.variantId}.`);
  }
  return findings;
}

function emptyRollup() {
  return {
    enrolled: 0,
    sent: 0,
    bounced: 0,
    replies: 0,
    positive_replies: 0,
    qualified_meetings: 0,
    opportunities: 0,
  };
}

function isBlank(value: unknown) {
  return value === null || value === undefined || String(value).trim().length === 0;
}

function stringValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function stableJson(value: unknown) {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "motion";
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function capitalize(value: string) {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

function formatPercent(value: number) {
  return `${Number((value * 100).toFixed(2))}%`;
}
