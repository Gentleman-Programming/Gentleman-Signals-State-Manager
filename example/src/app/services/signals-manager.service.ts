import { Inject, Injectable } from "@angular/core";
import { GENTLEMAN_DEFAULT_STATE, GManagerService } from "gentleman-signals-state-manager";

@Injectable({
  providedIn: 'root',
})
export class SignalsManagerService<T> {
  singalsManager: GManagerService<T>;

  constructor(@Inject(GENTLEMAN_DEFAULT_STATE) defaultState: T) {
    this.singalsManager = new GManagerService(defaultState);
  }
}
