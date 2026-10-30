export class AttemptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttemptError';
  }
}
