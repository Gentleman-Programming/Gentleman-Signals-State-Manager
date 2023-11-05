import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { User } from '../../models';
import { GManagerService } from 'gentleman-signals-state-manager';
import { AppSignalKeys, AppSignalState } from 'src/app/models/signals.model';
import { SignalsManagerService } from 'src/app/services/signals-manager.service';

@Component({
  selector: 'app-componentito2',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './componentito2.component.html',
  styleUrls: ['./componentito2.component.scss'],
})
export class Componentito2Component {
  signalsManagerService = inject(SignalsManagerService);

  changeSignal() {
    const userObject: User = {
      name: 'Alan',
      age: 30
    }

    this.signalsManagerService.singalsManager.updateSignal(AppSignalKeys.USER, userObject)
  }
}
