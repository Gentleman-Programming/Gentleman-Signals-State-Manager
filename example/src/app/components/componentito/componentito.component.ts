import { CommonModule } from '@angular/common';
import { Component, WritableSignal, inject } from '@angular/core';
import { User } from '../../models';
import { AppSignalKeys, AppSignalState } from 'src/app/models/signals.model';
import { GManagerService } from 'gentleman-signals-state-manager';

@Component({
  selector: 'app-componentito',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './componentito.component.html',
  styleUrls: ['./componentito.component.scss'],
})
export class ComponentitoComponent {
  user: WritableSignal<User>;
  signalsManager = inject(GManagerService<AppSignalState>);

  constructor() {
    this.user = this.signalsManager.getSignal<User>(AppSignalKeys.USER);
  }
}

