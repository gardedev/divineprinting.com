'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/books-print-quantity.js'), 'utf8');

function setup(initial = '') {
  let raw = initial;
  const writes = jest.fn();
  const inputEvents = {}, formEvents = {};
  const form = { addEventListener: jest.fn((name, handler, capture) => { formEvents[name] = { handler, capture }; }) };
  const input = {
    form, dataset: {}, message: '',
    setCustomValidity(message) { this.message = message; },
    reportValidity: jest.fn(),
    addEventListener: jest.fn((name, handler) => { inputEvents[name] = handler; }),
  };
  Object.defineProperty(input, 'value', { get: () => raw, set: value => { writes(value); raw = value; } });
  const document = { querySelector: jest.fn(() => input) };
  const run = () => vm.runInNewContext(source, { document });
  run();
  return { input, inputEvents, formEvents, run, writes, change(value) { raw = value; } };
}

const valid = ['1', '100', '10000', '20000', '25000', '50000', '100000', '9007199254740991', '000100', '0000000000000001'];
test.each(valid)('accepts exact positive digit quantity %s without changing its raw value', raw => {
  const state = setup(raw);
  expect(state.input.message).toBe('');
  expect(state.input.value).toBe(raw);
  expect(state.writes).not.toHaveBeenCalled();
});
const invalid = ['0', '0000', '-1', '1.5', '100.0', 'abc', '1e5', '2E4', ' 100', '100 ', '+100', '1,000', '١٠٠', '9007199254740992', '9007199254740993', '10000000000000000', '1'.repeat(1000)];
test.each(invalid)('rejects malformed/unsafe quantity %s without truncation or clamping', raw => {
  const state = setup(raw);
  expect(state.input.message).not.toBe('');
  expect(state.input.value).toBe(raw);
  expect(state.writes).not.toHaveBeenCalled();
});
test('empty input retains native required messaging but capture submit is prevented', () => {
  const state = setup();
  const event = { preventDefault: jest.fn(), stopImmediatePropagation: jest.fn() };
  state.formEvents.submit.handler(event);
  expect(state.input.message).toBe('');
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
  expect(state.input.reportValidity).toHaveBeenCalledTimes(1);
});
test('input/change correction clears an error and capture protects stale programmatic invalid values', () => {
  const state = setup('100');
  state.change('9007199254740993');
  const event = { preventDefault: jest.fn(), stopImmediatePropagation: jest.fn() };
  expect(state.formEvents.submit.capture).toBe(true);
  state.formEvents.submit.handler(event);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  state.change('20000'); state.inputEvents.input();
  expect(state.input.message).toBe('');
  const corrected = { preventDefault: jest.fn(), stopImmediatePropagation: jest.fn() };
  state.formEvents.submit.handler(corrected);
  expect(corrected.preventDefault).not.toHaveBeenCalled();
  state.change('2E4'); state.inputEvents.change();
  expect(state.input.message).not.toBe('');
  expect(state.writes).not.toHaveBeenCalled();
});
test('initializes once and does nothing on unrelated pages', () => {
  const state = setup('1'); state.run();
  expect(state.input.addEventListener).toHaveBeenCalledTimes(2);
  expect(state.input.form.addEventListener).toHaveBeenCalledTimes(1);
  expect(() => vm.runInNewContext(source, { document: { querySelector: () => null } })).not.toThrow();
});
