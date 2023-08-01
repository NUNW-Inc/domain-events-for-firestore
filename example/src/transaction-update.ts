import {
  DomainEventPublisher,
  DomainEventSubscriber,
  DomainEvent,
  DomainEventHandler,
  TransactionDomainEventHandler,
  ReadContext,
  WriteContext,
  AbstractDomainEvent,
} from "@nunw/domain-events-for-firestore";
import { getFirestore, DocumentReference } from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";

initializeApp({
  projectId: "example",
});

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
