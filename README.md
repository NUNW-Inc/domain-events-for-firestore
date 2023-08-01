# Domain Events for Firestore

This is a library that supports the implementation of domain event processing utilizing Firestore's transaction feature.

- It is a simple Pub/Sub mechanism for Events
- In order to make it easy to handle Firestore's transaction restriction, "Read operations must be performed before
  write operations", it provides an execution flow that separates data reading and writing.
- You can combine and execute multiple update logics
- If an error occurs during processing, a rollback will be performed
- If a recoverable error occurs, the process will be retried

## Example

This is an example of a process that reads certain data and updates that data based on it.

```ts
const firestore = getFirestore();

const publisher = new DomainEventPublisher(firestore);

class ExampleUpdateEvent extends AbstractDomainEvent {
  constructor(
    public readonly target: DocumentReference,
    public readonly incrementValue: number,
  ) {
    super();
  }
}

const subscriber: DomainEventSubscriber = {
  onEvent(event: DomainEvent): DomainEventHandler | undefined {
    if (event instanceof ExampleUpdateEvent) {
      return new (class extends TransactionDomainEventHandler {
        private currentValue: number | undefined = undefined;

        async prepareHandleEvent(context: ReadContext): Promise<void> {
          const result = await context.get(event.target);
          this.currentValue = result.data()?.value;
        }

        async handleEvent(context: WriteContext): Promise<void> {
          context.set(event.target, {
            value: (this.currentValue ?? 0) + event.incrementValue,
          });
        }
      })();
    } else {
      return undefined;
    }
  },
};

publisher.addSubscriber(subscriber);

await publisher.publish(
  new ExampleUpdateEvent(
    firestore.collection("transactionExample").doc("value1"),
    1,
  ),
);
```

The entire code can be found in `example/src/transaction-update.ts`.

## Installation

```bash
npm install @nunw/domain-events-for-firestore
```

## Explanation

This library processes in the following flow.

1. (Preparation) Register `DomainEventSubscriber` in `DomainEventPublisher`
2. Publish an event in some processing (`DomainEventPublisher.publish`)
3. `DomainEventSubscriber` is called sequentially and `DomainEventHandler` is created
4. `DomainEventHandler`'s `prepareHandleEvent` is called for data reading
5. `DomainEventHandler`'s `handleEvent` is called for data writing

If an error occurs during the process, Firestore's `commit()` is not called, so you can safely interrupt the process.

`DomainEventSubscriber` is an interface as follows, and you register it with `DomainEventPublisher`'s `addSubscriber`.

```ts
export interface DomainEventSubscriber {
  onEvent(event: DomainEvent): DomainEventHandler | undefined;
}
```

When an event is published, `onEvent` of all subscribers is called. If you perform processing based on the event,
return `DomainEventHandler`.

`DomainEventHandler` is an abstract class and there are the following types

|          Class name           | Readable | Writable | Method provided                                                                                                    |
| :---------------------------: | :------: | :------: | :----------------------------------------------------------------------------------------------------------------- |
|   SimpleDomainEventHandler    |    ✗     |    ✗     | `handleEvent(): Promise<void>`                                                                                     |
| TransactionDomainEventHandler |    ✓     |    ✓     | `prepareHandleEvent(context: ReadContext): Promise<void>`<br/> `handleEvent(context: WriteContext): Promise<void>` |
|    BatchDomainEventHandler    |    ✗     |    ✓     | `handleEvent(context: WriteContext): Promise<void>`                                                                |
|    ReadDomainEventHandler     |    ✓     |    ✗     | `prepareHandleEvent(context: ReadContext): Promise<void>`<br/> `handleEvent(): Promise<void>`                      |

`WriteContext` is an object that can only perform write operations against Firestore.
`ReadContext` is an object that can only perform read operations against Firestore.

Any `DomainEventHandler` can override `onSuccess(): Promise<void>` or `rollback(): Promise<void>` to describe
post-processing at the time of success or failure.

## Usage

Please refer to [`example/src`](https://github.com/NUNW-Inc/domain-events-for-firestore/tree/main/example/src).
