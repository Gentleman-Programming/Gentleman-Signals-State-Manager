import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { Componentito2Component, ComponentitoComponent } from './components';
import { GENTLEMAN_DEFAULT_STATE } from 'gentleman-signals-state-manager';
import { SignalsManagerService } from './services/signals-manager.service';
import { AppSignalState, emptyAppSignalState } from './models/signals.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    ComponentitoComponent,
    Componentito2Component,
  ],
  providers: [
    SignalsManagerService<AppSignalState>,
    { provide: GENTLEMAN_DEFAULT_STATE, useValue: emptyAppSignalState },
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  title = 'Gentleman Signals State Manager';
}
