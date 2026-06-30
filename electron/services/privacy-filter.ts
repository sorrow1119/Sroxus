import { getSetting } from "../database/settings";
import type { ChatMessage } from "./ai-client";

export type PrivacyFilterMode = "balanced" | "strict";

export type PrivacyFilterReport = {
  enabled: boolean;
  mode: PrivacyFilterMode;
  changed: boolean;
  totalHits: number;
  hitsByType: Record<string, number>;
};

type RedactionRule = {
  type: string;
  pattern: RegExp;
  strictOnly?: boolean;
  replace?: (match: string, placeholder: string, ...groups: string[]) => string;
};

const RULES: RedactionRule[] = [
  {
    type: "PRIVATE_KEY",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    type: "OPENAI_API_KEY",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    type: "GITHUB_TOKEN",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    type: "AWS_ACCESS_KEY",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    type: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    type: "BEARER_TOKEN",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
    replace: (_match, placeholder) => `Bearer ${placeholder}`,
  },
  {
    type: "SECRET_VALUE",
    pattern:
      /\b(api[_-]?key|apikey|secret|token|access[_-]?token|refresh[_-]?token|password|passwd|pwd|client[_-]?secret|secret[_-]?key)\b(\s*[:=]\s*["']?)([^"',\s;]{6,})/gi,
    replace: (_match, placeholder, key: string, separator: string) => `${key}${separator}${placeholder}`,
  },
  {
    type: "DATABASE_URL",
    pattern: /\b(?:mysql|postgres|postgresql|mongodb|redis):\/\/[^:\s/@]+:[^@\s]+@[^)\s]+/gi,
    replace: (match, placeholder) => match.replace(/:\/\/([^:\s/@]+):([^@\s]+)@/, `://$1:${placeholder}@`),
  },
  {
    type: "EMAIL",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    type: "CN_PHONE",
    pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
  },
  {
    type: "CN_ID_CARD",
    pattern: /\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
  },
  {
    type: "BANK_CARD",
    pattern: /(?<!\d)(?:\d[ -]?){15,19}(?!\d)/g,
  },
  {
    type: "PERSON_NAME",
    pattern: /\b(name|real_name|contact_name)(\s*[:=]\s*)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/gi,
    strictOnly: true,
    replace: (_match, placeholder, key: string, separator: string) => `${key}${separator}${placeholder}`,
  },
];

export function sanitizeMessagesForAI(messages: ChatMessage[]): { messages: ChatMessage[]; report: PrivacyFilterReport } {
  const settings = getPrivacyFilterSettings();
  if (!settings.enabled) {
    return {
      messages,
      report: { enabled: false, mode: settings.mode, changed: false, totalHits: 0, hitsByType: {} },
    };
  }

  const counters = new Map<string, number>();
  const sanitized = messages.map((message) => {
    const result = redactSensitiveText(message.content, settings.mode, counters);
    return result.changed ? { ...message, content: result.text } : message;
  });

  const hitsByType = Object.fromEntries(counters.entries());
  const totalHits = Object.values(hitsByType).reduce((sum, value) => sum + value, 0);
  const report: PrivacyFilterReport = {
    enabled: true,
    mode: settings.mode,
    changed: totalHits > 0,
    totalHits,
    hitsByType,
  };

  if (!report.changed || getSetting("privacyFilterNoticeEnabled") === "false") {
    return { messages: sanitized, report };
  }

  return {
    messages: [
      {
        role: "system",
        content: `Privacy filter is enabled. Sensitive values were replaced locally before this request was sent. Placeholder summary: ${formatHitSummary(
          hitsByType,
        )}. Do not try to recover or guess the original sensitive values.`,
      },
      ...sanitized,
    ],
    report,
  };
}

export function redactSensitiveText(text: string, mode: PrivacyFilterMode = "balanced", counters = new Map<string, number>()) {
  let output = text;
  let changed = false;

  for (const rule of RULES) {
    if (rule.strictOnly && mode !== "strict") {
      continue;
    }
    output = output.replace(rule.pattern, (match: string, ...args: string[]) => {
      if (rule.type === "BANK_CARD" && !looksLikeBankCard(match)) {
        return match;
      }
      const placeholder = nextPlaceholder(rule.type, counters);
      changed = true;
      return rule.replace ? rule.replace(match, placeholder, ...args) : placeholder;
    });
  }

  return { text: output, changed };
}

export function sanitizeForLog(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }
  return redactSensitiveText(value, "strict").text;
}

export function getPrivacyFilterSettings(): { enabled: boolean; mode: PrivacyFilterMode } {
  const enabled = getSetting("privacyFilterEnabled") !== "false";
  const rawMode = getSetting("privacyFilterMode");
  const mode: PrivacyFilterMode = rawMode === "strict" ? "strict" : "balanced";
  return { enabled, mode };
}

function nextPlaceholder(type: string, counters: Map<string, number>) {
  const next = (counters.get(type) ?? 0) + 1;
  counters.set(type, next);
  return `[${type}_${next}]`;
}

function formatHitSummary(hitsByType: Record<string, number>) {
  return Object.entries(hitsByType)
    .map(([type, count]) => `${type} ${count}`)
    .join(", ");
}

function looksLikeBankCard(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 15 || digits.length > 19) {
    return false;
  }
  if (/^(\d)\1+$/.test(digits)) {
    return false;
  }
  return luhnCheck(digits);
}

function luhnCheck(digits: string) {
  let sum = 0;
  let shouldDouble = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}
