export interface NewUserAccessOperations {
  researcher: boolean;
  admin: boolean;
  setResearcherAccess: (enabled: boolean) => Promise<void>;
  setAdminAccess: (enabled: boolean) => Promise<void>;
  deleteUser: () => Promise<void>;
}

export async function grantNewUserAccess(operations: NewUserAccessOperations): Promise<void> {
  try {
    if (operations.researcher) await operations.setResearcherAccess(true);
    if (operations.admin) await operations.setAdminAccess(true);
    return;
  } catch {
    const rollback = [
      ...(operations.admin ? [() => operations.setAdminAccess(false)] : []),
      ...(operations.researcher ? [() => operations.setResearcherAccess(false)] : []),
    ];
    await Promise.allSettled(rollback.map((operation) => operation()));
    try {
      await operations.deleteUser();
    } catch {
      throw new Error(
        'Account provisioning failed and automatic cleanup was incomplete. Review the account before retrying.',
      );
    }
    throw new Error('Account provisioning failed. The new account was removed; try again.');
  }
}
