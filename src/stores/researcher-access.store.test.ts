import { beforeEach, describe, expect, it, vi } from 'vitest';

const isResearcher = vi.hoisted(() => vi.fn());
vi.mock('@/features/researcher/researcher.service', () => ({
  isCurrentUserResearcher: isResearcher,
}));

import { useResearcherAccessStore } from './researcher-access.store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('researcher access request identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useResearcherAccessStore.getState().clear();
  });

  it('does not apply user A response after user B starts resolving', async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    isResearcher.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const userA = useResearcherAccessStore.getState().checkAccess('user-a');
    const userB = useResearcherAccessStore.getState().checkAccess('user-b');
    first.resolve(true);
    await userA;
    expect(useResearcherAccessStore.getState()).toMatchObject({
      userId: 'user-b',
      status: 'loading',
    });

    second.resolve(false);
    await userB;
    expect(useResearcherAccessStore.getState()).toMatchObject({
      userId: 'user-b',
      status: 'denied',
    });
  });

  it('invalidates an in-flight result when access state is cleared', async () => {
    const pending = deferred<boolean>();
    isResearcher.mockReturnValue(pending.promise);
    const check = useResearcherAccessStore.getState().checkAccess('user-a');
    useResearcherAccessStore.getState().clear();
    pending.resolve(true);
    await check;
    expect(useResearcherAccessStore.getState()).toMatchObject({ status: 'idle', userId: null });
  });

  it('deduplicates a pending check for the same user', async () => {
    const pending = deferred<boolean>();
    isResearcher.mockReturnValue(pending.promise);
    const first = useResearcherAccessStore.getState().checkAccess('user-a');
    const second = useResearcherAccessStore.getState().checkAccess('user-a');
    expect(isResearcher).toHaveBeenCalledOnce();
    pending.resolve(false);
    await Promise.all([first, second]);
  });
});
