import { describe, expect, test } from "bun:test";
import {
  findAgentVariant,
  normalizeAgentVariants,
  resolveProviderBase,
  MAX_AGENT_VARIANTS,
  type AgentVariant,
} from "./agent-variants";

const CODEX_WORK = {
  id: "codex-work",
  base: "codex",
  label: "Codex Work",
  env: { CODEX_HOME: "~/.codex-work" },
  accent: "violet",
};

function normalize(raw: unknown) {
  const warnings: string[] = [];
  const variants = normalizeAgentVariants(raw, {
    expandPath: (v) => v.replace(/^~/, "/home/u"),
    warn: (m) => warnings.push(m),
  });
  return { variants, warnings };
}

describe("normalizeAgentVariants", () => {
  test("accepts a well-formed variant and expands ~ in env values", () => {
    const { variants, warnings } = normalize([CODEX_WORK]);
    expect(warnings).toEqual([]);
    expect(variants).toEqual([
      {
        id: "codex-work",
        base: "codex",
        label: "Codex Work",
        accent: "violet",
        env: { CODEX_HOME: "/home/u/.codex-work" },
      },
    ]);
  });

  test("absent or non-array config yields no variants", () => {
    expect(normalize(undefined).variants).toEqual([]);
    expect(normalize({ id: "x" }).variants).toEqual([]);
  });

  // Each of these would otherwise reach a spawn: a variant that collides with a
  // built-in provider id would shadow it in the capability list, a duplicate id
  // would make two picker entries indistinguishable, and an unknown base has no
  // prompt/argv/parse path to dispatch to.
  test.each([
    ["reserved id", { ...CODEX_WORK, id: "codex" }],
    ["reserved synthetic id", { ...CODEX_WORK, id: "guide" }],
    ["malformed id", { ...CODEX_WORK, id: "Codex Work" }],
    ["unknown base", { ...CODEX_WORK, base: "aider" }],
    ["missing base", { id: "x", label: "X", env: { A: "b" } }],
  ])("drops a variant with a %s", (_label, entry) => {
    const { variants, warnings } = normalize([entry]);
    expect(variants).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  test("drops a variant that would be identical to its base", () => {
    // No env and no binary means the same binary in the same environment: a
    // second picker entry that reviews with the same account.
    const { variants, warnings } = normalize([{ id: "codex-two", base: "codex", label: "Two" }]);
    expect(variants).toEqual([]);
    expect(warnings[0]).toContain("identical");
  });

  test("refuses to let a variant override Plannotator's own spawn vars", () => {
    // These carry the loopback URL the agent posts annotations back to.
    const { variants, warnings } = normalize([
      { ...CODEX_WORK, env: { PLANNOTATOR_API_URL: "http://evil", CODEX_HOME: "~/.codex-work" } },
    ]);
    expect(variants[0]!.env).toEqual({ CODEX_HOME: "/home/u/.codex-work" });
    expect(warnings.some((w) => w.includes("PLANNOTATOR_API_URL"))).toBe(true);
  });

  test("a later duplicate id is dropped, the first survives", () => {
    const { variants } = normalize([CODEX_WORK, { ...CODEX_WORK, label: "Impostor" }]);
    expect(variants).toHaveLength(1);
    expect(variants[0]!.label).toBe("Codex Work");
  });

  test("caps the list", () => {
    const many = Array.from({ length: MAX_AGENT_VARIANTS + 3 }, (_, i) => ({
      ...CODEX_WORK,
      id: `codex-${i}`,
    }));
    expect(normalize(many).variants).toHaveLength(MAX_AGENT_VARIANTS);
  });

  test("assigns distinct accents when none are declared", () => {
    const { variants } = normalize([
      { id: "a-one", base: "codex", env: { A: "1" } },
      { id: "b-two", base: "claude", env: { B: "2" } },
    ]);
    expect(variants[0]!.accent).not.toBe(variants[1]!.accent);
  });

  test("falls back to the id when no label is given", () => {
    const { variants } = normalize([{ id: "codex-work", base: "codex", env: { A: "1" } }]);
    expect(variants[0]!.label).toBe("codex-work");
  });
});

describe("resolveProviderBase", () => {
  const variants = normalize([CODEX_WORK]).variants as AgentVariant[];

  test("a variant resolves to its base, everything else to itself", () => {
    expect(resolveProviderBase("codex-work", variants)).toBe("codex");
    expect(resolveProviderBase("codex", variants)).toBe("codex");
    expect(resolveProviderBase("guide", variants)).toBe("guide");
  });

  test("findAgentVariant only matches a declared id", () => {
    expect(findAgentVariant("codex-work", variants)?.label).toBe("Codex Work");
    expect(findAgentVariant("codex", variants)).toBeUndefined();
  });
});
