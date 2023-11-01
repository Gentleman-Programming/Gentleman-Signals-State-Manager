import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComponentitoComponent } from './componentito.component';

describe('ComponentitoComponent', () => {
  let component: ComponentitoComponent;
  let fixture: ComponentFixture<ComponentitoComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ComponentitoComponent]
    });
    fixture = TestBed.createComponent(ComponentitoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
