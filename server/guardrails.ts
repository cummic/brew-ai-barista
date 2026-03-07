const INJECTION_PATTERNS = [
  /ignore\s+(previous|all|your|prior)\s+(instructions?|prompts?|rules?|constraints?)/i,
  /forget\s+(everything|all|your|what|previous)/i,
  /you\s+are\s+now\s+(a|an|the)/i,
  /act\s+as\s+(a|an|the)\s+(?!barista|customer|person)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /jailbreak/i,
  /\bdan\b.*mode/i,
  /override\s+(your|the)\s+(instructions?|programming|rules?)/i,
  /disregard\s+(your|the|all|previous)/i,
  /new\s+instructions?\s*:/i,
  /system\s*prompt/i,
  /\[INST\]/i,
  /<\|im_start\|>/i,
  /\bHuman:\s/i,
  /\bAssistant:\s/i,
  /reveal\s+(your|the)\s+(system|hidden|secret)\s+(prompt|instructions?)/i,
  /what\s+(are|were)\s+your\s+(instructions?|prompts?)/i,
];

const SAFE_LENGTH_LIMIT = 1000;

export interface GuardrailResult {
  passed: boolean;
  reason?: string;
  sanitized?: string;
}

export function checkPromptInjection(message: string): GuardrailResult {
  if (message.length > SAFE_LENGTH_LIMIT) {
    return {
      passed: false,
      reason: "Message too long",
    };
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(message)) {
      return {
        passed: false,
        reason: "Potential prompt injection detected",
      };
    }
  }

  const sanitized = message
    .replace(/[<>]/g, "")
    .trim();

  return {
    passed: true,
    sanitized,
  };
}
