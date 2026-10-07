export class DomainValidationError extends Error {
  readonly code = 'domain_validation_error';

  constructor(message: string) {
    super(message);
    this.name = 'DomainValidationError';
  }
}
