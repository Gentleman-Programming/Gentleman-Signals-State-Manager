import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { User } from '../../models';
import { SharedStateAppService, AppSignalKeys } from '../../services';

@Component({
  selector: 'app-componentito2',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './componentito2.component.html',
  styleUrls: ['./componentito2.component.scss'],
})
export class Componentito2Component {
  sharedStateAppService = inject(SharedStateAppService)

  changeSignal() {
    const userObject: User = {
      name: 'Alan',
      age: 30
    }

    this.sharedStateAppService.appSignalsState.updateSignal(AppSignalKeys.USER, userObject)
  }
}
