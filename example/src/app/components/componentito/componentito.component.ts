import { CommonModule } from '@angular/common';
import { Component, WritableSignal, inject } from '@angular/core';
import { User } from '../../models';
import { AppSignalKeys, emptyAppSignalState } from 'src/app/models/signals.model';
import { GENTLEMAN_DEFAULT_STATE } from 'gentleman-signals-state-manager';
import { SignalsManagerService } from 'src/app/services/signals-manager.service';

@Component({
  selector: 'app-componentito',
  standalone: true,
  imports: [CommonModule],
  providers: [
    { provide: GENTLEMAN_DEFAULT_STATE, useValue: emptyAppSignalState },
  ],
  templateUrl: './componentito.component.html',
  styleUrls: ['./componentito.component.scss'],
})
export class ComponentitoComponent {
  user: WritableSignal<User>;
  signalsManagerService = inject(SignalsManagerService);

  constructor() {
    this.user = this.signalsManagerService.singalsManager.getSignal<User>(AppSignalKeys.USER);
  }
}

