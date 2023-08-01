import { Done, Failure, Result, Success } from "./Result.js";
import { Firestore } from "firebase-admin/firestore";
import {
  BatchDomainEventHandler,
  DomainEvent,
  DomainEventHandler,
  DomainEventSubscriber,
  isCombineEvents,
  NormalDomainEvent,
  ReadDomainEventHandler,
  SimpleDomainEventHandler,
  TransactionDomainEventHandler,
} from "./DomainEvent.js";
import { FirestoreReadContext, TransactionReadContext } from "./ReadContext.js";
import { sleep } from "./sleep.js";
import { compactMap } from "./compactMap.js";
import {
  FirestoreWriteContext,
  TransactionWriteContext,
} from "./WriteContext.js";

/**
 * For internal processing of DomainEventPublisher
 * Only used to determine the retry interval when an error occurs while processing multiple events
 */
class MultipleDomainEventWrapper implements NormalDomainEvent {
  constructor(public events: NormalDomainEvent[]) {}

  readonly eventName: string = "multipleDomainEvent";

  get retryIntervalExtendFactorMillSec(): number {
    return Math.max(
      ...this.events.map((_) => _.retryIntervalExtendFactorMillSec),
    );
  }

  get retryIntervalMaxMillSec(): number {
    return Math.max(...this.events.map((_) => _.retryIntervalMaxMillSec));
  }

  get retryMax(): number {
    return Math.min(...this.events.map((_) => _.retryMax));
  }

  isRetryableError(obj: unknown): boolean {
    return this.events.every((_) => _.isRetryableError(obj));
  }
}

/**
 * Prepares batch or transaction and launches handler according to the type of EventHandler (simple/batch/transaction) returned by addSubscriber.
 * If an error occurs, it performs the retry process specified in the event
 */
export class DomainEventPublisher {
  private readonly firestore: Firestore;
  private readonly sleep: (ms: number) => Promise<void>;

  /**
   * @param firestore instance of firestore
   * @param sleepMethod method of sleep that can be injected for testing
   */
  constructor(
    firestore: Firestore,
    sleepMethod?: (ms: number) => Promise<void>,
  ) {
    this.firestore = firestore;
    this.sleep = sleepMethod ?? sleep;
  }

  /**
   * Retry process
   */
  protected async doRetryUntilGiveUp(
    e: Error,
    event: NormalDomainEvent,
    retryCount: number,
    next: (nextCount: number) => Promise<void>,
  ): Promise<Result<Done, Error>> {
    if (event.isRetryableError(e) && retryCount + 1 < event.retryMax) {
      const sleepMs = Math.min(
        event.retryIntervalExtendFactorMillSec * (retryCount + 1),
        event.retryIntervalMaxMillSec,
      );

      await this.sleep(sleepMs);

      await next(retryCount + 1);

      return new Success(Done.instance);
    } else {
      return new Failure(e);
    }
  }

  /**
   * Error retry process used by dispatchSimple|dispatchBatch|dispatchTransaction
   */
  private async handleError(
    e: unknown,
    event: NormalDomainEvent,
    retryCount: number,
    handlers: DomainEventHandler[],
    next: (nextCount: number) => Promise<void>,
  ) {
    if (e instanceof Error) {
      const recover = await this.doRetryUntilGiveUp(e, event, retryCount, next);

      if (recover.isFailure()) {
        for (const handler of handlers) {
          await handler.rollback();
        }
      }
      throw e;
    } else {
      throw e;
    }
  }

  /**
   * Processing when only Simple is involved
   */
  protected async dispatchSimple(
    event: NormalDomainEvent,
    handlers: DomainEventHandler[],
    retryCount: number,
  ): Promise<void> {
    try {
      for (const handler of handlers) {
        if (handler instanceof SimpleDomainEventHandler) {
          await handler.handleEvent();
        }
      }
    } catch (e) {
      await this.handleError(e, event, retryCount, handlers, (nextCount) =>
        this.dispatchSimple(event, handlers, nextCount),
      );
    }
  }

  /**
   * Processing when only Read or Simple is involved without Transaction
   */
  protected async dispatchRead(
    event: NormalDomainEvent,
    handlers: DomainEventHandler[],
    retryCount: number,
  ): Promise<void> {
    try {
      for (const handler of handlers) {
        if (handler instanceof ReadDomainEventHandler) {
          await handler.prepareHandleEvent(
            new FirestoreReadContext(this.firestore),
          );
        }
      }

      for (const handler of handlers) {
        if (handler instanceof ReadDomainEventHandler) {
          await handler.handleEvent();
        } else if (handler instanceof SimpleDomainEventHandler) {
          await handler.handleEvent();
        }
      }
    } catch (e) {
      await this.handleError(
        e,
        event,
        retryCount,
        handlers,
        async (nextCount: number) => {
          await this.dispatchRead(event, handlers, nextCount);
        },
      );
    }
  }

