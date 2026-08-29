/**
 * Agent Variants — user-declared alternate configurations of a review CLI.
 *
 * One machine routinely has the same agent CLI logged into more than one
 * account. The CLIs express that as an environment override (Codex reads
 * `CODEX_HOME`), which people wrap in a shell alias or function. Plannotator
 * spawns jobs with `Bun.spawn`/`child_process.spawn` and NO shell, so a shell
 * function is invisible to it — an alias can never show up as a review engine.
 *
 * A variant closes that gap declaratively: it names an existing base engine,
 * an optional binary override, and the environment to spawn it with. The
 * server expands each one into its own `AgentCapability`, so it appears in the
 * review engine picker beside the base and runs through the base engine's
 * existing prompt/argv/parse path unchanged.
 *
 * Config (`~/.plannotator/config.json`):
 *
 *   {
 *     "agentVariants": [
 *       {
 *         "id": "codex-work",
 *         "base": "codex",
 *         "label": "Codex Work",
 *         "env": { "CODEX_HOME": "~/.codex-work" },
 *         "accent": "violet"
 *       }
 *     ]
 *   }
 *
 * Review-only by design: guide and tour keep the built-in engine set, so a
 * variant widens exactly one picker.
 *
 * Browser-safe and dependency-free (`@plannotator/core`): the UI reads the
 * resolved variants back off `/api/agents/capabilities`, and the node-side
 * loader that reads config.json and expands `~` lives in
 * packages/shared/agent-variants.ts.
 */

/** Base engines a variant may re-point. Exactly the review engine set. */
export const AGENT_VARIANT_BASES = [
  "claude",
  "codex",
  "cursor",
  "opencode",
  "pi",
  "copilot",
] as const;

export type AgentVariantBase = (typeof AGENT_VARIANT_BASES)[number];

/**
 * Accent used to tell a variant apart from its base in the picker. A closed
 * set, not a free-form color: the swatches are literal Tailwind class strings
 * in the UI, and Tailwind only generates classes it can see at build time.
 */
export const AGENT_VARIANT_ACCENTS = [
  "violet",
  "amber",
  "emerald",
  "sky",
  "rose",
  "slate",
] as const;

export type AgentVariantAccent = (typeof AGENT_VARIANT_ACCENTS)[number];

export interface AgentVariant {
  /** Provider id, unique across base engines and other variants. */
  id: string;
  /** The engine whose prompt, argv and output parsing this variant reuses. */
  base: AgentVariantBase;
  /** Display name in the picker. */
  label: string;
  /** Picker accent, assigned round-robin when the user names none. */
  accent: AgentVariantAccent;
  /** Environment overlaid on the job's inherited env at spawn. */
  env: Record<string, string>;
  /** Binary override. Absent ⇒ the base engine's own binary. */
  binary?: string;
}

/** Cap on declared variants — a picker, not a directory. */
export const MAX_AGENT_VARIANTS = 12;
/** Cap on env entries per variant. */
export const MAX_VARIANT_ENV_ENTRIES = 16;
/** Cap on a single env value, generous enough for a long path. */
export const MAX_VARIANT_ENV_VALUE_LEN = 4096;
/** Cap on a label, so the picker caption cannot be stuffed. */
export const MAX_VARIANT_LABEL_LEN = 40;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Provider ids a variant may not claim. The base engines plus the two
 * synthetic providers (`tour`, `guide`) that dispatch on their own id, plus
 * `shell` which the job handler treats as client-supplied argv.
 */
export const RESERVED_PROVIDER_IDS: ReadonlySet<string> = new Set([
  ...AGENT_VARIANT_BASES,
  "tour",
  "guide",
  "shell",
]);

/**
 * Env names Plannotator sets on every spawned job. A variant that overrode
 * these would point the agent's annotation callbacks at the wrong server, so
 * they are dropped rather than honored (the spawn also re-applies them last).
 */
