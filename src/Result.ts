export type Result<T, E> = Success<T, E> | Failure<T, E>;

export class Success<T, E> {
  constructor(readonly value: T) {}

  type = "success" as const;

  isSuccess(): this is Success<T, E> {
    return true;
  }

  isFailure(): this is Failure<T, E> {
    return false;
  }
}

export class Failure<T, E> {
  constructor(readonly value: E) {}

  type = "failure" as const;

  isSuccess(): this is Success<T, E> {
    return false;
  }

  isFailure(): this is Failure<T, E> {
    return true;
  }
}

/**
 * Object representing completion. Used when void is difficult to use (for example, Result<void,Error> is inconvenient because new Success() cannot be done)
 */
export class Done {
  private static _instance: Done = new Done();

  private constructor() {}

  static get instance() {
    return Done._instance;
  }
}
