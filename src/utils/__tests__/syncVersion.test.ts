// @ts-nocheck
import { describe, expect, it } from 'vitest';
import {
  applyVersionToCargoToml,
  applyVersionToTauriConf,
  isValidAppVersion,
} from '../../../scripts/sync-version.mjs';

describe('isValidAppVersion', () => {
  it('接受三段 semver', () => {
    expect(isValidAppVersion('0.2.0')).toBe(true);
  });
  it('拒绝 prerelease', () => {
    expect(isValidAppVersion('0.2.0-beta')).toBe(false);
  });
});

describe('applyVersionToCargoToml', () => {
  it('仅替换 [package] 段 version', () => {
    const input = `[package]
name = "notez"
version = "0.1.0"

[dependencies]
serde = { version = "1", features = ["derive"] }
`;
    const out = applyVersionToCargoToml(input, '0.2.0');
    expect(out).toContain('version = "0.2.0"');
    expect(out).toContain('serde = { version = "1"');
  });
});

describe('applyVersionToTauriConf', () => {
  it('替换顶层 version 字段', () => {
    const conf = { version: '0.1.0', productName: 'notez' };
    expect(applyVersionToTauriConf(conf, '0.2.0').version).toBe('0.2.0');
  });
});