const PROTECTED_ENV_KEYS: ReadonlySet<string> = new Set([
  "PLANNOTATOR_AGENT_SOURCE",
  "PLANNOTATOR_API_URL",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate and normalize the raw `agentVariants` config value.
 *
 * Fail-soft, entry by entry: a malformed variant is dropped with a warning and
 * the rest still load. A bad config line must never stop a review server from
 * starting — the same posture every other config key here takes.
 *
 * `expandPath` is supplied by the node-side loader so `~` in an env value
 * resolves against the real home; omitted (browser) values pass through.
 */
export function normalizeAgentVariants(
  raw: unknown,
  options?: {
    expandPath?: (value: string) => string;
    warn?: (message: string) => void;
  },
): AgentVariant[] {
  if (raw === undefined || raw === null) return [];
  const warn = options?.warn ?? (() => {});
  const expandPath = options?.expandPath ?? ((v: string) => v);

  if (!Array.isArray(raw)) {
    warn("agentVariants must be an array; ignoring it.");
    return [];
  }

  const out: AgentVariant[] = [];
  const seen = new Set<string>();

  for (const [index, entry] of raw.entries()) {
    const at = `agentVariants[${index}]`;
    if (!isRecord(entry)) {
      warn(`${at} is not an object; skipped.`);
      continue;
    }

    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!ID_PATTERN.test(id)) {
      warn(`${at}.id must be lowercase letters, digits or dashes (1-32 chars); skipped.`);
      continue;
    }
    if (RESERVED_PROVIDER_IDS.has(id)) {
      warn(`${at}.id "${id}" is a built-in provider id; skipped.`);
      continue;
    }
    if (seen.has(id)) {
      warn(`${at}.id "${id}" is already declared; skipped.`);
      continue;
    }

    const base = typeof entry.base === "string" ? entry.base.trim() : "";
    if (!(AGENT_VARIANT_BASES as readonly string[]).includes(base)) {
      warn(
        `${at}.base must be one of ${AGENT_VARIANT_BASES.join(", ")}; skipped.`,
      );
      continue;
    }

    const rawLabel = typeof entry.label === "string" ? entry.label.trim() : "";
    const label = (rawLabel || id).slice(0, MAX_VARIANT_LABEL_LEN);

    let accent: AgentVariantAccent | undefined;
    if (entry.accent !== undefined) {
      if (
        typeof entry.accent === "string" &&
        (AGENT_VARIANT_ACCENTS as readonly string[]).includes(entry.accent)
      ) {
        accent = entry.accent as AgentVariantAccent;
      } else {
        warn(
          `${at}.accent must be one of ${AGENT_VARIANT_ACCENTS.join(", ")}; using the default.`,
        );
      }
    }

    let binary: string | undefined;
    if (entry.binary !== undefined) {
      if (typeof entry.binary === "string" && entry.binary.trim().length > 0) {
        binary = expandPath(entry.binary.trim());
      } else {
        warn(`${at}.binary must be a non-empty string; ignoring it.`);
      }
    }

    const env: Record<string, string> = {};
    if (entry.env !== undefined) {
      if (!isRecord(entry.env)) {
        warn(`${at}.env must be an object of string values; ignoring it.`);
      } else {
        for (const [key, value] of Object.entries(entry.env)) {
          if (Object.keys(env).length >= MAX_VARIANT_ENV_ENTRIES) {
            warn(`${at}.env holds more than ${MAX_VARIANT_ENV_ENTRIES} entries; the rest were dropped.`);
            break;
          }
          if (!ENV_KEY_PATTERN.test(key)) {
            warn(`${at}.env key "${key}" is not a valid environment name; dropped.`);
            continue;
          }
          if (PROTECTED_ENV_KEYS.has(key)) {
            warn(`${at}.env may not override ${key}; dropped.`);
            continue;
          }
          if (typeof value !== "string" || value.length > MAX_VARIANT_ENV_VALUE_LEN) {
            warn(`${at}.env value for "${key}" must be a string under ${MAX_VARIANT_ENV_VALUE_LEN} chars; dropped.`);
            continue;
          }
          env[key] = expandPath(value);
        }
      }
    }

    if (Object.keys(env).length === 0 && !binary) {
      warn(
        `${at} declares neither env nor binary, so it would be identical to "${base}"; skipped.`,
      );
      continue;
    }

    seen.add(id);
    out.push({
      id,
      base: base as AgentVariantBase,
      label,
      accent: accent ?? AGENT_VARIANT_ACCENTS[out.length % AGENT_VARIANT_ACCENTS.length],
      env,
      ...(binary && { binary }),
    });

    if (out.length >= MAX_AGENT_VARIANTS) {
      if (index < raw.length - 1) {
        warn(`More than ${MAX_AGENT_VARIANTS} agent variants declared; the rest were dropped.`);
      }
      break;
    }
  }

  return out;
}

/** The declared variant with this provider id, if any. */
export function findAgentVariant(
  providerId: string,
  variants: readonly AgentVariant[],
): AgentVariant | undefined {
  return variants.find((v) => v.id === providerId);
}

/**
 * The engine a provider id dispatches as: a variant's base, or the id itself
 * for everything else. Every place that switches on a provider — prompt
 * composition, argv building, output parsing — asks this first, so a variant
 * needs no branch of its own anywhere downstream.
 */
export function resolveProviderBase(
  providerId: string,
  variants: readonly AgentVariant[],
): string {
  return findAgentVariant(providerId, variants)?.base ?? providerId;
}
