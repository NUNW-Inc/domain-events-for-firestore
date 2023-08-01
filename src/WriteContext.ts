/* eslint-disable @typescript-eslint/no-explicit-any,no-dupe-class-members */
import { Precondition, SetOptions } from "@google-cloud/firestore";
import {
  DocumentReference,
  FieldPath,
  Transaction,
  UpdateData,
  WriteBatch,
} from "firebase-admin/firestore";

export interface WriteContext {
  set<T>(
    documentRef: DocumentReference<T>,
    data: Partial<T>,
    options?: SetOptions,
  ): void;

  set<T>(documentRef: DocumentReference<T>, data: T): void;

  add<T>(
    documentRef: DocumentReference<T>,
    data: Partial<T>,
  ): DocumentReference;

  add<T>(documentRef: DocumentReference<T>, data: T): DocumentReference;

  update<T>(
    documentRef: DocumentReference<any>,
    data: UpdateData<T>,
    precondition?: Precondition,
  ): void;

  update(
    documentRef: DocumentReference<any>,
    field: string | FieldPath,
    value: any,
    ...fieldsOrPrecondition: any[]
  ): void;

  delete(
    documentRef: DocumentReference<any>,
    precondition?: Precondition,
  ): void;
}

export class TransactionWriteContext implements WriteContext {
  constructor(private readonly transaction: Transaction) {}

  set<T>(
    documentRef: DocumentReference<T>,
    data: Partial<T>,
    options?: SetOptions,
  ): void;
  set<T>(documentRef: DocumentReference<T>, data: T): void;
  set(documentRef: any, data: any, options?: any): void {
    this.transaction.set(documentRef, data, options);
  }

  add<T>(
    documentRef: DocumentReference<T>,
    data: Partial<T>,
  ): DocumentReference;
  add<T>(documentRef: DocumentReference<T>, data: T): DocumentReference<T> {
    this.transaction.create(documentRef, data);
    return documentRef;
  }

  update<T>(
    documentRef: DocumentReference<any>,
    data: UpdateData<T>,
    precondition?: Precondition,
  ): void;
  update(
    documentRef: DocumentReference<any>,
    field: string | FieldPath,
    value: any,
    ...fieldsOrPrecondition: any[]
  ): void;
  update(
    documentRef: any,
    dataOrField: any,
    preconditionOrValue?: any,
    ...rest: any[]
  ): void {
    switch (arguments.length) {
      case 2:
        this.transaction.update(documentRef, dataOrField);
        break;
      case 3:
        this.transaction.update(documentRef, dataOrField, preconditionOrValue);
        break;
      default:
        this.transaction.update(
          documentRef,
          dataOrField,
          preconditionOrValue,
          ...rest,
        );
        break;
    }
  }

  delete(
    documentRef: DocumentReference<any>,
    precondition?: Precondition,
  ): void {
    this.transaction.delete(documentRef, precondition);
  }
}

export class FirestoreWriteContext implements WriteContext {
  constructor(private readonly batch: WriteBatch) {}

  set<T>(
    documentRef: DocumentReference<T>,
    data: Partial<T>,
    options?: SetOptions,
  ): void;
  set<T>(documentRef: DocumentReference<T>, data: T): void;
  set(documentRef: any, data: any, options?: any): void {
    this.batch.set(documentRef, data, options);
  }

  add<T>(
    documentRef: DocumentReference<T>,
    data: Partial<T>,
  ): DocumentReference;
  add<T>(documentRef: DocumentReference<T>, data: T): DocumentReference<T> {
    this.batch.create(documentRef, data);
    return documentRef;
  }

  update<T>(
    documentRef: DocumentReference<any>,
    data: UpdateData<T>,
    precondition?: Precondition,
  ): void;
  update(
    documentRef: DocumentReference<any>,
    field: string | FieldPath,
    value: any,
    ...fieldsOrPrecondition: any[]
  ): void;
  update(
    documentRef: any,
    dataOrField: any,
    preconditionOrValue?: any,
    ...rest: any[]
  ): void {
    switch (arguments.length) {
      case 2:
        this.batch.update(documentRef, dataOrField);
        break;
      case 3:
        this.batch.update(documentRef, dataOrField, preconditionOrValue);
        break;
      default:
        this.batch.update(
          documentRef,
          dataOrField,
          preconditionOrValue,
          ...rest,
        );
        break;
    }
  }

  delete(
    documentRef: DocumentReference<any>,
    precondition?: Precondition,
  ): void {
    this.batch.delete(documentRef, precondition);
  }
}
