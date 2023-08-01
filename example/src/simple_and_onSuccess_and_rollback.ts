import {
  DomainEventPublisher,
  DomainEventSubscriber,
  DomainEvent,
  DomainEventHandler,
  AbstractDomainEvent,
  SimpleDomainEventHandler,
} from "@nunw/domain-events-for-firestore";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";

initializeApp({
  projectId: "example",
});

const firestore = getFirestore();
const publisher = new DomainEventPublisher(firestore);

class ExampleDoSomethingEvent extends AbstractDomainEvent {
  constructor(public readonly target: string) {
    super();
  }
}

const subscriber: DomainEventSubscriber = {
  onEvent(event: DomainEvent): DomainEventHandler | undefined {
    if (event instanceof ExampleDoSomethingEvent) {
      return new (class extends SimpleDomainEventHandler {
        async handleEvent(): Promise<void> {
          console.log(
            "ここは何度も実行される可能性があります。何度実行しても大丈夫な処理だけを記述します。",
          );
        }

        override async onSuccess(): Promise<void> {
          console.log(
            "onSuccessをoverrideすると、全てのイベントが成功した時に実行されます",
          );
        }

        override async rollback(): Promise<void> {
          console.log(
            "rollbackをoverrideすると、いずれかのイベントが失敗した時に実行されます",
          );
        }
      })();
    } else {
      return undefined;
    }
  },
};

publisher.addSubscriber(subscriber);

await publisher.publish(new ExampleDoSomethingEvent("example"));
