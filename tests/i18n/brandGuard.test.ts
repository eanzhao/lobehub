import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import common from '@/locales/default/common';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Issue #7 — aevatar rebrand sanity checks.
 *
 * 1. tools/ci/brand-guard.sh must pass on the current locale sources, so we
 *    don't regress new LobeHub / LobeChat brand strings into user-visible
 *    values.
 * 2. The About-page upstream credit must mention LobeHub by name — required
 *    for upstream attribution in the live UI.
 * 3. BRANDING_NAME must resolve to 'Aevatar' through the business-const
 *    package, since that's what UI components like the About Version block
 *    render.
 */
describe('brand guard (issue #7)', () => {
  it('passes tools/ci/brand-guard.sh on current locale sources', () => {
    expect(() => {
      execFileSync('bash', ['tools/ci/brand-guard.sh'], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });
    }).not.toThrow();
  });

  it('preserves upstream attribution in the About-dialog credit', () => {
    expect(common.aboutCredit).toMatch(/LobeHub/);
  });

  it('exposes the rebranded BRANDING_NAME via business-const', async () => {
    const mod = await import('@lobechat/business-const');
    expect(mod.BRANDING_NAME).toBe('Aevatar');
  });
});
