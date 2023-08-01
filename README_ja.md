# Domain Events for Firestore

Firestoreのtransaction機能を活用したドメインイベント処理の実装を支援するライブラリです。

- 単純なEventのPub/Sub機構です
- Firestoreのtransaction制限である「読み込みは書き込みの前にしか行えない」を扱いやすくするため、データ読み込みと書き込みを分けた実行フローを提供します。
- 複数の更新ロジックを組み合わせて実行できます
- 処理中にエラーが起こった場合ロールバックが行われます
- 回復可能なエラーが起こった場合、処理を再実行します


## 使用例

あるデータを読み込み、それを元にデータを更新する処理の例です。

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

コード全体は `example/src/transaction-update.ts` にあります。


## インストール

```bash
npm install @nunw/domain-events-for-firestore
```

## 説明

本ライブラリは以下の流れで処理を行います。

1. (事前準備)`DomainEventPublisher`に `DomainEventSubscriber`を登録する
2. 何かしらの処理でイベントをpublish(`DomainEventPublisher.publish`)する
3. `DomainEventSubscriber`が順次呼び出され `DomainEventHandler`が作成される
4. データ読み込みのため `DomainEventHandler`の `prepareHandleEvent` が呼ばれる
5. データ書き込みのため `DomainEventHandler`の `handleEvent` が呼ばれる

処理の途中でエラーが発生したらFirestoreの`commit()`が呼ばれないので安全に処理を中断できます。

`DomainEventSubscriber` は以下のinterfaceのもので、`DomainEventPublisher`の`addSubscriber`で登録します。

```ts
export interface DomainEventSubscriber {
    onEvent(event: DomainEvent): DomainEventHandler | undefined;
}
```

イベントがpublishされたとき、全てのsubscriberの`onEvent`が呼ばれます。
イベントを元に処理を行う場合は`DomainEventHandler`を返します。

`DomainEventHandler`はabstract classで次の種類があります

|            class名             | 読み込み可能 | 書き込み可能 | 備えるメソッド                                                                                                            |
|:-----------------------------:|:------:|:------:|:-------------------------------------------------------------------------------------------------------------------|
|   SimpleDomainEventHandler    |   ✗    |   ✗    | `handleEvent(): Promise<void>`                                                                                     |
| TransactionDomainEventHandler |   ✓    |   ✓    | `prepareHandleEvent(context: ReadContext): Promise<void>`<br/> `handleEvent(context: WriteContext): Promise<void>` |
|    BatchDomainEventHandler    |   ✗    |   ✓    | `handleEvent(context: WriteContext): Promise<void>`                                                                |
|    ReadDomainEventHandler     |   ✓    |   ✗    | `prepareHandleEvent(context: ReadContext): Promise<void>`<br/> `handleEvent(): Promise<void>`                      |

`WriteContext`はFirestoreに対する書き込み操作のみ操作を行うことができるオブジェクトです。
`ReadContext`はFirestoreに対する読み込み処理のみを行うことができるオブジェクトです。

何れの`DomainEventHandler`も `onSuccess(): Promise<void>` や `rollback(): Promise<void>`をoverrideすることで、成功時や失敗時の後処理を記述できます。

## 利用方法

[`example/src`](`example/src`) を参照してください