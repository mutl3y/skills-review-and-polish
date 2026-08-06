/**
 * Shared provider-key accept-list validation.
 *
 * Single source of truth for which key formats each provider accepts. Both the
 * VS Code extension (`src/extension.ts`) and the MCP server
 * (`src/mcp/server.ts`) MUST use this — duplicating it in two places is how
 * the two doors diverge (e.g. one validates and the other doesn't, sending a
 * credential to the wrong provider).
 *
 * This is an ACCEPT list (not a reject list): a key is only sent to a provider
 * when it matches that provider's accepted shape. As providers are added, you
 * add one entry here — you never write bespoke "reject this format" logic at
 * each call site.
 *
 * Returns an error message when the key is not acceptable for the provider,
 * or null when it is safe to send.
 */
export function validateKeyForProvider(
  provider: 'openrouter' | 'copilot',
  key: string | undefined,
): string | null {
  if (!key || key.trim() === '') {
    return `provider "${provider}" requires an API key.`;
  }
  const trimmed = key.trim();
  switch (provider) {
    case 'openrouter':
      // OpenRouter keys are sk-or-v1-... — never send a GitHub/Copilot token
      // to openrouter.ai.
      if (!/^sk-or-v1-/.test(trimmed)) {
        return `provider "openrouter" requires an OpenRouter key (sk-or-v1-...).`;
      }
      return null;
    case 'copilot':
      // Copilot uses a GitHub token against api.githubcopilot.com — never send
      // an OpenRouter key there.
      if (/^sk-or-v1-/.test(trimmed)) {
        return `provider "copilot" requires a GitHub token, not an OpenRouter key (sk-or-v1-...).`;
      }
      return null;
    default:
      return `unknown provider "${provider}"`;
  }
}
