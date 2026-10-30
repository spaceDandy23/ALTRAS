export class AuthError extends Error {
  constructor(
    public readonly code: 'DUPLICATE_USERNAME' | 'INVALID_CREDENTIALS' | 'INVALID_DATA',
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
