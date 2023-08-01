import {
  AbstractDomainEvent,
  BatchDomainEventHandler,
  CombinedDomainEvent,
  DomainEvent,
  DomainEventHandler,
  DomainEventSubscriber,
  NormalDomainEvent,
  SimpleDomainEventHandler,
  TransactionDomainEventHandler,
  WriteContext,
  ReadContext,
  DomainEventPublisher,
} from "@/index.js";
import {
  mock,
  verify,
  anything,
  reset,
  when,
  instance,
} from "@typestrong/ts-mockito";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { initializeApp, getApp, deleteApp } from "firebase-admin/app";
import * as crypto from "crypto";
import { resetFirestore } from "./ResetFirestore.js";

class AnyErrorRetryEvent extends AbstractDomainEvent {
  constructor() {
    super(10, 100, 500);
  }

  isRetryableError(_: unknown): boolean {
    return true;
  }
}

class NoRetryEvent extends AbstractDomainEvent {
  constructor() {
    super();
  }

  isRetryableError(_: unknown): boolean {
    return false;
  }
}

const projectId = `test-${crypto.randomUUID()}`;

beforeAll(async () => {
  initializeApp(
    {
      projectId: projectId,
    },
    projectId,
  );
});

afterAll(async () => {
  await deleteApp(getApp(projectId));
});

afterEach(async () => {
  await resetFirestore(projectId);
});

function adminDB(): Firestore {
  return getFirestore(getApp(projectId));
}

function instanceMock<T>(mock: T, prototype: object): T {
  const i = instance(mock);
  Object.setPrototypeOf(i, prototype);
  return i;
}

