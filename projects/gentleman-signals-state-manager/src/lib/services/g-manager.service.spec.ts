import { GENTLEMAN_DEFAULT_STATE } from './g-manager.service';
import { GManagerService } from './g-manager.service';

describe('GManagerService', () => {
  let service: GManagerService<any>;

  beforeEach(() => {
    service = new GManagerService(GENTLEMAN_DEFAULT_STATE);
  });

  test('should be created', () => {
    expect(service).toBeTruthy();
  });

  test('should add and get a signal', () => {
    service.addSignal('test', 'new value');
    const signal = service.getSignal('test');
    expect(signal()).toEqual('new value');
  });

  test('should update a signal', () => {
    service.addSignal('test', 'new value');
    service.updateSignal('test', 'updated value');
    const signal = service.getSignal('test');
    expect(signal()).toEqual('updated value');
  });

  test('should throw an error when trying to get a nonexistent signal', () => {
    expect(() => service.getSignal('nonexistent')).toThrow(new Error('Signal nonexistent does not exist'));
  });

  test('should throw an error when trying to add an existing signal', () => {
    service.addSignal('test', 'new value');
    expect(() => service.addSignal('test', 'value')).toThrow(new Error('Signal test already exists'));
  });
});
