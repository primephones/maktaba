import type { KeyService } from './signin';

/**
 * Making sense of what someone pastes into a key box. People copy a key from a web page on
 * a phone, and often bring along spaces, quotes, a label, or the wrong thing entirely.
 * This tidies what can be tidied, recognises which service a key belongs to, and says in
 * plain words what is wrong when it is not a key.
 */

export interface KeyReading {
  /** The key, tidied. */
  key: string;
  /** Which service the key is from, when its shape shows it. */
  service?: KeyService | 'openai' | 'anthropic';
  /** Something to tell the person, when the paste is not (or not quite) a key. */
  problem?: string;
}

const SHAPES: Array<{ service: NonNullable<KeyReading['service']>; re: RegExp; prefix: RegExp; name: string }> = [
  { service: 'gemini', re: /^AIza[0-9A-Za-z_-]{35}$/, prefix: /^AIza/, name: 'Google Gemini' },
  // Google's newer keys (from 2026): "AQ." and a long line of letters, numbers, _ and -.
  { service: 'gemini', re: /^AQ\.[0-9A-Za-z_-]{40,}$/, prefix: /^AQ\./, name: 'Google Gemini' },
  { service: 'groq', re: /^gsk_[0-9A-Za-z]{40,64}$/, prefix: /^gsk_/, name: 'Groq' },
  { service: 'openrouter', re: /^sk-or-v1-[0-9a-f]{64}$/, prefix: /^sk-or-/, name: 'OpenRouter' },
  { service: 'anthropic', re: /^sk-ant-[0-9A-Za-z_-]{20,}$/, prefix: /^sk-ant-/, name: 'Anthropic' },
  { service: 'openai', re: /^sk-(proj-)?[0-9A-Za-z_-]{20,}$/, prefix: /^sk-(?!or-|ant-)/, name: 'OpenAI' },
];

export const SERVICE_NAME: Record<string, string> = Object.fromEntries(SHAPES.map((s) => [s.service, s.name]));

export function readKey(pasted: string): KeyReading {
  let k = pasted
    .replace(/[​-‏‪-‮﻿]/g, '')
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .replace(/^(bearer|api[ _-]?key|key|token)\s*[:=]?\s*/i, '')
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .trim();
  if (!k) return { key: '', problem: 'Nothing was pasted. On the key page, tap the copy button next to the key, then come back and paste.' };
  if (/^https?:\/\//i.test(k)) return { key: '', problem: 'That is a web address, not the key. On the page, find the key itself (a long line of letters and numbers) and tap its copy button.' };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)) return { key: '', problem: 'That is an email address, not the key. Sign in on the key page, then copy the key it shows you.' };
  // A key never has spaces inside; a line break usually means two things were copied.
  if (/\s/.test(k)) {
    const parts = k.split(/\s+/).filter((p) => p.length >= 20);
    if (parts.length === 1) k = parts[0];
    else return { key: '', problem: 'More than the key was copied. Copy only the key (one long line with no spaces) and paste again.' };
  }
  const exact = SHAPES.find((s) => s.re.test(k));
  if (exact) return { key: k, service: exact.service };
  const near = SHAPES.find((s) => s.prefix.test(k));
  if (near) {
    return {
      key: k,
      service: near.service,
      problem: k.length < 30 || /…|\.\.\./.test(k)
        ? `This looks like the start of a ${near.name} key, but it is cut short. Use the copy button next to the key rather than selecting it by hand.`
        : undefined,
    };
  }
  if (k.length < 20) return { key: '', problem: 'This is too short to be a key. Keys are long, usually 40 characters or more. Use the copy button next to the key.' };
  return { key: k };
}
