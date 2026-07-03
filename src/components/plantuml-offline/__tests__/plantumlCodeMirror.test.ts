import { describe, it, expect } from 'vitest';
import { plantumlLanguageSupport } from '../plantumlCodeMirror';

describe('plantumlCodeMirror', () => {
  it('exports a LanguageSupport instance', () => {
    const support = plantumlLanguageSupport();
    expect(support.language.name).toBe('plantuml');
  });
});
