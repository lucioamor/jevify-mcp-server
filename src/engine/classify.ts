import type { JevifyClassification, JevifyPrimitive } from "./contract";

/**
 * Evidence-based call-site classification.
 *
 * Rules enforced here:
 * - No AI invocation evidence => never a jev candidate.
 * - Word-boundary matching only (an "announcement" is not a "no").
 * - A model name never determines the task type.
 * - Composite tasks stay GENERATION_REQUIRED with the decision subtask listed.
 * - Missing evidence yields UNKNOWN, not HUMAN_REVIEW.
 * - Risk and human review are recorded independently of the task type.
 */

export type ClassifyInput = {
  snippet: string;
  file?: string | undefined;
  line?: number | undefined;
  modelHint?: string | undefined;
  notes?: string | undefined;
};

type Rule = { label: string; pattern: RegExp };

const AI_INVOCATION_RULES: Rule[] = [
  { label: "AI SDK call", pattern: /\b(generateText|streamText|generateObject|streamObject|embedMany|embed)\s*\(/ },
  { label: "provider SDK call", pattern: /\b(chat\.completions\.create|responses\.create|messages\.create|models\.generateContent|invokeModel)\b/ },
  { label: "gateway endpoint", pattern: /\/v1\/(responses|chat\/completions|messages|systemone|embeddings)\b/ },
  { label: "gateway host", pattern: /\bai\.gateway\.lovable\.dev\b/ },
  { label: "gateway credential header", pattern: /\bLovable-API-Key\b/ },
  { label: "prompt argument", pattern: /\b(prompt|system|messages|instructions)\s*:/ },
];

const DECLARATION_ONLY_RULES: Rule[] = [
  { label: "model identifier only", pattern: /^\s*(const|let|var|export)?\s*\w*\s*[:=]\s*["'`][a-z0-9.-]+\/[a-z0-9._-]+["'`]\s*,?\s*$/i },
  { label: "import statement", pattern: /^\s*(import|export)\s.+from\s+["'`]/ },
];

const CHOICE_RULES: Rule[] = [
  { label: "classification verb", pattern: /\b(classif\w*|categori[sz]\w*|label|route|triage)\b/i },
  { label: "closed option list", pattern: /\b(one of|choose (?:one|between)|either)\b/i },
  { label: "enumerated literals", pattern: /["'][\w -]+["']\s*(\||,)\s*["'][\w -]+["']/ },
  { label: "enum schema", pattern: /\b(z\.enum|enum)\s*\(/ },
  { label: "named category set", pattern: /\b(category|categories|intent|priority|bucket)\b/i },
];

const SCORE_RULES: Rule[] = [
  { label: "score vocabulary", pattern: /\b(score|rating|rank|ranking|severity|urgency|confidence level)\b/i },
  { label: "numeric scale", pattern: /\b(from\s*)?0\s*(?:-|to|–)\s*(?:1|5|10|100)\b/i },
  { label: "ordered scale", pattern: /\b(scale of|out of (?:5|10|100))\b/i },
];

const NOUL_RULES: Rule[] = [
  { label: "boolean output contract", pattern: /\b(boolean|z\.boolean)\b/i },
  { label: "binary answer instruction", pattern: /\banswer\s+(?:only\s+)?(?:with\s+)?(?:"?yes"?\s*(?:\/|or)\s*"?no"?|true\s*(?:\/|or)\s*false)\b/i },
  { label: "binary condition vocabulary", pattern: /\b(is[A-Z]\w+|valid|invalid|allowed|blocked|compliant|eligible|spam|toxic)\b/ },
  { label: "explicit true/false literals", pattern: /\b(true)\b\s*(\||\/|or)\s*\b(false)\b/i },
];

const GENERATION_RULES: Rule[] = [
  { label: "writing instruction", pattern: /\b(write|draft|compose|rewrite|translate|summari[sz]e|summary|paraphrase|explain)\b/i },
  { label: "prose artifact", pattern: /\b(announcement|article|post|email|reply|message|description|caption|copy|story)\b/i },
];

const EMBEDDING_RULES: Rule[] = [
  { label: "embedding call", pattern: /\b(embedding|embeddings|embed|embedMany|embedText)\b/i },
  { label: "vector search", pattern: /\b(vector|cosine|similarity|nearest neighbou?r|retrieval|rag)\b/i },
];

const DETERMINISTIC_RULES: Rule[] = [
  { label: "schema validation", pattern: /\b(\w*schema\w*\.(parse|safeParse|validate)|z\.object|joi\.|yup\.)/i },
  { label: "explicit branching", pattern: /\b(if|switch)\s*\(|\bcase\s+\w+:/ },
  { label: "regular expression rule", pattern: /\b(RegExp|\.test\(|\.match\()/ },
];

const HIGH_RISK_RULES: Rule[] = [
  { label: "money or billing path", pattern: /\b(payment|charge|refund|invoice|price|billing|payout)\b/i },
  { label: "destructive operation", pattern: /\b(delete|drop|revoke|terminate|ban|suspend)\b/i },
  { label: "safety or compliance decision", pattern: /\b(moderation|fraud|medical|diagnosis|legal|credit|loan|security)\b/i },
  { label: "access control decision", pattern: /\b(authorize|permission|role|admin access)\b/i },
];

function matches(rules: Rule[], text: string): string[] {
  return rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label);
}

function primitiveEvidence(text: string) {
  const choice = matches(CHOICE_RULES, text);
  const score = matches(SCORE_RULES, text);
  const noul = matches(NOUL_RULES, text);
  const ranked: Array<{ primitive: Exclude<JevifyPrimitive, null>; evidence: string[] }> = (
    [
      { primitive: "Choice", evidence: choice },
      { primitive: "Score", evidence: score },
      { primitive: "Noul", evidence: noul },
    ] satisfies Array<{ primitive: Exclude<JevifyPrimitive, null>; evidence: string[] }>
  ).sort((a, b) => b.evidence.length - a.evidence.length);
  const best = ranked[0];
  if (!best || best.evidence.length === 0) return null;
  return best;
}

const PRIMITIVE_NEXT_STEP: Record<Exclude<JevifyPrimitive, null>, string> = {
  Choice: "Replace the free-form generation with a Choice decision over an explicit, closed option set.",
  Score: "Model an explicit Score scale, then calibrate and validate the decision thresholds in code.",
  Noul: "Use a Noul decision that returns a probability for the condition, then apply a validated threshold in code.",
};

const PRIMITIVE_VALIDATION: Record<Exclude<JevifyPrimitive, null>, string> = {
  Choice: "Build a labelled fixture set for the option space and compare decisions against the current output before switching.",
  Score: "Collect labelled examples across the scale, then measure ranking agreement and threshold error before switching.",
  Noul: "Collect positive and negative examples, then select and record a decision threshold with its error costs.",
};

export function classifyAiCallsite(input: ClassifyInput): JevifyClassification {
  const snippet = input.snippet ?? "";
  // The model hint is recorded, never used to infer the task type.
  const text = [snippet, input.notes ?? ""].join("\n");
  const evidence: string[] = [];
  const missingContext: string[] = [];

  const declarationOnly = matches(DECLARATION_ONLY_RULES, snippet.trim());
  const aiEvidence = matches(AI_INVOCATION_RULES, text);
  const deterministic = matches(DETERMINISTIC_RULES, text);
  // A prose noun alone ("message") is not evidence of generation: a writing verb must be present.
  const generationSignals = matches(GENERATION_RULES, text);
  const generation = generationSignals.includes("writing instruction") ? generationSignals : [];
  const embedding = matches(EMBEDDING_RULES, text);
  const decision = primitiveEvidence(text);

  const risk = matches(HIGH_RISK_RULES, text);
  const riskLevel = risk.length ? ("high" as const) : aiEvidence.length ? ("medium" as const) : ("unknown" as const);
  const humanReviewRequired = risk.length > 0;

  const base = {
    risk: riskLevel,
    humanReviewRequired,
    composite: false,
    subtasks: [],
  };

  if (declarationOnly.length && !aiEvidence.length) {
    return {
      ...base,
      classification: "UNKNOWN",
      primitive: null,
      confidence: "low",
      confidenceRationale: "The line only declares a value; no runtime invocation is visible.",
      evidence: declarationOnly,
      missingContext: ["The call that consumes this value", "The expected output shape"],
      reason: "This line is a declaration or import, not a runtime AI invocation.",
      nextStep: "Inspect the call that consumes this declaration before classifying the task.",
      validationPlan: "Re-run the audit against the file region where the value is used.",
    };
  }

  if (!aiEvidence.length) {
    if (deterministic.length) {
      return {
        ...base,
        classification: "DETERMINISTIC_CODE",
        primitive: null,
        confidence: "medium",
        confidenceRationale: `Deterministic rule evidence without any AI invocation evidence: ${deterministic.join(", ")}.`,
        evidence: deterministic,
        missingContext: ["Whether an AI call exists elsewhere in this flow"],
        reason: "This snippet alone is deterministic logic, not evidence of an AI call.",
        nextStep: "Keep this logic in code; audit the surrounding flow to find actual AI invocations.",
        validationPlan: "No migration applies to this snippet. Confirm the wider flow has no AI call.",
      };
    }
    return {
      ...base,
      classification: "UNKNOWN",
      primitive: null,
      confidence: "low",
      confidenceRationale: "No AI invocation evidence was found in the supplied snippet.",
      evidence: [],
      missingContext: [
        "A visible AI invocation (SDK call, provider endpoint or prompt payload)",
        "The expected output shape of the operation",
      ],
      reason: "The snippet does not show a runtime AI call, so the task type cannot be established.",
      nextStep: "Supply the call-site with its prompt and response handling, then re-classify.",
      validationPlan: "Re-audit with the full function body or request payload.",
    };
  }

  evidence.push(...aiEvidence);

  if (decision && generation.length) {
    return {
      ...base,
      classification: "GENERATION_REQUIRED",
      primitive: null,
      confidence: "medium",
      confidenceRationale: `Both a bounded decision (${decision.evidence.join(", ")}) and open language production (${generation.join(", ")}) appear in one operation.`,
      evidence: [...evidence, ...decision.evidence, ...generation],
      missingContext: ["Whether the decision and the text output can be produced by separate calls"],
      composite: true,
      subtasks: [
        { kind: "decision" as const, primitive: decision.primitive, description: `Bounded ${decision.primitive} subtask inside a generation call.` },
        { kind: "generation" as const, primitive: null, description: "Open language output that must stay generative." },
      ],
      reason: "This is a composite task: one subtask is a bounded decision, the other produces open language.",
      nextStep: `Split the operation: extract the ${decision.primitive} subtask into a typed decision and keep generation for the text output.`,
      validationPlan: PRIMITIVE_VALIDATION[decision.primitive],
    };
  }

  if (decision) {
    const strong = decision.evidence.length >= 2;
    return {
      ...base,
      classification: "JEV_CANDIDATE",
      primitive: decision.primitive,
      confidence: strong ? "high" : "medium",
      confidenceRationale: strong
        ? `Multiple independent output-shape signals for ${decision.primitive}: ${decision.evidence.join(", ")}.`
        : `A single output-shape signal for ${decision.primitive}: ${decision.evidence.join(", ")}. One signal does not establish high confidence.`,
      evidence: [...evidence, ...decision.evidence],
      missingContext: strong ? [] : ["The complete option set, scale or threshold used by the caller"],
      reason: `The AI call appears to produce a bounded ${decision.primitive} decision rather than open language.`,
      nextStep: PRIMITIVE_NEXT_STEP[decision.primitive],
      validationPlan: PRIMITIVE_VALIDATION[decision.primitive],
    };
  }

  if (embedding.length) {
    return {
      ...base,
      classification: "EMBEDDING_SEARCH",
      primitive: null,
      confidence: "medium",
      confidenceRationale: `Retrieval evidence: ${embedding.join(", ")}.`,
      evidence: [...evidence, ...embedding],
      missingContext: ["The decision taken after retrieval, if any"],
      reason: "The call is retrieval or similarity search rather than generation or a bounded decision.",
      nextStep: "Keep vector search for retrieval; audit any decision taken on the retrieved results.",
      validationPlan: "Measure retrieval quality separately from any downstream decision.",
    };
  }

  if (generation.length) {
    return {
      ...base,
      classification: "GENERATION_REQUIRED",
      primitive: null,
      confidence: generation.length >= 2 ? "high" : "medium",
      confidenceRationale: `Open language production evidence: ${generation.join(", ")}. No bounded output-shape evidence found.`,
      evidence: [...evidence, ...generation],
      missingContext: [],
      reason: "The output is open language, so generation is the correct primitive.",
      nextStep: "Keep generation. Extract any structured decision out of the prompt if one is added later.",
      validationPlan: "Review prompt scope periodically for decision subtasks that could be extracted.",
    };
  }

  if (deterministic.length) {
    return {
      ...base,
      classification: "DETERMINISTIC_CODE",
      primitive: null,
      confidence: "medium",
      confidenceRationale: `An AI call sits next to explicit rule logic: ${deterministic.join(", ")}.`,
      evidence: [...evidence, ...deterministic],
      missingContext: ["Which part of the behaviour depends on the model output"],
      reason: "Stable rules appear around the AI call and can likely stay in code.",
      nextStep: "Keep the explicit rules in code and narrow the model call to genuinely ambiguous language.",
      validationPlan: "Compare rule-only output with the current behaviour on recorded inputs.",
    };
  }

  missingContext.push("The expected output shape (free text, option, scale or condition)");
  missingContext.push("The prompt instruction or response handling");
  return {
    ...base,
    classification: "UNKNOWN",
    primitive: null,
    confidence: "low",
    confidenceRationale: "An AI invocation is visible, but no evidence establishes the task type.",
    evidence,
    missingContext,
    reason: "An AI call is present, but the snippet does not show what kind of output it produces.",
    nextStep: "Supply the prompt text and the consumer of the response, then re-classify.",
    validationPlan: "Re-audit with the full call-site, including prompt and response usage.",
  };
}
