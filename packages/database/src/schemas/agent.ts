import type {
  LobeAgentAgencyConfig,
  LobeAgentChatConfig,
  LobeAgentTTSConfig,
} from '@lobechat/types';
import { AgentChatConfigSchema } from '@lobechat/types';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

import { idGenerator, randomSlug } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { files, knowledgeBases } from './file';
import { sessionGroups } from './session';
import { users } from './user';

// Agent table is the main table for storing agents
// agent is a model that represents the assistant that is created by the user
// agent can have its own knowledge base and files

export const agents = pgTable(
  'agents',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('agents'))
      .notNull(),
    slug: varchar('slug', { length: 100 }).$defaultFn(() => randomSlug(3)),
    title: varchar('title', { length: 255 }),
    description: varchar('description', { length: 1000 }),
    tags: jsonb('tags').$type<string[]>().default([]),
    editorData: jsonb('editor_data'),
    avatar: text('avatar'),
    backgroundColor: text('background_color'),
    marketIdentifier: text('market_identifier'),

    plugins: jsonb('plugins').$type<string[]>(),

    clientId: text('client_id'),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    agencyConfig: jsonb('agency_config').$type<LobeAgentAgencyConfig>(),
    chatConfig: jsonb('chat_config').$type<LobeAgentChatConfig>(),

    fewShots: jsonb('few_shots'),
    model: text('model'),
    params: jsonb('params').default({}),
    provider: text('provider'),
    systemRole: text('system_role'),
    tts: jsonb('tts').$type<LobeAgentTTSConfig>(),

    virtual: boolean('virtual').default(false),
    pinned: boolean('pinned'),

    openingMessage: text('opening_message'),
    openingQuestions: text('opening_questions').array().default([]),

    sessionGroupId: text('session_group_id').references(() => sessionGroups.id, {
      onDelete: 'set null',
    }),

    /**
     * Tags this agent row as a remote binding to an externally-hosted Actor.
     *
     * - `null` (default) — local agent, owned by lobehub. `systemRole`, `chatConfig`,
     *   `model`, `provider`, plugins, knowledge etc. are authoritative and edited
     *   in the lobehub agent settings UI.
     * - `'aevatar'` — agent is bound to a remote aevatar GAgent. State/lifecycle/
     *   message handling live on the aevatar server; the local `systemRole`,
     *   `chatConfig`, `model`, `provider` columns become **read-only hints** that
     *   describe the binding for display but do not drive the runtime (the
     *   remote GAgent's own configuration wins).
     *
     * Server-side chat routing inspects this column: if it is `'aevatar'`, the
     * request is dispatched to the aevatar provider with `remoteAgentId` and
     * `remoteEndpoint` as targeting metadata instead of using the local
     * provider/model/systemRole.
     */
    remoteKind: text('remote_kind').$type<'aevatar'>(),

    /**
     * Opaque identifier of the remote GAgent (Actor) on the aevatar server.
     *
     * Meaningful only when `remoteKind === 'aevatar'`. Stored as the GAgent
     * id returned by the aevatar readmodel listing endpoint; passed as
     * targeting metadata to the aevatar provider so the server can route the
     * chat invocation to the correct Actor.
     */
    remoteAgentId: text('remote_agent_id'),

    /**
     * Base URL of the aevatar deployment that hosts the bound GAgent.
     *
     * Per-agent (rather than per-user) because a single user may have agents
     * bound to multiple aevatar deployments — e.g. one dev server and one
     * production cluster. When `remoteKind === 'aevatar'`, this value
     * overrides any provider-level baseURL configuration for this agent's
     * chat requests.
     *
     * Format: schema + host + optional scope path, e.g.
     * `https://aevatar.example/api/scopes/default`. The aevatar provider
     * appends `/invoke/chat:stream` when constructing the request endpoint.
     */
    remoteEndpoint: text('remote_endpoint'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('client_id_user_id_unique').on(t.clientId, t.userId),
    uniqueIndex('agents_slug_user_id_unique').on(t.slug, t.userId),
    index('agents_user_id_idx').on(t.userId),
    index('agents_title_idx').on(t.title),
    index('agents_description_idx').on(t.description),
    index('agents_session_group_id_idx').on(t.sessionGroupId),
  ],
);

/** @deprecated Use CreateAgentSchema from @lobechat/types instead */
export const insertAgentSchema = createInsertSchema(agents, {
  agencyConfig: z.custom<LobeAgentAgencyConfig>().nullable().optional(),
  // Override chatConfig type to use the proper schema
  chatConfig: AgentChatConfigSchema.nullable().optional(),
  // Narrow `remoteKind` from the default `z.string()` to the literal union
  // that matches the `$type<'aevatar'>()` annotation on the column. Keeps
  // downstream Partial<NewAgent> consumers happy with the typed enum.
  remoteKind: z.literal('aevatar').nullable().optional(),
});

export type NewAgent = typeof agents.$inferInsert;
export type AgentItem = typeof agents.$inferSelect;

export const agentsKnowledgeBases = pgTable(
  'agents_knowledge_bases',
  {
    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    knowledgeBaseId: text('knowledge_base_id')
      .references(() => knowledgeBases.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    enabled: boolean('enabled').default(true),

    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.knowledgeBaseId] }),
    index('agents_knowledge_bases_agent_id_idx').on(t.agentId),
    index('agents_knowledge_bases_knowledge_base_id_idx').on(t.knowledgeBaseId),
    index('agents_knowledge_bases_user_id_idx').on(t.userId),
  ],
);

export const agentsFiles = pgTable(
  'agents_files',
  {
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').default(true),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.fileId, t.agentId, t.userId] }),
    index('agents_files_agent_id_idx').on(t.agentId),
    index('agents_files_file_id_idx').on(t.fileId),
    index('agents_files_user_id_idx').on(t.userId),
  ],
);
