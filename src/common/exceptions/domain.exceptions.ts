import { ConflictException, ForbiddenException } from '@nestjs/common';

export class InvalidStateTransitionException extends ConflictException {
  constructor(current: string, target: string) {
    super({
      code: 'INVALID_STATE_TRANSITION',
      message: `Transition ${current} -> ${target} is not allowed`,
    });
  }
}

export class ConcurrentModificationException extends ConflictException {
  constructor() {
    super({
      code: 'CONCURRENT_MODIFICATION',
      message: 'The resource changed concurrently; retry the request',
    });
  }
}

export class ResourceForbiddenException extends ForbiddenException {
  constructor(message = 'You are not authorized to access this resource') {
    super({ code: 'FORBIDDEN', message });
  }
}

export class ReviewNotEditableException extends ConflictException {
  constructor() {
    super({ code: 'REVIEW_NOT_EDITABLE', message: 'Completed reviews cannot be changed' });
  }
}

export class SubmissionImmutableException extends ConflictException {
  constructor() {
    super({
      code: 'SUBMISSION_IMMUTABLE',
      message: 'Submitted submissions are immutable',
    });
  }
}
