import { describe, expect, it, vi } from 'vitest';
import { grantNewUserAccess } from '../../../supabase/functions/admin-users/provisioning';

function callbacks() {
  return {
    setResearcherAccess: vi.fn().mockResolvedValue(undefined),
    setAdminAccess: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
  };
}

describe('new admin account provisioning rollback', () => {
  it('revokes uncertain researcher access and deletes the new user when that grant fails', async () => {
    const operations = callbacks();
    operations.setResearcherAccess.mockRejectedValueOnce(new Error('grant failed'));

    await expect(
      grantNewUserAccess({ researcher: true, admin: false, ...operations }),
    ).rejects.toThrow('new account was removed');

    expect(operations.setResearcherAccess).toHaveBeenNthCalledWith(1, true);
    expect(operations.setResearcherAccess).toHaveBeenNthCalledWith(2, false);
    expect(operations.deleteUser).toHaveBeenCalledOnce();
  });

  it('revokes both roles and deletes the new user when the admin grant fails', async () => {
    const operations = callbacks();
    operations.setAdminAccess.mockRejectedValueOnce(new Error('grant failed'));

    await expect(
      grantNewUserAccess({ researcher: true, admin: true, ...operations }),
    ).rejects.toThrow('new account was removed');

    expect(operations.setAdminAccess).toHaveBeenNthCalledWith(1, true);
    expect(operations.setAdminAccess).toHaveBeenNthCalledWith(2, false);
    expect(operations.setResearcherAccess).toHaveBeenLastCalledWith(false);
    expect(operations.deleteUser).toHaveBeenCalledOnce();
  });

  it('reports incomplete cleanup while still attempting every rollback step', async () => {
    const operations = callbacks();
    operations.setAdminAccess.mockRejectedValueOnce(new Error('grant failed'));
    operations.setResearcherAccess
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('revoke failed'));
    operations.deleteUser.mockRejectedValueOnce(new Error('delete failed'));

    await expect(
      grantNewUserAccess({ researcher: true, admin: true, ...operations }),
    ).rejects.toThrow('cleanup was incomplete');

    expect(operations.setAdminAccess).toHaveBeenCalledWith(false);
    expect(operations.setResearcherAccess).toHaveBeenCalledWith(false);
    expect(operations.deleteUser).toHaveBeenCalledOnce();
  });

  it('keeps a successful dual-role account and never calls rollback', async () => {
    const operations = callbacks();

    await expect(
      grantNewUserAccess({ researcher: true, admin: true, ...operations }),
    ).resolves.toBeUndefined();

    expect(operations.setResearcherAccess).toHaveBeenCalledExactlyOnceWith(true);
    expect(operations.setAdminAccess).toHaveBeenCalledExactlyOnceWith(true);
    expect(operations.deleteUser).not.toHaveBeenCalled();
  });
});
