import { builtinTools } from '@lobechat/builtin-tools';
import { ToolArgumentsRepairer, ToolNameResolver } from '@lobechat/context-engine';
import {
  type ChatToolPayload,
  type MessageToolCall,
  type ToolExecutor,
  type ToolManifest,
  type ToolSource,
} from '@lobechat/types';

import { type ChatStore } from '@/store/chat/store';
import { useToolStore } from '@/store/tool';
import {
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { type StoreSetter } from '@/store/types';

/**
 * Internal utility methods and runtime state management
 * These are building blocks used by other actions
 */

type Setter = StoreSetter<ChatStore>;
export const pluginInternals = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new PluginInternalsActionImpl(set, get, _api);

export class PluginInternalsActionImpl {
  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
    void get;
  }

  internal_transformToolCalls = (
    toolCalls: MessageToolCall[],
    offeredToolNames?: string[],
  ): ChatToolPayload[] => {
    const toolNameResolver = new ToolNameResolver();

    // Build manifests map from tool store
    const toolStoreState = useToolStore.getState();
    const manifests: Record<string, ToolManifest> = {};

    // Track source for each identifier
    const sourceMap: Record<string, 'builtin' | 'mcp' | 'klavis' | 'lobehubSkill'> = {};

    // Get all installed plugins (all treated as MCP now)
    const installedPlugins = pluginSelectors.installedPlugins(toolStoreState);
    for (const plugin of installedPlugins) {
      if (plugin.manifest) {
        manifests[plugin.identifier] = plugin.manifest as ToolManifest;
        sourceMap[plugin.identifier] = 'mcp';
      }
    }

    // Get all builtin tools
    for (const tool of builtinTools) {
      if (tool.manifest) {
        manifests[tool.identifier] = tool.manifest as ToolManifest;
        sourceMap[tool.identifier] = 'builtin';
      }
    }

    // Get all Klavis tools
    const klavisTools = klavisStoreSelectors.klavisAsLobeTools(toolStoreState);
    for (const tool of klavisTools) {
      if (tool.manifest) {
        manifests[tool.identifier] = tool.manifest as ToolManifest;
        sourceMap[tool.identifier] = 'klavis';
      }
    }

    // Get all LobeHub Skill tools
    const lobehubSkillTools = lobehubSkillStoreSelectors.lobehubSkillAsLobeTools(toolStoreState);
    for (const tool of lobehubSkillTools) {
      if (tool.manifest) {
        manifests[tool.identifier] = tool.manifest as ToolManifest;
        sourceMap[tool.identifier] = 'lobehubSkill';
      }
    }

    // Preserve `source` / `executor` from the streaming chunk if the upstream
    // codec already stamped them (e.g. aevatar GAgent emits `source: 'aevatar'`,
    // `executor: 'server'`). These fields are not part of the formal
    // `MessageToolCall` type but ride along on the runtime object; without this
    // map the resolver below strips them. Indexed by tool-call id so the resolved
    // payloads can recover the original tags after name resolution.
    const incomingTagsById: Record<
      string,
      { executor?: ToolExecutor; source?: ToolSource } | undefined
    > = {};
    for (const tc of toolCalls) {
      // The streamed chunk may carry codec-stamped fields not declared on the
      // `MessageToolCall` type. Read defensively via a structural cast.
      const tagged = tc as MessageToolCall & {
        executor?: ToolExecutor;
        source?: ToolSource;
      };
      if (tagged.source !== undefined || tagged.executor !== undefined) {
        incomingTagsById[tc.id] = {
          executor: tagged.executor,
          source: tagged.source,
        };
      }
    }

    // Resolve tool calls and add source field
    const resolved = toolNameResolver.resolve(toolCalls, manifests, offeredToolNames);

    return resolved.map((payload) => {
      // Parse and repair arguments if needed
      const manifest = manifests[payload.identifier];
      const repairer = new ToolArgumentsRepairer(manifest);
      const repairedArgs = repairer.parse(payload.apiName, payload.arguments);

      const incomingTags = incomingTagsById[payload.id];

      // Source resolution priority:
      //   1. Tag already stamped on the streamed chunk (e.g. codec set 'aevatar').
      //   2. Local sourceMap built from installed plugins / builtin tools / etc.
      // This keeps codec-provided tags from being silently overwritten by the
      // local lookup (which doesn't know about server-executed tools like aevatar).
      const source = incomingTags?.source ?? sourceMap[payload.identifier];

      // Forward `executor` whenever the chunk carried it. Omitted means the
      // payload stays in its default (client-dispatch) state.
      const executor = incomingTags?.executor;

      return {
        ...payload,
        arguments: JSON.stringify(repairedArgs),
        ...(executor !== undefined && { executor }),
        ...(source !== undefined && { source }),
      };
    });
  };
}

export type PluginInternalsAction = Pick<
  PluginInternalsActionImpl,
  keyof PluginInternalsActionImpl
>;
