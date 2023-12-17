import { Inject, Injectable, InjectionToken, WritableSignal } from "@angular/core";
import { GManager } from "../utilities";

export type State<T = {}> = { [K in keyof T]: any }

export const GENTLEMAN_DEFAULT_STATE = new InjectionToken<State>('GENTLEMAN_DEFAULT_STATE');

@Injectable({
  providedIn: 'root',
})
export class GManagerService<T extends State<T>> {
  singalsManager: GManager<T>;

  constructor(@Inject(GENTLEMAN_DEFAULT_STATE) defaultState: T) {
    this.singalsManager = new GManager(defaultState);
  }

  getSignal<U extends T[keyof T]>(key: keyof T): WritableSignal<U> {
    return this.singalsManager.getSignal<U>(key);
  }

  updateSignal(key: keyof T, payload: T[keyof T]) {
    this.singalsManager.updateSignal(key, payload);
  }

  addSignal(key: keyof T, payload: T[keyof T]) {
    this.singalsManager.addSignal(key, payload);
  }
}


