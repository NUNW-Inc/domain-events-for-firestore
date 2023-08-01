import { ReadOptions } from "@google-cloud/firestore";
import {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Query,
  QuerySnapshot,
  Transaction,
} from "firebase-admin/firestore";

/**
 * Get via Transaction or direct Get from Firestore
 */
export interface ReadContext {
  query<T>(query: Query<T>): Promise<QuerySnapshot<T>>;

  get<T>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>>;

  getAll(
    ...documentRefsOrReadOptions: Array<DocumentReference | ReadOptions>
  ): Promise<Array<DocumentSnapshot>>;
}

/**
 * Create a reading context from Transaction
 */
export class TransactionReadContext implements ReadContext {
  constructor(private readonly t: Transaction) {}

  query<T>(query: Query<T>): Promise<QuerySnapshot<T>> {
    return this.t.get(query);
  }

  get<T>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
    return this.t.get(ref);
  }

  getAll(
    ...documentRefsOrReadOptions: Array<DocumentReference | ReadOptions>
  ): Promise<Array<DocumentSnapshot>> {
    return this.t.getAll(...documentRefsOrReadOptions);
  }
}

/**
 * Create a reading context from Firestore
 */
export class FirestoreReadContext implements ReadContext {
  constructor(private readonly firestore: Firestore) {}

  query<T>(query: Query<T>): Promise<QuerySnapshot<T>> {
    return query.get();
  }

  get<T>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
    return ref.get();
  }

  async getAll(
    ...documentRefsOrReadOptions: Array<DocumentReference | ReadOptions>
  ): Promise<Array<DocumentSnapshot>> {
    return this.firestore.getAll(...documentRefsOrReadOptions);
  }
}
