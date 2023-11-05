import { CommonModule } from '@angular/common';
import { Component, WritableSignal, inject } from '@angular/core';
import { User } from '../../models';
import { AppSignalKeys, SharedStateAppService } from '../../services';

@Component({
  selector: 'app-componentito',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './componentito.component.html',
  styleUrls: ['./componentito.component.scss'],
})
export class ComponentitoComponent {
  user: WritableSignal<User>;
  sharedStateAppService = inject(SharedStateAppService)

  constructor() {
    this.user = this.sharedStateAppService.appSignalsState.getSignal<User>(AppSignalKeys.USER);
  }
}

