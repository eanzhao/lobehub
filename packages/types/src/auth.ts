export interface ClientSecretPayload {
  /**
   * Represents the user's API key
   *
   * If provider need multi keys like bedrock,
   * this will be used as the checker whether to use frontend key
   */
  apiKey?: string;
  /**
   * ComfyUI specific authentication fields
   */
  authType?: string;

  awsAccessKeyId?: string;

  awsRegion?: string;

  awsSecretAccessKey?: string;
  awsSessionToken?: string;
  azureApiVersion?: string;
  /**
   * Represents the endpoint of provider
   */
  baseURL?: string;

  bearerToken?: string;

  bearerTokenExpiresAt?: number;

  cloudflareBaseURLOrAccountID?: string;
  customHeaders?: Record<string, string>;
  nyxIdToken?: string;
  /**
   * GitHub Copilot OAuth fields
   */
  oauthAccessToken?: string;
  password?: string;

  /**
   * Aevatar-specific targeting metadata: identifier of the remote GAgent
   * (Actor) on the aevatar server. Sourced from the lobehub `agents`
   * row (`remote_agent_id`) when the agent has `remoteKind === 'aevatar'`,
   * and forwarded by the aevatar provider into the chat request body.
   */
  remoteAgentId?: string;

  runtimeProvider?: string;
  /**
   * user id
   * in client db mode it's a uuid
   * in server db mode it's a user id
   */
  userId?: string;
  username?: string;

  vertexAIRegion?: string;
}
