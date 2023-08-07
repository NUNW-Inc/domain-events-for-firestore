import {
  DomainEventPublisher,
  DomainEventSubscriber,
  DomainEvent,
  DomainEventHandler,
  AbstractDomainEvent,
  ReadDomainEventHandler,
  ReadContext,
} from "@nunw/domain-events-for-firestore";
import { DocumentReference, getFirestore } from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";

initializeApp({
  projectId: "example",
});

const firestore = getFirestore();
const publisher = new DomainEventPublisher(firestore);

class ExampleReadThenDoSomethingEvent extends AbstractDomainEvent {
  constructor(public readonly target: DocumentReference) {
    super();
  }
}

const subscriber: DomainEventSubscriber = {
  onEvent(event: DomainEvent): DomainEventHandler | undefined {
    if (event instanceof ExampleReadThenDoSomethingEvent) {
      return new (class extends ReadDomainEventHandler {
        private currentValue: number | undefined = undefined;

        async prepareHandleEvent(context: ReadContext): Promise<void> {
          const result = await context.get(event.target);
          this.currentValue = result.data()?.value;
        }

        async handleEvent(): Promise<void> {
          console.log(
            `現在の値は${
              this.currentValue ?? "0"
            }です。 ここは何度も実行される可能性があります。何度実行しても大丈夫な処理だけを記述します。`,
          );
        }
      })();
    } else {
      return undefined;
    }
  },
};

publisher.addSubscriber(subscriber);

await publisher.publish(
  new ExampleReadThenDoSomethingEvent(
    firestore.collection("example").doc("document1"),
  ),
);
