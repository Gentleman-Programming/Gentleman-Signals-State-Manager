import { User } from "./user.model";

export const AppSignalKeys = {
  'USER': 'user',
  'TEST': 'test',
} as const

export interface AppSignalState {
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

