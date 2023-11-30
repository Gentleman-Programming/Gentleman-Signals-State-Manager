import { makeEnvironmentProviders } from '@angular/core'
import { GENTLEMAN_DEFAULT_STATE, State } from './services/g-manager.service';

export function provideInitialState<T>(initialState: State<T>) {
  return makeEnvironmentProviders([
    { provide: GENTLEMAN_DEFAULT_STATE, useValue: initialState}
  ]);
}
