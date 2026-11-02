import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appCredentialFor,
  VAULT_RECORD_ID,
  vaultEnvironmentOfBaseUrl,
  vaultSelectionError,
  vaultSettingsFor,
} from '../ui/vault-credentials.mjs';

const record = { id: 'rec-abcdef123456', label: '希音应用', appId: 'APP-1', environment: 'production' };

test('vault environment follows the SHEIN production and test hosts', () => {
  assert.equal(vaultEnvironmentOfBaseUrl('https://openapi.sheincorp.cn'), 'production');
  assert.equal(vaultEnvironmentOfBaseUrl('https://openapi.sheincorp.com'), 'production');
  assert.equal(vaultEnvironmentOfBaseUrl('https://openapi-test01.sheincorp.cn'), 'sandbox');
  assert.equal(vaultEnvironmentOfBaseUrl('https://test.example.com'), 'sandbox');
  assert.equal(vaultEnvironmentOfBaseUrl('invalid'), 'production');
});

test('vault records must match the selected environment', () => {
  assert.equal(vaultSelectionError(record, 'https://openapi.sheincorp.cn'), '');
  assert.match(vaultSelectionError({ ...record, environment: 'sandbox' }, 'https://openapi.sheincorp.cn'), /环境/);
  assert.match(vaultSelectionError({ ...record, id: 'bad' }, 'https://openapi.sheincorp.cn'), /选择一条凭证/);
});

test('vault settings pin the record, label, appId and environment', () => {
  assert.equal(VAULT_RECORD_ID.test(record.id), true);
  const settings = vaultSettingsFor({ baseUrl: 'https://openapi.sheincorp.cn', credentialSource: 'manual' }, record);
  assert.equal(settings.credentialSource, 'vault');
  assert.equal(settings.credentialRecordId, record.id);
  assert.equal(settings.credentialRecordLabel, '希音应用');
  assert.equal(settings.credentialRecordAppId, 'APP-1');
  assert.equal(settings.credentialRecordEnvironment, 'production');
  assert.equal(settings.appId, 'APP-1');
  assert.throws(() => vaultSettingsFor({ baseUrl: 'https://openapi-test01.sheincorp.cn' }, record), /环境/);
});

test('app identity signatures use the record in vault mode and the private slot in manual mode', () => {
  assert.deepEqual(appCredentialFor({ credentialSource: 'vault', credentialRecordId: record.id }, 'manual'), { record: record.id });
  assert.equal(appCredentialFor({ credentialSource: 'manual', credentialRecordId: record.id }, 'manual'), 'manual');
  assert.equal(appCredentialFor({ credentialSource: 'vault', credentialRecordId: 'bad' }, 'manual'), 'manual');
});
