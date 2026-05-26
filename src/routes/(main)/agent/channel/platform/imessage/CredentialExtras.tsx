'use client';

import { isDesktop } from '@lobechat/const';
import type { ImessageBridgePublicConfig } from '@lobechat/electron-client-ipc';
import { Flexbox, FormGroup, FormItem, Tag, Text } from '@lobehub/ui';
import { App, Button, Form as AntdForm, Switch } from 'antd';
import { RefreshCw, Save, TestTube2 } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { imessageBridgeService } from '@/services/electron/imessageBridge';

interface BridgeFormState {
  blueBubblesPassword: string;
  blueBubblesServerUrl: string;
  enabled: boolean;
}

const DEFAULT_BRIDGE_FORM: BridgeFormState = {
  blueBubblesPassword: '',
  blueBubblesServerUrl: '',
  enabled: true,
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const CredentialExtras = memo(() => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;
  const { message } = App.useApp();
  const form = AntdForm.useFormInstance();
  const applicationId = AntdForm.useWatch('applicationId', form) as string | undefined;
  const webhookSecret = AntdForm.useWatch(['credentials', 'webhookSecret'], form) as
    | string
    | undefined;

  const [bridgeForm, setBridgeForm] = useState<BridgeFormState>(DEFAULT_BRIDGE_FORM);
  const [loading, setLoading] = useState(false);
  const [passwordSet, setPasswordSet] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverUrl, setServerUrl] = useState<string>();
  const [testing, setTesting] = useState(false);

  const fillDesktopDeviceId = useCallback(async () => {
    const deviceInfo = await gatewayConnectionService.getDeviceInfo();
    form.setFieldValue(['credentials', 'desktopDeviceId'], deviceInfo.deviceId);
    void form.validateFields([['credentials', 'desktopDeviceId']]).catch(() => undefined);
  }, [form]);

  const refreshStatus = useCallback(async () => {
    if (!isDesktop) return;

    setLoading(true);
    try {
      await fillDesktopDeviceId();
      const status = await imessageBridgeService.getStatus();
      const savedConfig = status.configs.find(
        (config: ImessageBridgePublicConfig) => config.applicationId === applicationId?.trim(),
      );

      setBridgeForm(
        savedConfig
          ? {
              blueBubblesPassword: '',
              blueBubblesServerUrl: savedConfig.blueBubblesServerUrl,
              enabled: savedConfig.enabled,
            }
          : DEFAULT_BRIDGE_FORM,
      );
      setPasswordSet(Boolean(savedConfig?.blueBubblesPasswordSet));
      setRunning(status.running);
      setServerUrl(status.serverUrl);
    } catch (error) {
      message.error(`${t('channel.imessage.bridgeRefreshFailed')}: ${getErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, [applicationId, fillDesktopDeviceId, message, t]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  if (!isDesktop) return null;

  const getBridgeConfig = () => {
    const appId = applicationId?.trim();
    const secret = webhookSecret?.trim();
    const blueBubblesServerUrl = bridgeForm.blueBubblesServerUrl.trim();
    const blueBubblesPassword = bridgeForm.blueBubblesPassword.trim();

    if (!appId) {
      message.warning(t('channel.imessage.bridgeMissingApplicationId'));
      return;
    }
    if (!secret) {
      message.warning(t('channel.imessage.bridgeMissingWebhookSecret'));
      return;
    }
    if (!blueBubblesServerUrl) {
      message.warning(t('channel.imessage.bridgeMissingServerUrl'));
      return;
    }
    if (!blueBubblesPassword && !passwordSet) {
      message.warning(t('channel.imessage.bridgeMissingPassword'));
      return;
    }

    return {
      applicationId: appId,
      blueBubblesPassword: blueBubblesPassword || undefined,
      blueBubblesServerUrl,
      enabled: bridgeForm.enabled,
      webhookSecret: secret,
    };
  };

  const handleSave = async () => {
    const config = getBridgeConfig();
    if (!config) return;

    setSaving(true);
    try {
      await fillDesktopDeviceId();
      await imessageBridgeService.upsertConfig(config);
      message.success(t('channel.imessage.bridgeSaved'));
      await refreshStatus();
    } catch (error) {
      message.error(`${t('channel.imessage.bridgeSaveFailed')}: ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const config = getBridgeConfig();
    if (!config) return;

    setTesting(true);
    try {
      await imessageBridgeService.testConfig(config);
      message.success(t('channel.imessage.bridgeTestSuccess'));
    } catch (error) {
      message.error(`${t('channel.imessage.bridgeTestFailed')}: ${getErrorMessage(error)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <FormGroup
      style={{ marginBlockStart: 16 }}
      title={t('channel.imessage.desktopBridge')}
      variant="borderless"
      extra={
        <Button
          icon={<RefreshCw size={14} />}
          loading={loading}
          size="small"
          type="text"
          onClick={refreshStatus}
        >
          {t('channel.imessage.bridgeRefresh')}
        </Button>
      }
    >
      <FormItem
        desc={t('channel.imessage.blueBubblesServerUrlHint')}
        label={t('channel.imessage.blueBubblesServerUrl')}
        minWidth={'max(50%, 400px)'}
        variant="borderless"
      >
        <FormInput
          placeholder="http://127.0.0.1:1234"
          value={bridgeForm.blueBubblesServerUrl}
          onChange={(value) =>
            setBridgeForm((previous) => ({ ...previous, blueBubblesServerUrl: value }))
          }
        />
      </FormItem>
      <FormItem
        divider
        desc={t('channel.imessage.blueBubblesPasswordHint')}
        label={t('channel.imessage.blueBubblesPassword')}
        minWidth={'max(50%, 400px)'}
        variant="borderless"
      >
        <FormPassword
          autoComplete="new-password"
          placeholder={passwordSet ? t('channel.imessage.bridgePasswordSavedPlaceholder') : ''}
          value={bridgeForm.blueBubblesPassword}
          onChange={(value) =>
            setBridgeForm((previous) => ({ ...previous, blueBubblesPassword: value }))
          }
        />
      </FormItem>
      <FormItem
        divider
        desc={t('channel.imessage.bridgeEnabledHint')}
        label={t('channel.imessage.bridgeEnabled')}
        minWidth={'max(50%, 400px)'}
        variant="borderless"
      >
        <Switch
          checked={bridgeForm.enabled}
          onChange={(enabled) => setBridgeForm((previous) => ({ ...previous, enabled }))}
        />
      </FormItem>
      <Flexbox horizontal align="center" gap={8} style={{ marginBlockStart: 8 }}>
        <Tag color={running ? 'green' : 'default'}>
          {running ? t('channel.imessage.bridgeRunning') : t('channel.imessage.bridgeStopped')}
        </Tag>
        {serverUrl && (
          <Text fontSize={12} type="secondary">
            {serverUrl}
          </Text>
        )}
      </Flexbox>
      <Flexbox horizontal gap={8} style={{ marginBlockStart: 12 }}>
        <Button icon={<TestTube2 size={14} />} loading={testing} onClick={handleTest}>
          {t('channel.imessage.bridgeTest')}
        </Button>
        <Button icon={<Save size={14} />} loading={saving} type="primary" onClick={handleSave}>
          {t('channel.imessage.bridgeSave')}
        </Button>
      </Flexbox>
    </FormGroup>
  );
});

export default CredentialExtras;
