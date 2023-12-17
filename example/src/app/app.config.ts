import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideInitialState } from 'gentleman-signals-state-manager';
import { routes } from './app.routes';
import { emptyAppSignalState } from './models/signals.model';

export const appConfig: ApplicationConfig = {
  providers: [provideInitialState(emptyAppSignalState), provideRouter(routes)],
};
