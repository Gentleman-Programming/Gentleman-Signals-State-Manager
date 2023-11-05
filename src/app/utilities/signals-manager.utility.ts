import { WritableSignal, signal } from "@angular/core";

export class SignalsManager<T extends { [K in keyof T]: any }> {
  signalsCollection = new Map<keyof T, WritableSignal<T[keyof T]>>();

  constructor(defaultState: T) {
    for (const key in defaultState) {
      if (Object.prototype.hasOwnProperty.call(defaultState, key)) {
        const element = defaultState[key];
        this.addSignal(key as keyof T, element);
      }
    }
  }

  addSignal(key: keyof T, payload: T[keyof T]) {
    if (this.signalsCollection.has(key)) {
      const stringKey = String(key);
      throw new Error(`Signal ${stringKey} already exists`);
    }
    const signalObject = signal<T[keyof T]>(payload);
    this.signalsCollection.set(key, signalObject);
  }

  getSignal<U extends T[keyof T]>(key: keyof T): WritableSignal<U> {
    const foundSignal = this.signalsCollection.get(key);
    if (!foundSignal) {
      const stringKey = String(key);
      throw new Error(`Signal ${stringKey} does not exist`);
    }
    return foundSignal;
  }

  updateSignal(key: keyof T, payload: T[keyof T]) {
    const foundSignal = this.getSignal<typeof payload>(key);
    foundSignal.set(payload);
  }
}
