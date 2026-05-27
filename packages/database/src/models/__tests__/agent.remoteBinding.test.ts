// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-remote-binding-test-user';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('AgentModel — remote GAgent binding (issue #4)', () => {
  it('round-trips an aevatar-bound agent row through insert/select', async () => {
    const agentId = 'agent-remote-binding-1';
    const remoteEndpoint = 'https://aevatar.example.com/api/scopes/demo';
    const remoteAgentId = 'gagent-remote-42';

    await serverDB.insert(agents).values({
      id: agentId,
      remoteAgentId,
      remoteEndpoint,
      remoteKind: 'aevatar',
      title: 'Remote helper',
      userId,
    });

    const agentModel = new AgentModel(serverDB, userId);
    const result = await agentModel.getAgentConfigById(agentId);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(agentId);
    expect(result!.remoteKind).toBe('aevatar');
    expect(result!.remoteAgentId).toBe(remoteAgentId);
    expect(result!.remoteEndpoint).toBe(remoteEndpoint);
    expect(result!.title).toBe('Remote helper');
  });

  it('leaves remote fields null for ordinary local agents', async () => {
    const agentId = 'agent-local-1';

    await serverDB.insert(agents).values({
      id: agentId,
      systemRole: 'You are a friendly assistant.',
      title: 'Local helper',
      userId,
    });

    const agentModel = new AgentModel(serverDB, userId);
    const result = await agentModel.getAgentConfigById(agentId);

    expect(result).not.toBeNull();
    expect(result!.remoteKind).toBeNull();
    expect(result!.remoteAgentId).toBeNull();
    expect(result!.remoteEndpoint).toBeNull();
  });

  it('creates a remote-bound agent through AgentModel.create()', async () => {
    const agentModel = new AgentModel(serverDB, userId);

    const created = await agentModel.create({
      remoteAgentId: 'gagent-via-create',
      remoteEndpoint: 'https://aevatar.dev/api/scopes/main',
      remoteKind: 'aevatar',
      title: 'Created remote',
    });

    expect(created.remoteKind).toBe('aevatar');
    expect(created.remoteAgentId).toBe('gagent-via-create');
    expect(created.remoteEndpoint).toBe('https://aevatar.dev/api/scopes/main');

    // Confirm it is queryable back through the model
    const refetch = await agentModel.getAgentConfigById(created.id);
    expect(refetch?.remoteKind).toBe('aevatar');
    expect(refetch?.remoteAgentId).toBe('gagent-via-create');
  });
});
