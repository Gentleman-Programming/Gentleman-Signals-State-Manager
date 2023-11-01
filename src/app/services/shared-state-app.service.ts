import { Injectable } from '@angular/core';
import { SignalsManager } from '../utilities/signals-manager.utility';
import { User } from '../models';

export enum AppSignalKeys {
  'USER' = 'user',
  'TEST' = 'test',
}

export interface AppSignalState {
  [key: string]: any;
  [AppSignalKeys.USER]: User;
  [AppSignalKeys.TEST]: string;
}

export const emptyAppSignalState: AppSignalState = {
  [AppSignalKeys.USER]: {
    name: '',
    age: 0,
  },
  [AppSignalKeys.TEST]: '',
};

@Injectable({
  providedIn: 'root',
})
export class SharedStateAppService {
  appSignalsState = new SignalsManager<AppSignalState>(emptyAppSignalState);
}
