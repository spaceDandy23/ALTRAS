import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPwaUpdate,
  getPwaUpdateState,
  initializePwaUpdates,
  resetPwaUpdateStateForTests,
  type PwaRegistrationOptions,
} from './pwa-update.service';

describe('PWA update safety', () => {
  beforeEach(resetPwaUpdateStateForTests);

  it('announces an update without applying or reloading it automatically', async () => {
    let options!: PwaRegistrationOptions;
    const apply = vi.fn().mockResolvedValue(undefined);
    const register = vi.fn((next: PwaRegistrationOptions) => {
      options = next;
      return apply;
    });
    initializePwaUpdates(register);
    options.onNeedRefresh?.();
    expect(getPwaUpdateState()).toEqual({ available: true, applying: false });
    expect(apply).not.toHaveBeenCalled();

    await applyPwaUpdate();
    expect(apply).toHaveBeenCalledWith(true);
  });
});
