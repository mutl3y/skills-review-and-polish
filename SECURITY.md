# Security Policy

## Reporting Security Vulnerabilities

**Do not** create a public GitHub issue for security vulnerabilities. Instead, please report security issues privately.

### How to Report

Please send an email with:
- **Subject**: `[SECURITY] <brief description>`
- **Details**: 
  - Description of the vulnerability
  - Affected versions
  - Steps to reproduce
  - Potential impact
  - Any suggested fixes (optional)

**Email**: [To be determined — contact project maintainers]

*We typically acknowledge reports within 24 hours and provide a detailed response within 72 hours.*

## Security Considerations

### Code Analysis and LLM Integration

This extension uses Large Language Models (LLMs) to analyze AI customization files. Please be aware:

1. **Data sent to LLMs**: Text content from analyzed files is sent to the LLM provider (Copilot, OpenRouter, GitHub Models) for analysis
   - **Copilot (default)**: Covered by your GitHub account's privacy policy
   - **OpenRouter/GitHub Models**: Subject to their respective privacy policies
   - Use caution with proprietary or sensitive content

2. **No data retention**: Analysis results are not stored locally or remotely by default
   - Extension logs are stored in `.debug-llm-analyzer.log` (workspace-local, not synced)
   - Diagnostic results are in-memory only

3. **API Key Security**:
   - External provider API keys (OpenRouter, GitHub Models) are stored in VS Code SecretStorage
   - Never commit API keys to version control
   - Use the "Set API Key" command to configure providers securely

4. **Model Tier Enforcement**:
   - Extension enforces "safe-tier" models (multiplier ≤1x) in tests and by default
   - See [docs/MULTIPLIER-ACCESS.md](docs/MULTIPLIER-ACCESS.md) for cost/risk tiers
   - Expensive models require explicit confirmation in model picker

### Dependency Security

- Dependencies are kept up-to-date via Dependabot
- Critical vulnerabilities are patched immediately
- Run `npm audit` locally to check your environment

### Code Execution

This extension does **not** execute arbitrary code from analyzed files. It only:
- Reads file text
- Sends to LLM for analysis
- Displays diagnostics
- Offers fixes for manual review/acceptance

**No** JavaScript evaluation, shell commands, or file system operations are performed on untrusted content.

## Security Patching

### Process
1. Security issue reported privately
2. Fix developed and tested
3. Security patch released as minor version bump
4. GitHub Security Advisory published
5. Notification sent to dependent projects

### Versions Supported

| Version | Support | Until |
|---------|---------|-------|
| 1.x     | Active  | TBD   |
| 0.0.x   | Critical fixes only | Current development |

## Known Limitations

1. **Sandbox environment**: Extension runs in VS Code context with file system access
   - Ensure you trust the source of analyzed files
   - Malicious files could theoretically interact with VS Code APIs

2. **LLM hallucinations**: LLM analysis can produce false positives or incorrect suggestions
   - Always review fixes before applying
   - Report consistent misidentifications as GitHub issues

3. **Large files**: Very large files may cause performance issues or timeouts
   - Tested up to 50KB+ files
   - Extremely large files (>1MB) may time out

## Security Checklist for Contributors

If you're contributing security-related code:

- [ ] All user inputs are validated/sanitized
- [ ] No hardcoded secrets in code or tests
- [ ] Error messages don't leak sensitive information
- [ ] Dependencies checked with `npm audit`
- [ ] API calls use HTTPS only
- [ ] No eval() or Function() calls on user input
- [ ] Tests cover error/edge cases
- [ ] Security-critical code is peer-reviewed

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## Security Advisories

Subscribe to security updates:
- Watch this repository (GitHub Notifications)
- Check [Security Advisories](https://github.com/mutl3y/skills-review-and-polish/security/advisories)

## Contact

For security policy questions (non-vulnerability):
- Open a private security discussion or email maintainers
- Do not share sensitive details publicly

---

**Last Updated**: June 3, 2026  
**Policy Version**: 1.0
