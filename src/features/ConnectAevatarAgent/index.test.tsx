import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as Antd from 'antd';
import type * as ReactI18next from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ConnectAevatarAgentModal from './index';

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  errorToast: vi.fn(),
  navigate: vi.fn(),
  onClose: vi.fn(),
  refreshAgentList: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

// Stub react-i18next so test queries don't depend on the global i18n setup's
// keySeparator behaviour (the runtime has keySeparator:false, but the test
// setup uses i18next defaults, which interpret dots as nested keys).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof ReactI18next>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      i18n: { changeLanguage: vi.fn(), language: 'en-US' },
      t: (key: string) => key,
    }),
  };
});

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: { createAgent: typeof mocks.createAgent }) => unknown) =>
    selector({ createAgent: mocks.createAgent }),
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (
    selector: (state: { refreshAgentList: typeof mocks.refreshAgentList }) => unknown,
  ) => selector({ refreshAgentList: mocks.refreshAgentList }),
}));

// Stub antd App.useApp so message.error works without an <App> wrapper.
// vi.mock is used here because @testing-library cannot bootstrap antd's App
// context provider in a unit test without significant wiring.
vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof Antd>('antd');
  return {
    ...actual,
    App: {
      ...actual.App,
      useApp: () => ({
        message: { error: mocks.errorToast, success: vi.fn(), warning: vi.fn() },
        modal: actual.Modal,
        notification: { open: vi.fn() },
      }),
    },
  };
});

describe('ConnectAevatarAgentModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAgent.mockResolvedValue({ agentId: 'agent-new-aevatar' });
  });

  afterEach(() => {
    cleanup();
  });

  it('submits createAgent with remote binding fields when the form is valid', async () => {
    render(<ConnectAevatarAgentModal open={true} onClose={mocks.onClose} />);

    fireEvent.change(document.getElementById('aevatar-endpoint') as HTMLInputElement, {
      target: { value: 'https://aevatar.example.com/api/scopes/demo' },
    });
    fireEvent.change(document.getElementById('aevatar-agent-id') as HTMLInputElement, {
      target: { value: 'gagent-form-99' },
    });
    fireEvent.change(document.getElementById('aevatar-name') as HTMLInputElement, {
      target: { value: 'My Friend' },
    });

    fireEvent.click(screen.getByText('aevatarAgent.connect.connect'));

    await waitFor(() => {
      expect(mocks.createAgent).toHaveBeenCalledTimes(1);
    });

    expect(mocks.createAgent).toHaveBeenCalledWith({
      config: expect.objectContaining({
        provider: 'aevatar',
        remoteAgentId: 'gagent-form-99',
        remoteEndpoint: 'https://aevatar.example.com/api/scopes/demo',
        remoteKind: 'aevatar',
        title: 'My Friend',
      }),
      groupId: undefined,
    });

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/agent/agent-new-aevatar');
    });
    expect(mocks.onClose).toHaveBeenCalled();
    expect(mocks.refreshAgentList).toHaveBeenCalled();
  });

  it('shows a validation error when the endpoint URL is not absolute http(s)', async () => {
    render(<ConnectAevatarAgentModal open={true} onClose={mocks.onClose} />);

    fireEvent.change(document.getElementById('aevatar-endpoint') as HTMLInputElement, {
      target: { value: 'not-a-url' },
    });
    fireEvent.change(document.getElementById('aevatar-agent-id') as HTMLInputElement, {
      target: { value: 'gagent-form-99' },
    });

    fireEvent.click(screen.getByText('aevatarAgent.connect.connect'));

    await waitFor(() => {
      expect(mocks.errorToast).toHaveBeenCalledWith('aevatarAgent.connect.invalidUrl');
    });
    expect(mocks.createAgent).not.toHaveBeenCalled();
  });
});
