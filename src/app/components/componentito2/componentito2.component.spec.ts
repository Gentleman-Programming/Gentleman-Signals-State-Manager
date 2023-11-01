import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Componentito2Component } from './componentito2.component';

describe('Componentito2Component', () => {
  let component: Componentito2Component;
  let fixture: ComponentFixture<Componentito2Component>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Componentito2Component]
    });
    fixture = TestBed.createComponent(Componentito2Component);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
