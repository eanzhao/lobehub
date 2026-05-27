import type { AIChatModelCard } from '../types/aiModel';

const aevatarChatModels: AIChatModelCard[] = [
  {
    description: 'Default scoped chat route backed by aevatar ChatStreamAsync.',
    displayName: 'Aevatar Chat',
    enabled: true,
    id: 'aevatar-chat',
    type: 'chat',
  },
  {
    description: 'Placeholder GAgent-backed chat route for scoped actor binding.',
    displayName: 'Aevatar GAgent',
    id: 'aevatar-gagent',
    type: 'chat',
  },
];

export default aevatarChatModels;
