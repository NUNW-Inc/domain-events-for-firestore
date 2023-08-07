import {
  DomainEventPublisher,
  DomainEventSubscriber,
  DomainEvent,
  DomainEventHandler,
  WriteContext,
  AbstractDomainEvent,
  BatchDomainEventHandler,
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
    public readonly value: number,
  ) {
    super();
  }
}

const subscriber: DomainEventSubscriber = {
  onEvent(event: DomainEvent): DomainEventHandler | undefined {
    if (event instanceof ExampleUpdateEvent) {
      return new (class extends BatchDomainEventHandler {
        async handleEvent(context: WriteContext): Promise<void> {
          context.set(event.target, {
            value: event.value,
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
  new ExampleUpdateEvent(firestore.collection("example").doc("document1"), 1),
);
