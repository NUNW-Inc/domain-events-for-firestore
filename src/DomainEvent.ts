import { ReadContext } from "./ReadContext.js";
import { WriteContext } from "./WriteContext.js";

export type DomainEvent = CombinedDomainEvent | NormalDomainEvent;

/**
 * A bundle of multiple DomainEvents
 */
export interface CombinedDomainEvent {
  readonly eventName: string;

  readonly events: NormalDomainEvent[];
}

export function isCombineEvents(
  event: DomainEvent,
): event is CombinedDomainEvent {
  return "events" in event;
}

/**
 * DomainEvent
 */
export interface NormalDomainEvent {
  readonly eventName: string;

  /**
   * The number of times to retry when a recoverable error is thrown
   */
  retryMax: number;

  /**
   * This time × number of retries is the retry interval
   * If retryIntervalExtendFactorMillSec is 100ms and
   * retryIntervalMaxMillSec is 1000ms, then
   *  First time 100ms
   *  Second time 200ms
   *  Third time 300ms
   *  ...
   *  Tenth time 1000ms
   *  Eleventh time 1000ms
   *  Twelfth time 1000ms
   *  ...
   */
  retryIntervalExtendFactorMillSec: number;

  /**
   * Maximum retry interval
   */
  retryIntervalMaxMillSec: number;

  /**
   * If thrown, DomainEventPublisher calls this method and if true, it performs a retry operation.
   */
  isRetryableError(obj: unknown): boolean;
}

export interface Retryable {
  readonly retryable: true;
}

export abstract class AbstractDomainEvent implements NormalDomainEvent {
  readonly eventName = this.constructor.name;

  public retryMax: number;
  public retryIntervalExtendFactorMillSec: number;
  public retryIntervalMaxMillSec: number;

  protected constructor(
    retryMax = 50,
    retryIntervalExtendFactorMillSec = 50,
    retryIntervalMaxMillSec = 1000,
  ) {
    this.retryMax = retryMax;
    this.retryIntervalMaxMillSec = retryIntervalMaxMillSec;
    this.retryIntervalExtendFactorMillSec = retryIntervalExtendFactorMillSec;
  }

  isRetryableError(obj: unknown): boolean {
    if (!obj || typeof obj !== "object") return false;

    const cast = obj as { code?: string; retryable?: boolean };

    if (cast.retryable === true) {
      return true;
    } else if (cast.retryable === false) {
      return false;
    } else if (cast.code) {
      switch (cast.code) {
        case "firestore/unavailable":
        case "firestore/resource-exhausted":
        case "firestore/internal":
        case "firestore/deadline-exceeded":
        case "firestore/data-loss":
        case "firestore/aborted":
        case "firestore/cancelled":
          return true;
        default:
          return false;
      }
    } else {
      return false;
    }
  }
}

export interface DomainEventSubscriber {
  /**
   * Called when there is an event
   */
  onEvent(event: DomainEvent): DomainEventHandler | undefined;
}

/**
 * The class that processes events. Created by DomainEventSubscriber.
 * It can be created for each event, so it's okay to have a state.
 */
export type DomainEventHandler =
  | SimpleDomainEventHandler
  | TransactionDomainEventHandler
  | BatchDomainEventHandler
  | ReadDomainEventHandler;

/**
 * An event handler that performs operations that do not use Firestore.
 */
export abstract class SimpleDomainEventHandler {
  /**
   * Perform processing according to the event. **This method may be called multiple times due to retry processing**
   */
  abstract handleEvent(): Promise<void>;

  /**
   * Called when all event handlers have been successful
   * Override only when you want to write
   */
  async onSuccess(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Process when an error occurs in any of the event handlers.
   * Override only when you want to write
   */
  async rollback(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Event handler compatible with Transaction.
 * Since it can be created for each event, it's okay to have a state, so it's a good idea to load the necessary data in prepareHandleEvent and then process it in handleEvent.
 */
export abstract class TransactionDomainEventHandler {
  /**
   * If you want to read values from firestore, read them here and save them to yourself. **This method may be called multiple times due to retry processing**
   */
  abstract prepareHandleEvent(context: ReadContext): Promise<void>;

  /**
   * Perform processing according to the event **This method may be called multiple times due to retry processing**
   */
  abstract handleEvent(context: WriteContext): Promise<void>;

  /**
   * Called when all event handlers have been successful
   * Override only when you want to write
   * Be careful not to throw an exception here as it will not be rolled back
   */
  async onSuccess(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * The process when an error occurs in any of the event handlers and you want to roll back side effects other than firestore.
   * Override only when you want to write
   * Be careful not to throw an exception here as it will not be rolled back
   */
  async rollback(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Event handler compatible with Batch
 * You can only write.
 */
export abstract class BatchDomainEventHandler {
  /**
   * Perform processing according to the event **This method may be called multiple times due to retry processing**
   */
  abstract handleEvent(context: WriteContext): Promise<void>;

  /**
   * Called when all event handlers have been successful
   * Override only when you want to write
   * Be careful not to throw an exception here as it will not be rolled back
   */
  async onSuccess(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * The process when an error occurs in any of the event handlers and you want to roll back side effects other than firestore.
   * Override only when you want to write
   * Be careful not to throw an exception here as it will not be rolled back
   */
  async rollback(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * An event handler that reads values from firestore and processes events without writing to firestore.
 * Since it can be created for each event, it's okay to have a state, so it's a good idea to load the necessary data in prepareHandleEvent and then process it in handleEvent.
 */
export abstract class ReadDomainEventHandler {
  /**
   * If you want to read values from firestore, read them here and save them to yourself. **This method may be called multiple times due to retry processing**
   */
  abstract prepareHandleEvent(context: ReadContext): Promise<void>;

  /**
   * Perform processing according to the event **This method may be called multiple times due to retry processing**
   */
  abstract handleEvent(): Promise<void>;

  /**
   * Called when all event handlers have been successful
   * Override only when you want to write
   * Be careful not to throw an exception here as it will not be rolled back
   */
  async onSuccess(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * The process when an error occurs in any of the event handlers and you want to roll back side effects other than firestore.
   * Override only when you want to write
   * Be careful not to throw an exception here as it will not be rolled back
   */
  async rollback(): Promise<void> {
    return Promise.resolve();
  }
}
