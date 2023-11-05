import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { User } from '../../models';
import { GManagerService } from 'gentleman-signals-state-manager';
import { AppSignalKeys, AppSignalState } from 'src/app/models/signals.model';

@Component({
  selector: 'app-componentito2',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './componentito2.component.html',
  styleUrls: ['./componentito2.component.scss'],
})
export class Componentito2Component {
  signalsManager = inject(GManagerService<AppSignalState>);

  changeSignal() {
    const userObject: User = {
      name: 'Alan',
      age: 30
    }

    this.signalsManager.updateSignal(AppSignalKeys.USER, userObject)
  }
}
