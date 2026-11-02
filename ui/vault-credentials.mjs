export const VAULT_RECORD_ID = /^rec-[a-f0-9]{12}$/;

export function vaultEnvironmentOfBaseUrl(baseUrl) {
  let host = '';
  try { host = new URL(String(baseUrl ?? '')).hostname.toLowerCase(); } catch {}
  return host.includes('openapi-test') || /(?:^|[.-])(?:test|sandbox)(?:[.-]|$)/.test(host) ? 'sandbox' : 'production';
}

export function vaultSelectionError(record, baseUrl) {
  if (!record || !VAULT_RECORD_ID.test(String(record.id ?? ''))) return '请选择一条凭证。';
  const expected = vaultEnvironmentOfBaseUrl(baseUrl);
  if (record.environment !== expected) return '这条凭证的环境与希音接口不一致，请重新选择。';
  return '';
}

export function appCredentialFor(settings, manualCredential) {
  return settings?.credentialSource === 'vault' && VAULT_RECORD_ID.test(String(settings.credentialRecordId ?? ''))
    ? { record: settings.credentialRecordId }
    : manualCredential;
}

export function vaultSettingsFor(settings, access) {
  const error = vaultSelectionError(access, settings?.baseUrl);
  if (error) throw new Error(error);
  return {
    ...settings,
    credentialSource: 'vault',
    credentialRecordId: access.id,
    credentialRecordLabel: access.label,
    credentialRecordAppId: access.appId,
    credentialRecordEnvironment: access.environment,
    appId: access.appId,
  };
}
