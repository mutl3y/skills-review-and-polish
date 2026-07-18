# Technical Spike: Playwright Copilot Login via Browser State Replay

## Status: RESEARCHED — Implementation Ready

## Problem

Playwright E2E tests can't authenticate with GitHub Copilot because the VS Code web
ext host requires interactive OAuth login. Every test session needs fresh authentication.

## Solution: Browser State Replay

Instead of automating the OAuth flow, replay the browser state from a one-time manual login.

### How It Works

VS Code Server (web) stores all secrets encrypted in browser localStorage using
`ServerKeyedAESCrypto`. The encryption key is derived from two halves:
- **Client half**: 32-byte random value stored in HttpOnly cookie `vscode-cli-secret-half`
- **Server half**: Derived via `SHA-256(server_secret + client_half)`

The mint-proxy in `/opt/mint-proxy.js` mints this key and sets the cookies. Once
the browser has both cookies + localStorage, all extension secrets (including
Copilot OAuth tokens) are decryptable.

### Implementation Steps

1. **Capture**: After manual login via HTTPS, export cookies + localStorage
2. **Store**: Save to `tests/e2e/auth-state/` (gitignored)
3. **Load**: Playwright test setup loads cookies + localStorage before tests
4. **Refresh**: If tokens expire, re-login once and re-export

### What to Capture

```bash
# From browser DevTools after login:
# 1. Cookies:
#    - vscode-cli-secret-half (HttpOnly, base64url, 32 bytes)
#    - vscode-secret-key-path (mint endpoint URL)
#    - vscode-session (session cookie)
#
# 2. localStorage keys:
#    - vscode-workbench (contains encrypted secrets blob)
#    - All vscode-* prefixed keys
```

### Files to Create

- `tests/e2e/auth-state/cookies.json` — exported cookies
- `tests/e2e/auth-state/localStorage.json` — exported localStorage
- `tests/e2e/setup.ts` — Playwright globalSetup that loads auth state
- `tests/e2e/helpers.ts` — shared helper to inject auth state

### Security Notes

- `auth-state/` must be in `.gitignore` — contains encrypted session data
- Tokens are encrypted (AES-GCM) so not plaintext, but still sensitive
- Tokens expire — refresh every few weeks
- Each developer exports their own auth state

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Tokens expire mid-test | Medium | Test failure | Re-export monthly |
| localStorage format changes | Low | Test failure | Pin VS Code Server version |
| Mint-proxy key derivation changes | Very Low | All tests break | Pin container image tag |

## Decision: GO

This approach avoids OAuth automation complexity while enabling real Copilot testing.
The one-time manual login is a reasonable trade-off for test reliability.