describe("DomainEventPublisher", () => {
  class Context {
    publisher: DomainEventPublisher;
    subscribes: DomainEventSubscriber[];
    sleepHistory: number[] = [];

    constructor(public handlers: DomainEventHandler[]) {
      this.subscribes = handlers.map((handler) => {
        return {
          onEvent(_: DomainEvent): DomainEventHandler | undefined {
            return handler;
          },
        };
      });

      this.publisher = new DomainEventPublisher(
        adminDB(),
        async (ms: number) => {
          this.sleepHistory.push(ms);
        },
      );

      this.subscribes.forEach((_) => this.publisher.addSubscriber(_));
    }
  }

  describe("Firestore write test", () => {
    it("Can write with BatchEventHandler", async () => {
      const nycRef = adminDB().collection("cities").doc("NYC");
      const data = { name: "New York City" };

      const batchHandler: BatchDomainEventHandler =
        new (class extends BatchDomainEventHandler {
          async handleEvent(context: WriteContext): Promise<void> {
            context.set(nycRef, data);
          }
        })();

      const context = new Context([batchHandler]);
      const event = new AnyErrorRetryEvent();
      await context.publisher.publish(event);

      const result = await nycRef.get();
      expect(result.data()).toEqual(data);
    });

    it("Does not write when BatchEventHandler fails halfway", async () => {
      const nycRef = adminDB().collection("cities").doc("NYC");
      const data = { name: "New York City" };

      const batchHandler: BatchDomainEventHandler =
        new (class extends BatchDomainEventHandler {
          async handleEvent(context: WriteContext): Promise<void> {
            context.set(nycRef, data);
            throw new Error("force error");
          }
        })();

      const context = new Context([batchHandler]);
      const event = new AnyErrorRetryEvent();

      try {
        await context.publisher.publish(event);
      } catch (e) {
        // do nothing
      }

      const result = await nycRef.get();
      expect(result.data()).toBeUndefined();
    });

    it("Can read and write with TransactionEventHandler", async () => {
      const nycRef = adminDB().collection("cities").doc("NYC");
      const dataNyc = { name: "New York City" };
      const sfRef = adminDB().collection("cities").doc("SF");
      const dataSf = { name: "San Francisco" };

      const transactionHandler: TransactionDomainEventHandler =
        new (class extends TransactionDomainEventHandler {
          async prepareHandleEvent(context: ReadContext): Promise<void> {
            const result = await context.get(nycRef);
            expect(result.data()).toEqual(dataNyc);
            return Promise.resolve();
          }

          async handleEvent(context: WriteContext): Promise<void> {
            context.set(sfRef, dataSf);
          }
        })();

      const context = new Context([transactionHandler]);
      const event = new AnyErrorRetryEvent();

      await nycRef.set(dataNyc);
      await context.publisher.publish(event);

      const result = await sfRef.get();
      expect(result.data()).toEqual(dataSf);
    });

    it("Does not write when TransactionEventHandler fails halfway", async () => {
      const nycRef = adminDB().collection("cities").doc("NYC");
      const dataNyc = { name: "New York City" };
      const sfRef = adminDB().collection("cities").doc("SF");
      const dataSf = { name: "San Francisco" };

      const transactionHandler: TransactionDomainEventHandler =
        new (class extends TransactionDomainEventHandler {
          async prepareHandleEvent(context: ReadContext): Promise<void> {
            const result = await context.get(nycRef);
            expect(result.data()).toEqual(dataNyc);
            return Promise.resolve();
          }

          async handleEvent(context: WriteContext): Promise<void> {
            context.set(sfRef, dataSf);
            throw new Error("force error");
          }
        })();

      const context = new Context([transactionHandler]);
      const event = new AnyErrorRetryEvent();

      await nycRef.set(dataNyc);
      try {
        await context.publisher.publish(event);
      } catch (e) {
        // do nothing
      }

      const result = await sfRef.get();
      expect(result.data()).toBeUndefined();
    });

    it("Can write even if Batch and Transaction are mixed", async () => {
      const nycRef = adminDB().collection("cities").doc("NYC");
      const dataNyc = { name: "New York City" };
      const sfRef = adminDB().collection("cities").doc("SF");
      const dataSf = { name: "San Francisco" };

      const txRef = adminDB().collection("cities").doc("TX");
      const dataTx = { name: "Texas" };

      const transactionHandler: TransactionDomainEventHandler =
        new (class extends TransactionDomainEventHandler {
          async prepareHandleEvent(context: ReadContext): Promise<void> {
            const result = await context.get(nycRef);
            expect(result.data()).toEqual(dataNyc);
            return Promise.resolve();
          }

          async handleEvent(context: WriteContext): Promise<void> {
            context.set(sfRef, dataSf);
          }
        })();

      const batchHandler: BatchDomainEventHandler =
        new (class extends BatchDomainEventHandler {
          async handleEvent(context: WriteContext): Promise<void> {
            context.set(txRef, dataTx);
          }
        })();

      const context = new Context([transactionHandler, batchHandler]);
      const event = new AnyErrorRetryEvent();

      await nycRef.set(dataNyc);
      await context.publisher.publish(event);

      const result1 = await sfRef.get();
      expect(result1.data()).toEqual(dataSf);

      const result2 = await txRef.get();
      expect(result2.data()).toEqual(dataTx);
    });
  });

  describe("Check delivery to SimpleEventHandler and retry mechanism", () => {
    const handlerMock: SimpleDomainEventHandler =
      mock<SimpleDomainEventHandler>();

    beforeEach(() => {
      reset(handlerMock);
    });

    it("Event is delivered & executed", async () => {
      when(handlerMock.handleEvent()).thenResolve();

      const context = new Context([
        instanceMock(handlerMock, SimpleDomainEventHandler.prototype),
      ]);

      const event = new AnyErrorRetryEvent();
      await context.publisher.publish(event);

      verify(handlerMock.handleEvent());
    });

    it("Retry according to retry setting when an error occurs", async () => {
      when(handlerMock.handleEvent()).thenReject(new Error("force error"));

      const context = new Context([
        instanceMock(handlerMock, SimpleDomainEventHandler.prototype),
      ]);

      //Retry settings max10, factor100ms, max500ms
      const event = new AnyErrorRetryEvent();

      const exec = context.publisher.publish(event);
      await expect(exec).rejects.toThrow();

      verify(handlerMock.handleEvent()).times(10);
      expect(context.sleepHistory).toEqual([
        100, 200, 300, 400, 500, 500, 500, 500, 500,
      ]);
    });

    it("rollback is called when it ends with an error", async () => {
      when(handlerMock.handleEvent()).thenReject(new Error("force error"));
      when(handlerMock.rollback()).thenResolve();

      const context = new Context([
        instanceMock(handlerMock, SimpleDomainEventHandler.prototype),
      ]);

      //Retry settings max10, factor100ms, max500ms
      const event = new AnyErrorRetryEvent();

      const exec = context.publisher.publish(event);
      await expect(exec).rejects.toThrow();

      verify(handlerMock.handleEvent()).times(10);
      verify(handlerMock.rollback()).once();
    });

    it("if isErrorRetry is false, there is no retry", async () => {
      when(handlerMock.handleEvent()).thenReject(new Error("force error"));
      const context = new Context([
        instanceMock(handlerMock, SimpleDomainEventHandler.prototype),
      ]);

      const event = new NoRetryEvent();
      const exec = context.publisher.publish(event);
      await expect(exec).rejects.toThrow();

      verify(handlerMock.handleEvent()).once();
    });

    class ExampleCombineEvent implements CombinedDomainEvent {
      eventName = this.constructor.name;

      get events(): NormalDomainEvent[] {
        return [new AnyErrorRetryEvent(), new AnyErrorRetryEvent()];
      }
    }

    it("CombineEvent can combine multiple events", async () => {
      when(handlerMock.handleEvent()).thenResolve();

      const context = new Context([
        instanceMock(handlerMock, SimpleDomainEventHandler.prototype),
      ]);

      const event = new ExampleCombineEvent();
      await context.publisher.publish(event);

      verify(handlerMock.handleEvent()).times(2);
    });
  });

  describe("Delivery to BatchEventHandler", () => {
    const handlerMock: BatchDomainEventHandler =
      mock<BatchDomainEventHandler>();

    beforeEach(() => {
      reset(handlerMock);
    });

    it("Events are dispatched & executed", async () => {
      when(handlerMock.handleEvent(anything())).thenResolve();

      const context = new Context([
        instanceMock(handlerMock, BatchDomainEventHandler.prototype),
      ]);

      const event = new AnyErrorRetryEvent();
      await context.publisher.publish(event);

      verify(handlerMock.handleEvent(anything()));
    });

    it("rollback is called when it ends with an error", async () => {
      when(handlerMock.handleEvent(anything())).thenReject(
        new Error("force error"),
      );
      when(handlerMock.rollback()).thenResolve();

      const context = new Context([
        instanceMock(handlerMock, BatchDomainEventHandler.prototype),
      ]);

      //Retry settings max10, factor100ms, max500ms
      const event = new AnyErrorRetryEvent();

      const exec = context.publisher.publish(event);
      await expect(exec).rejects.toThrow();

      verify(handlerMock.handleEvent(anything())).times(10);
      verify(handlerMock.rollback()).once();
    });
  });

  describe("Delivery to TransactionEventHandler", () => {
    const handlerMock: TransactionDomainEventHandler =
      mock<TransactionDomainEventHandler>();

    beforeEach(() => {
      reset(handlerMock);
    });

    it("Events are dispatched & executed", async () => {
      when(handlerMock.prepareHandleEvent(anything())).thenResolve();

      when(handlerMock.handleEvent(anything())).thenResolve();

      const context = new Context([
        instanceMock(handlerMock, TransactionDomainEventHandler.prototype),
      ]);

      const event = new AnyErrorRetryEvent();
      await context.publisher.publish(event);

      verify(handlerMock.prepareHandleEvent(anything()));
      verify(handlerMock.handleEvent(anything()));
    });

    it("rollback is called when it ends with an error", async () => {
      when(handlerMock.handleEvent(anything())).thenReject(
        new Error("force error"),
      );
      when(handlerMock.rollback()).thenResolve();

      const context = new Context([
        instanceMock(handlerMock, TransactionDomainEventHandler.prototype),
      ]);

      //Retry settings max10, factor100ms, max500ms
      const event = new AnyErrorRetryEvent();

      const exec = context.publisher.publish(event);
      await expect(exec).rejects.toThrow();

      verify(handlerMock.handleEvent(anything())).times(10);
      verify(handlerMock.rollback()).once();
    });
  });

  describe("Mix of Batch/SimpleEventHandler", () => {
    const simpleHandlerMock: SimpleDomainEventHandler =
      mock<SimpleDomainEventHandler>();
    const batchHandlerMock: BatchDomainEventHandler =
      mock<BatchDomainEventHandler>();

    beforeEach(() => {
      reset(batchHandlerMock);
      reset(simpleHandlerMock);
    });

    it("Events are dispatched & executed to all", async () => {
      when(simpleHandlerMock.handleEvent()).thenResolve();
      when(batchHandlerMock.handleEvent(anything())).thenResolve();

      const context = new Context([
        instanceMock(batchHandlerMock, BatchDomainEventHandler.prototype),
        instanceMock(simpleHandlerMock, SimpleDomainEventHandler.prototype),
      ]);

      const event = new AnyErrorRetryEvent();
      await context.publisher.publish(event);

      verify(simpleHandlerMock.handleEvent());
      verify(batchHandlerMock.handleEvent(anything()));
    });
  });

  describe("Mix of Transaction/Batch/SimpleEventHandler", () => {
    const simpleHandlerMock: SimpleDomainEventHandler =
      mock<SimpleDomainEventHandler>();
    const batchHandlerMock: BatchDomainEventHandler =
      mock<BatchDomainEventHandler>();
    const transactionHandlerMock: TransactionDomainEventHandler =
      mock<TransactionDomainEventHandler>();

    beforeEach(() => {
      reset(batchHandlerMock);
      reset(simpleHandlerMock);
      reset(transactionHandlerMock);
    });

    it("Events are dispatched & executed to all", async () => {
      when(simpleHandlerMock.handleEvent()).thenResolve();
      when(batchHandlerMock.handleEvent(anything())).thenResolve();
      when(transactionHandlerMock.prepareHandleEvent(anything())).thenResolve();
      when(transactionHandlerMock.handleEvent(anything())).thenResolve();

      const context = new Context([
        instanceMock(batchHandlerMock, BatchDomainEventHandler.prototype),
        instanceMock(simpleHandlerMock, SimpleDomainEventHandler.prototype),
        instanceMock(
          transactionHandlerMock,
          TransactionDomainEventHandler.prototype,
        ),
      ]);

      const event = new AnyErrorRetryEvent();
      await context.publisher.publish(event);

      verify(simpleHandlerMock.handleEvent());
      verify(batchHandlerMock.handleEvent(anything()));
      verify(transactionHandlerMock.prepareHandleEvent(anything()));
      verify(transactionHandlerMock.handleEvent(anything()));
    });
  });
});
