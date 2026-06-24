import { describe, expect, it } from 'vitest';

import {
  SHOW_PLANTUML_BACKEND_SWITCH,
  effectivePlantUmlBackend,
  plantUmlBackendForBuild,
} from '../buildFlags';

describe('buildFlags', () => {
  it('SHOW_PLANTUML_BACKEND_SWITCH mirrors DEV', () => {
    expect(SHOW_PLANTUML_BACKEND_SWITCH).toBe(import.meta.env.DEV);
  });

  describe('plantUmlBackendForBuild', () => {
    it('production build forces jar even when store has rust', () => {
      expect(plantUmlBackendForBuild('rust', true)).toBe('jar');
      expect(plantUmlBackendForBuild('jar', true)).toBe('jar');
    });

    it('non-production build respects user choice', () => {
      expect(plantUmlBackendForBuild('rust', false)).toBe('rust');
      expect(plantUmlBackendForBuild('jar', false)).toBe('jar');
    });
  });

  describe('effectivePlantUmlBackend (vitest runs as DEV)', () => {
    it('passes through rust in dev', () => {
      expect(import.meta.env.PROD).toBe(false);
      expect(effectivePlantUmlBackend('rust')).toBe('rust');
    });

    it('passes through jar', () => {
      expect(effectivePlantUmlBackend('jar')).toBe('jar');
    });
  });
});
