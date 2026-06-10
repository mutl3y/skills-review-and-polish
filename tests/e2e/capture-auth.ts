/**
 * Capture browser auth state from the current VS Code web session.
 *
 * Run this manually ONCE after logging into Copilot via the ext host:
 *   node --loader ts-node/esm tests/e2e/capture-auth.ts
 *
 * Or capture from browser DevTools:
 *   1. Open Application → Cookies → localhost
 *   2. Copy vscode-cli-secret-half and vscode-secret-key-path
 *   3. Open Application → Local Storage → localhost
 *   4. Copy all vscode-* keys
 *   5. Paste into tests/e2e/auth-state/cookies.json and localStorage.json
 *
 * The captured state is encrypted (AES-GCM via ServerKeyedAESCrypto) so it's
 * safe to commit — but prefer .gitignore for extra caution.
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const AUTH_DIR = join(__dirname, 'auth-state');

export interface CapturedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface AuthState {
  cookies: CapturedCookie[];
  localStorage: Record<string, string>;
  capturedAt: string;
}

/**
 * Generate a template auth-state file that the developer fills in manually
 * after their first successful login via the ext host HTTPS endpoint.
 */
export function generateAuthTemplate(): void {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }

  const template: AuthState = {
    cookies: [
      {
        name: 'vscode-cli-secret-half',
        value: '<PASTE_BASE64URL_COOKIE_VALUE_HERE>',
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
      {
        name: 'vscode-secret-key-path',
        value: '/_vscode-server/mint-key',
        domain: 'localhost',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Strict',
      },
    ],
    localStorage: {
      vscode_workbench: '<PASTE_LOCALSTORAGE_VALUE_HERE>',
    },
    capturedAt: new Date().toISOString(),
  };

  const outPath = join(AUTH_DIR, 'auth-state.json');
  writeFileSync(outPath, JSON.stringify(template, null, 2), 'utf8');
  console.log(`Auth state template written to: ${outPath}`);
  console.log('');
  console.log('To populate:');
  console.log('1. Open the VS Code ext host in your browser');
  console.log('2. Log into Copilot (check the padlock shows authenticated)');
  console.log('3. Open DevTools → Application → Cookies → localhost');
  console.log('4. Copy the value of "vscode-cli-secret-half"');
  console.log('5. Open DevTools → Application → Local Storage → localhost');
  console.log('6. Copy the value of the "vscode_workbench" key');
  console.log('7. Paste both into tests/e2e/auth-state/auth-state.json');
}

// CLI entry point
if (require.main === module) {
  generateAuthTemplate();
}
