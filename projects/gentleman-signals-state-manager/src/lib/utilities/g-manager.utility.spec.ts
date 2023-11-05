import { WritableSignal } from '@angular/core';
import { GManager } from './g-manager.utility';

describe('GManager', () => {
  let signalsManager: GManager<any>;

  beforeEach(() => {
    const defaultState = { test: 'default' };
    signalsManager = new GManager(defaultState);
  });

  test('should be created', () => {
    expect(signalsManager).toBeTruthy();
  });

  test('should add and get a signal', () => {
    signalsManager.addSignal('testSignal', 'new value');
    const signal: WritableSignal<string> = signalsManager.getSignal('testSignal');
    expect(signal()).toEqual('new value');
  });

  test('should update a signal', () => {
    signalsManager.updateSignal('test', 'updated value');
    const signal: WritableSignal<string> = signalsManager.getSignal('test');
    expect(signal()).toEqual('updated value');
  });

  test('should throw an error when trying to get a nonexistent signal', () => {
    expect(() => signalsManager.getSignal('nonexistent')).toThrow(new Error('Signal nonexistent does not exist'));
  });

  test('should throw an error when trying to add an existing signal', () => {
    expect(() => signalsManager.addSignal('test', 'value')).toThrow(new Error('Signal test already exists'));
  });
});
