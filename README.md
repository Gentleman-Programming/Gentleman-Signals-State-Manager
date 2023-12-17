# 🚀 gentleman-signals-state-manager: !Managing signal state as a gentleman! 🎩

## Description
`GManagerService` is at the heart of the `gentleman-signals-state-manager` library, a state signal management service in Angular that is not only classy, but super powerful!

### Why use `gentleman-signals-state-manager` instead of 'raw' signals?

- 🎯 **Framework-Agnostic**: Designed to work with Angular, but thanks to its agnostic design, it could be easily adapted for any frontend library or framework.

- 💼 **Simplified Signal Management**: Forget about manually handling signals and let `GManagerService` take care of everything. Add, update, and get signals with ease.

- 🛡️ **Robust**: Handles errors automatically, protecting your app against non-existent or duplicate signals.

- 🚀 **Optimized Performance**: By managing signals efficiently, `GManagerService` helps keep your app fast and agile.
  
## Recommended Usage
To start using `gentleman-signals-state-manager` in your own project, follow the format shown below:

```typescript
// Import the necessary
import { Inject, Injectable } from "@angular/core";
import { GENTLEMAN_DEFAULT_STATE, GManagerService } from "gentleman-signals-state-manager";

// Define your own service
@Injectable({
  providedIn: 'root',
})
export class SignalsManagerService<T> {
  signalsManager: GManagerService<T>;

  // Inject the initial state
  constructor(@Inject(GENTLEMAN_DEFAULT_STATE) defaultState: T) {
    this.signalsManager = new GManagerService(defaultState);
  }
}
```

Provide your initial state inside your `app.config.ts`

```ts
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideInitialState } from 'gentleman-signals-state-manager'

const initial initialState = {
  isLogged: false,
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideInitialState(initialState),
    provideRouter(routes)
  ]
};
```

For a complete example of how to use `gentleman-signals-state-manager`, check out the "example" folder in our GitHub repository.

To install `gentleman-signals-state-manager` in your project, head over to [the package page on npm](https://www.npmjs.com/package/gentleman-signals-state-manager).

You're all set to start managing state signals like a true gentleman! 🎩🚀
