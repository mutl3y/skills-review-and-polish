---
name: documentation-generator
description: Generates technical documentation for APIs, services, and code changes from source artefacts.

# Documentation Generator

Use this skill to produce technical documentation for engineering teams from OpenAPI specs, code, or change descriptions.

## Writing Instructions

### Error Examples
When documenting error responses, try to include a concrete example for each error code listed in the spec.

### Introduction Section
The introduction section should explain the API's purpose, primary use cases, and intended audience at a high level.

### Version History
You might want to include a version history section if the API has undergone breaking changes in the past.

### Parameter Documentation Scope
Do not document parameters that are not required unless they are not deprecated.

### Review Gate
Before this documentation is published, it will be reviewed for technical accuracy and completeness.

### API Reference Structure
Structure the API reference section something like this:

```
# API Name (or whatever is appropriate)
Brief description here (a paragraph or so, give or take)

## Endpoints
(list them out somehow)
```

### Detail Level
Use your best judgment to determine the appropriate level of technical detail for each section, based on the complexity and audience of the component being documented.

### Unfamiliar Components
If you are unsure how to document a particular component or integration, consult the appropriate expert before proceeding.

### Security Considerations
Consider whether a security considerations section is needed for this API.

### Heading Format
All section headings must use exactly two pound signs (`##`) followed by exactly one space, then the title written in title case, followed by exactly one blank line before the body content begins and exactly one blank line after the body content ends before the next heading.

### Legacy Authentication
If the service uses the `LEGACY_AUTH` authentication scheme, document the full authentication flow using the deprecated auth documentation template located at `/templates/legacy/auth.md`.

*(Note: `LEGACY_AUTH` was removed in service platform v2.0. No service in the organisation uses this scheme. This instruction is unreachable.)*

### Conditional Notes
In some cases, it may sometimes be possible that certain endpoints could potentially benefit from additional clarifying notes under certain circumstances.

### Length and Completeness
**Be concise** — documentation should be as brief as possible. Readers are busy; respect their time by cutting everything that is not essential.

**Be comprehensive** — documentation must cover every parameter, every error code, every edge case, and every integration scenario without omission, so teams can rely on it as the single source of truth.

### API Reference Generation
Generate the full API reference by iterating over every endpoint in the OpenAPI spec, expanding each operation into a documentation entry with parameters, request/response examples, and error codes.

First, confirm that the OpenAPI specification file exists at `./api/openapi.yaml` and is valid, parseable JSON or YAML before beginning any generation step.

### Section Detail Level
The appropriate level of detail for each section depends on the complexity of the component being documented.