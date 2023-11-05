import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { Componentito2Component, ComponentitoComponent } from './components';
import { GENTLEMAN_DEFAULT_STATE } from 'gentleman-signals-state-manager';
import { emptyAppSignalState } from './models/signals.model';

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
    { provide: GENTLEMAN_DEFAULT_STATE, useValue: emptyAppSignalState },
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  title = 'Gentleman Signals State Manager';
}