  /**
   * Processing when only Read, Batch, or Simple is involved without Transaction
   */
  protected async dispatchBatch(
    event: NormalDomainEvent,
    handlers: DomainEventHandler[],
    retryCount: number,
  ): Promise<void> {
    try {
      for (const handler of handlers) {
        if (handler instanceof ReadDomainEventHandler) {
          await handler.prepareHandleEvent(
            new FirestoreReadContext(this.firestore),
          );
        }
      }

      const batch = this.firestore.batch();
      const wrap = new FirestoreWriteContext(batch);
      for (const handler of handlers) {
        if (handler instanceof BatchDomainEventHandler) {
          await handler.handleEvent(wrap);
        } else if (handler instanceof ReadDomainEventHandler) {
          await handler.handleEvent();
        } else if (handler instanceof SimpleDomainEventHandler) {
          await handler.handleEvent();
        }
      }

      await batch.commit();
    } catch (e) {
      await this.handleError(
        e,
        event,
        retryCount,
        handlers,
        async (nextCount: number) => {
          await this.dispatchBatch(event, handlers, nextCount);
        },
      );
    }
  }

  /**
   * Processing for a group of events that includes transactions
   */
  protected async dispatchTransaction(
    event: NormalDomainEvent,
    handlers: DomainEventHandler[],
    retryCount: number,
  ): Promise<void> {
    try {
      await this.firestore.runTransaction(async (transaction) => {
        for (const handler of handlers) {
          if (handler instanceof TransactionDomainEventHandler) {
            await handler.prepareHandleEvent(
              new TransactionReadContext(transaction),
            );
          } else if (handler instanceof ReadDomainEventHandler) {
            await handler.prepareHandleEvent(
              new TransactionReadContext(transaction),
            );
          }
        }

        const wrap = new TransactionWriteContext(transaction);

        for (const handler of handlers) {
          if (
            handler instanceof TransactionDomainEventHandler ||
            handler instanceof BatchDomainEventHandler
          ) {
            await handler.handleEvent(wrap);
          } else {
            await handler.handleEvent();
          }
        }
      });
    } catch (e) {
      await this.handleError(
        e,
        event,
        retryCount,
        handlers,
        async (nextCount: number) => {
          await this.dispatchTransaction(event, handlers, nextCount);
        },
      );
    }
  }

  private async execute(
    event: NormalDomainEvent,
    eventHandlers: DomainEventHandler[],
  ): Promise<void> {
    const containTransaction =
      eventHandlers.find((_) => _ instanceof TransactionDomainEventHandler) !==
      undefined;
    const containBatch =
      eventHandlers.find((_) => _ instanceof BatchDomainEventHandler) !==
      undefined;
    const containRead =
      eventHandlers.find((_) => _ instanceof ReadDomainEventHandler) !==
      undefined;

    if (containTransaction) {
      await this.dispatchTransaction(event, eventHandlers, 0);
    } else if (containBatch) {
      await this.dispatchBatch(event, eventHandlers, 0);
    } else if (containRead) {
      await this.dispatchRead(event, eventHandlers, 0);
    } else {
      await this.dispatchSimple(event, eventHandlers, 0);
    }
  }

  async publish(...events: DomainEvent[]): Promise<void> {
    if (events.length == 0) return;

    const expandEvents = events.flatMap((event) => {
      if (isCombineEvents(event)) {
        return event.events;
      } else {
        return [event];
      }
    });

    const eventHandlers = expandEvents.flatMap((e) => {
      return compactMap(this.subscribers, (_) => _.onEvent(e));
    });

    const wrap = new MultipleDomainEventWrapper(expandEvents);
    await this.execute(wrap, eventHandlers);

    for (const handler of eventHandlers) {
      await handler.onSuccess();
    }
  }

  get subscribers(): DomainEventSubscriber[] {
    return this._subscribers;
  }

  private _subscribers: DomainEventSubscriber[] = [];

  addSubscriber(subscriber: DomainEventSubscriber): void {
    this.subscribers.push(subscriber);
  }
}
