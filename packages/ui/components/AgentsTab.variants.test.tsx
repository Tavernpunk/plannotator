import { afterEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AgentsTab, type AgentLaunchParams } from './AgentsTab';
import type { AgentCapabilities } from '../types';

/**
 * Agent variants in the review engine picker (see
 * @plannotator/core/agent-variants). A variant is the same base CLI spawned
 * with a different environment, so it must:
 *   - appear as its own option, next to the base it re-points;
 *   - launch under its OWN provider id (the id is what selects the env
 *     overlay server-side — launching as the base would silently review with
 *     the wrong account);
 *   - be told apart visually, since it borrows the base's icon.
 * The picker is icon-only, so without the accent dot and caption two Codex
 * marks would be indistinguishable.
 */

const hasDom = typeof document !== 'undefined';
let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  if (hasDom) document.body.replaceChildren();
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=;max-age=0;path=/`;
  });
});

const CAPABILITIES: AgentCapabilities = {
  mode: 'review',
  available: true,
  providers: [
    { id: 'claude', name: 'Claude Code', available: true },
    { id: 'codex', name: 'Codex CLI', available: true },
    { id: 'codex-work', name: 'Codex Work', available: true, base: 'codex', accent: 'violet' },
    { id: 'tour', name: 'Code Tour', available: false },
    { id: 'guide', name: 'Guided Review', available: false },
  ],
};

const launches: AgentLaunchParams[] = [];

async function mount(capabilities: AgentCapabilities) {
  launches.length = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <AgentsTab
        jobs={[]}
        capabilities={capabilities}
        onLaunch={(params) => {
          launches.push(params);
          return null;
        }}
        onKillJob={() => {}}
        onKillAll={() => {}}
        externalAnnotations={[]}
      />,
    );
  });
}

function engineButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].filter((b) =>
    ['Claude', 'Codex', 'Codex Work'].includes(b.getAttribute('aria-label') ?? ''),
  );
}

describe.if(hasDom)('AgentsTab review engine picker — agent variants', () => {
  test('offers the variant as its own option, immediately after its base', async () => {
    await mount(CAPABILITIES);
    expect(engineButtons().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Claude',
      'Codex',
      'Codex Work',
    ]);
  });

  test('marks the variant with an accent dot the base does not carry', async () => {
    await mount(CAPABILITIES);
    const [, codex, codexWork] = engineButtons();
    // The dot is the only thing separating two identical Codex marks.
    expect(codexWork!.querySelector('span[aria-hidden]')).not.toBeNull();
    expect(codex!.querySelector('span[aria-hidden]')).toBeNull();
  });

  test('launches under the variant id, not the base', async () => {
    await mount(CAPABILITIES);
    const codexWork = engineButtons().find((b) => b.getAttribute('aria-label') === 'Codex Work');
    await act(async () => codexWork!.click());
    const launch = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Run',
    ) as HTMLButtonElement | undefined;
    expect(launch).toBeDefined();
    await act(async () => launch!.click());
    expect(launches).toHaveLength(1);
    // The provider id is what selects the env overlay server-side.
    expect(launches[0]!.provider).toBe('codex-work');
    // …while the model/effort come from the BASE engine's settings section.
    expect(launches[0]!.reasoningEffort).toBeDefined();
  });

  test('no variants ⇒ the picker is unchanged (no dots, no caption)', async () => {
    await mount({
      ...CAPABILITIES,
      providers: CAPABILITIES.providers.filter((p) => p.id !== 'codex-work'),
    });
    expect(engineButtons().map((b) => b.getAttribute('aria-label'))).toEqual(['Claude', 'Codex']);
    expect(document.querySelector('button[aria-pressed] span[aria-hidden]')).toBeNull();
  });
});
