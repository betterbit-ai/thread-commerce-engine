export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigurationError extends DomainError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'CONFIGURATION_ERROR', context);
  }
}
export class ValidationError extends DomainError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'VALIDATION_ERROR', context);
  }
}
export class ExternalApiError extends DomainError {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    context: Record<string, unknown> = {},
  ) {
    super(message, 'EXTERNAL_API_ERROR', context);
  }
}
export class CapabilityUnavailableError extends DomainError {
  constructor(capability: string) {
    super(`${capability} is not configured or verified`, 'CAPABILITY_UNAVAILABLE', { capability });
  }
}
export class PublishSafetyError extends DomainError {
  constructor(message: string) {
    super(message, 'PUBLISH_SAFETY_ERROR');
  }
}
