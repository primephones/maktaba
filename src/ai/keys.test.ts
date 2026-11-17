import { describe, expect, it } from 'vitest';
import { readKey } from './keys';

const gemini = 'AIza' + 'Sy'.padEnd(35, 'x');
const groq = 'gsk_' + 'a'.repeat(52);
const openrouter = 'sk-or-v1-' + 'ab'.repeat(32);

describe('reading a pasted key', () => {
  it('recognises each service', () => {
    expect(readKey(gemini)).toEqual({ key: gemini, service: 'gemini' });
    expect(readKey(groq).service).toBe('groq');
    expect(readKey(openrouter).service).toBe('openrouter');
    expect(readKey('sk-proj-' + 'z'.repeat(40)).service).toBe('openai');
  });
  it('tidies what phones add when copying', () => {
    expect(readKey(`  "${gemini}"\n`).key).toBe(gemini);
    expect(readKey(`API key: ${groq}`).key).toBe(groq);
    expect(readKey(`Bearer ${groq}`).key).toBe(groq);
    expect(readKey(`​${gemini}​`).key).toBe(gemini);
  });
  it('explains what is wrong when it is not a key', () => {
    expect(readKey('').problem).toMatch(/Nothing was pasted/);
    expect(readKey('https://aistudio.google.com/app/apikey').problem).toMatch(/web address/);
    expect(readKey('someone@gmail.com').problem).toMatch(/email address/);
    expect(readKey('AIzaSyB12').problem).toMatch(/cut short/);
    expect(readKey(`${gemini} ${groq}`).problem).toMatch(/More than the key/);
    expect(readKey('hello').problem).toMatch(/too short/);
  });
  it('keeps one key out of surrounding words', () => {
    expect(readKey(`Your key is ${groq}`).key).toBe(groq);
  });
});
