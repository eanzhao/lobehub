'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { App, Input, Modal, Typography } from 'antd';
import { createStyles } from 'antd-style';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';

const useStyles = createStyles(({ css, token }) => ({
  field: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  fieldLabel: css`
    font-size: 13px;
    font-weight: 500;
    color: ${token.colorText};
  `,
  fieldHint: css`
    font-size: 12px;
    color: ${token.colorTextSecondary};
  `,
  helper: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${token.borderRadius}px;

    font-size: 12px;
    color: ${token.colorTextSecondary};

    background: ${token.colorFillSecondary};
  `,
}));

export interface ConnectAevatarAgentModalProps {
  groupId?: string;
  onClose: () => void;
  open: boolean;
}

/**
 * Issue #4: Connect Aevatar GAgent modal.
 *
 * Minimum-viable flow: the user provides the aevatar endpoint URL, the
 * remote GAgent id, and a display name. The dialog calls the standard
 * `agent.createAgent` mutation with the three `remote*` fields populated,
 * producing a new local agent row that is tagged as a remote binding. From
 * that point on, server-side chat routing dispatches messages for this
 * agent's topics to the remote Actor.
 *
 * Auto-discovery against the aevatar readmodel is deliberately out of
 * scope here — the spec ("D. Minimum viable: just a form with three text
 * inputs") explicitly prefers the manual form for now.
 */
const ConnectAevatarAgentModal = memo<ConnectAevatarAgentModalProps>(
  ({ open, onClose, groupId }) => {
    const { t } = useTranslation('chat');
    const { styles } = useStyles();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const storeCreateAgent = useAgentStore((s) => s.createAgent);
    const refreshAgentList = useHomeStore((s) => s.refreshAgentList);

    const [endpoint, setEndpoint] = useState('');
    const [remoteAgentId, setRemoteAgentId] = useState('');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
      if (open) {
        setEndpoint('');
        setRemoteAgentId('');
        setName('');
        setDescription('');
        setSubmitting(false);
      }
    }, [open]);

    const isValidUrl = useCallback((value: string): boolean => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, []);

    const handleConnect = useCallback(async () => {
      const trimmedEndpoint = endpoint.trim();
      const trimmedAgentId = remoteAgentId.trim();
      const trimmedName = name.trim();

      if (!trimmedEndpoint) {
        message.error(t('aevatarAgent.connect.endpointRequired'));
        return;
      }
      if (!isValidUrl(trimmedEndpoint)) {
        message.error(t('aevatarAgent.connect.invalidUrl'));
        return;
      }
      if (!trimmedAgentId) {
        message.error(t('aevatarAgent.connect.agentIdRequired'));
        return;
      }

      setSubmitting(true);
      try {
        const result = await storeCreateAgent({
          config: {
            description: description.trim() || undefined,
            // Force the provider so the server-side routing branch picks the
            // aevatar runtime without needing to special-case `remoteKind`
            // there. The actual baseURL+routing is still pulled from the
            // `remoteEndpoint` / `remoteAgentId` columns at call time.
            provider: 'aevatar',
            remoteAgentId: trimmedAgentId,
            remoteEndpoint: trimmedEndpoint,
            remoteKind: 'aevatar',
            title: trimmedName || trimmedAgentId,
          },
          groupId,
        });
        await refreshAgentList();
        onClose();
        navigate(`/agent/${result.agentId}`);
      } finally {
        setSubmitting(false);
      }
    }, [
      endpoint,
      remoteAgentId,
      name,
      description,
      groupId,
      storeCreateAgent,
      refreshAgentList,
      onClose,
      navigate,
      isValidUrl,
      message,
      t,
    ]);

    return (
      <Modal
        destroyOnClose
        open={open}
        title={t('aevatarAgent.connect.title')}
        width={520}
        footer={[
          <Button key="cancel" onClick={onClose}>
            {t('aevatarAgent.connect.cancel')}
          </Button>,
          <Button
            disabled={!endpoint.trim() || !remoteAgentId.trim()}
            key="connect"
            loading={submitting}
            type="primary"
            onClick={() => void handleConnect()}
          >
            {submitting ? t('aevatarAgent.connect.connecting') : t('aevatarAgent.connect.connect')}
          </Button>,
        ]}
        onCancel={onClose}
      >
        <Flexbox gap={16} paddingBlock={'12px 4px'}>
          <Typography.Text className={styles.helper}>
            {t('aevatarAgent.connect.helper')}
          </Typography.Text>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="aevatar-endpoint">
              {t('aevatarAgent.connect.endpoint')}
            </label>
            <Input
              id="aevatar-endpoint"
              placeholder={t('aevatarAgent.connect.endpointPlaceholder')}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
            <span className={styles.fieldHint}>{t('aevatarAgent.connect.endpointHint')}</span>
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="aevatar-agent-id">
              {t('aevatarAgent.connect.agentId')}
            </label>
            <Input
              id="aevatar-agent-id"
              placeholder={t('aevatarAgent.connect.agentIdPlaceholder')}
              value={remoteAgentId}
              onChange={(e) => setRemoteAgentId(e.target.value)}
            />
            <span className={styles.fieldHint}>{t('aevatarAgent.connect.agentIdHint')}</span>
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="aevatar-name">
              {t('aevatarAgent.connect.name')}
            </label>
            <Input
              id="aevatar-name"
              maxLength={60}
              placeholder={t('aevatarAgent.connect.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="aevatar-description">
              {t('aevatarAgent.connect.description')}
            </label>
            <Input.TextArea
              autoSize={{ maxRows: 4, minRows: 2 }}
              id="aevatar-description"
              maxLength={200}
              placeholder={t('aevatarAgent.connect.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </Flexbox>
      </Modal>
    );
  },
);

ConnectAevatarAgentModal.displayName = 'ConnectAevatarAgentModal';

export default ConnectAevatarAgentModal;
