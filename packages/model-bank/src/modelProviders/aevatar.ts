import type { ModelProviderCard } from '@/types/llm';

const Aevatar: ModelProviderCard = {
  chatModels: [],
  checkModel: 'aevatar-chat',
  description:
    'Aevatar routes model requests into scoped GAgent and workflow runtimes, streaming AGUI events over SSE.',
  enabled: true,
  id: 'aevatar',
  name: 'Aevatar',
  settings: {
    defaultShowBrowserRequest: true,
    disableBrowserRequest: false,
    proxyUrl: {
      placeholder: 'https://aevatar.example.com/api/scopes/<scope-id>',
      title: 'Scope Base URL',
    },
    showApiKey: false,
  },
  url: 'https://github.com/aelf-project/aevatar',
};

export default Aevatar;
