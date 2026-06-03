# Undocumented Ways to Access Multiplier Data from Copilot Extension

## Summary
The VS Code Copilot extension **does expose multiplier data internally**, but it is **not part of the public API**. The multiplier is stored in multiple internal data structures and can be accessed through internal extension services.

---

## 1. Direct Access Points in Internal APIs

### 1.1 IModelBilling Interface (Primary Multiplier Storage)
**File:** `/workspace/vscode-fork/extensions/copilot/src/platform/endpoint/common/endpointProvider.ts`

```typescript
export interface IModelBilling {
	is_premium?: boolean;
	multiplier?: number;              // ← MULTIPLIER HERE
	restricted_to?: string[];
	token_prices?: IModelTokenPrices;
}

export interface IModelAPIResponse {
	id: string;
	vendor: string;
	name: string;
	// ... other fields
	billing?: IModelBilling;          // ← Billing info with multiplier
	// ... other fields
}

export type IChatModelInformation = IModelAPIResponse & {
	capabilities: IChatModelCapabilities;
	// ...
};
```

**Key Points:**
- Multiplier comes from the `/models` API endpoint response
- Stored in the `billing?.multiplier` field of each model
- Part of `IModelAPIResponse` which extends to `IChatModelInformation`

---

### 1.2 IChatEndpoint Interface (Runtime Multiplier Access)
**File:** `/workspace/vscode-fork/extensions/copilot/src/platform/networking/common/networking.ts`

```typescript
export interface IChatEndpoint extends IEndpoint {
	readonly maxOutputTokens: number;
	readonly model: string;
	readonly modelProvider: string;
	// ... many other fields
	readonly multiplier?: number;               // ← MULTIPLIER PROPERTY
	readonly tokenPricing?: IChatEndpointTokenPricing;
	readonly priceCategory?: string;
	readonly isFallback: boolean;
	// ... other fields
}

export interface IChatEndpointTokenPricing {
	readonly inputPrice: number;
	readonly outputPrice: number;
	readonly cacheReadTokenPrice: number;
}
```

**Key Points:**
- Runtime representation of a chat endpoint
- `multiplier` property is accessible on any `IChatEndpoint` instance
- Includes pricing data: `inputPrice`, `outputPrice`, `cacheReadTokenPrice`

---

## 2. Services that Expose Multiplier Data

### 2.1 IEndpointProvider Service
**File:** `/workspace/vscode-fork/extensions/copilot/src/platform/endpoint/common/endpointProvider.ts`

```typescript
export interface IEndpointProvider {
	readonly onDidModelsRefresh: Event<void>;
	
	// Get chat endpoints with multiplier accessible
	getAllChatEndpoints(): Promise<IChatEndpoint[]>;
	
	// Get specific endpoint by request/family
	getChatEndpoint(requestOrFamily: LanguageModelChat | ChatRequest | ChatEndpointFamily): Promise<IChatEndpoint>;
	
	// Get completion models
	getAllCompletionModels(forceRefresh?: boolean): Promise<ICompletionModelInformation[]>;
}
```

**How to access:**
```typescript
// Inside extension services with dependency injection
const endpoints = await endpointProvider.getAllChatEndpoints();
for (const endpoint of endpoints) {
    const multiplier = endpoint.multiplier;  // ← Access multiplier here
    const pricing = endpoint.tokenPricing;   // ← Access pricing here
}
```

---

### 2.2 ModelMetadataFetcher Service
**File:** `/workspace/vscode-fork/extensions/copilot/src/platform/endpoint/node/modelMetadataFetcher.ts`

```typescript
export interface IModelMetadataFetcher {
	onDidModelsRefresh: Event<void>;
	
	// Returns ALL chat models including multiplier in billing
	getAllChatModels(): Promise<IChatModelInformation[]>;
	
	// Get specific model by family
	getChatModelFromCapiFamily(family: string): Promise<IChatModelInformation>;
	
	// Get model from LanguageModelChat
	getChatModelFromApiModel(model: LanguageModelChat): Promise<IChatModelInformation | undefined>;
	
	// Get default Copilot utility model
	getCopilotUtilityModel(): Promise<IChatModelInformation>;
}

// Model response structure
export type IChatModelInformation = IModelAPIResponse & {
	capabilities: IChatModelCapabilities;
	urlOrRequestMetadata?: string | RequestMetadata;
	requestHeaders?: Readonly<Record<string, string>>;
};
```

**Access point for multiplier:**
```typescript
const models = await modelMetadataFetcher.getAllChatModels();
for (const model of models) {
    const multiplier = model.billing?.multiplier;  // ← Multiplier from /models API
}
```

---

## 3. LanguageModelAccess Contribution (VS Code API Integration)

### 3.1 Model Information Exposure
**File:** `/workspace/vscode-fork/extensions/copilot/src/extension/conversation/vscode-node/languageModelAccess.ts`

The extension exposes multiplier through the **vscode.LanguageModelChatInformation** structure:

```typescript
export class LanguageModelAccess extends Disposable implements IExtensionContribution {
	// ... constructor code
	
	private async _provideLanguageModelChatInfo(options: { silent: boolean }, token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
		const models: vscode.LanguageModelChatInformation[] = [];
		const allEndpoints = await this._endpointProvider.getAllChatEndpoints();
		
		for (const endpoint of chatEndpoints) {
			// LINE 359: Multiplier is extracted here
			const multiplier = endpoint.multiplier !== undefined ? `${endpoint.multiplier}x` : undefined;
			
			const model: vscode.LanguageModelChatInformation = {
				id: endpoint.model,
				name: endpoint.name,
				family: endpoint.family,
				// ... other fields
				pricing: endpoint instanceof AutoChatEndpoint ? undefined : (multiplier ?? (endpoint.tokenPricing ? formatPricingLabel(endpoint.tokenPricing) : undefined)),
				inputCost: endpoint.tokenPricing?.inputPrice,
				outputCost: endpoint.tokenPricing?.outputPrice,
				cacheCost: endpoint.tokenPricing?.cacheReadTokenPrice,
				multiplierNumeric: endpoint instanceof AutoChatEndpoint ? undefined : endpoint.multiplier,  // ← MULTIPLIER HERE
				priceCategory: endpoint.priceCategory,
				// ... other fields
			};
			models.push(model);
		}
	}
}
```

**Key fields in vscode.LanguageModelChatInformation:**
- `multiplierNumeric: number | undefined` — The raw multiplier value
- `pricing: string | undefined` — Formatted pricing string (e.g., "2x")
- `inputCost: number | undefined` — Cost per million input tokens
- `outputCost: number | undefined` — Cost per million output tokens
- `cacheCost: number | undefined` — Cost per million cached tokens
- `priceCategory: string | undefined` — Price category name

---

## 4. How to Access Outside the Extension

### 4.1 Through the Public Language Model API (Limited)
**File:** `vscode` namespace

```typescript
// The vscode.LanguageModelChatInformation object includes:
// - multiplierNumeric: number | undefined
// - inputCost: number | undefined
// - outputCost: number | undefined
// - cacheCost: number | undefined
// - priceCategory: string | undefined

const models = await vscode.lm.getLanguageModels('copilot');
for (const model of models) {
    console.log('Model:', model.id);
    console.log('Multiplier:', model.multiplierNumeric);        // May be undefined
    console.log('Input Cost:', model.inputCost);
    console.log('Output Cost:', model.outputCost);
    console.log('Price Category:', model.priceCategory);
}
```

**Limitations:**
- `multiplierNumeric` may be `undefined` for auto models
- Not all models expose this data
- Subject to change in future API versions

### 4.2 Through the vscode.chat.onDidRequestPromptChatResponse Event
Event includes model metadata:
```typescript
vscode.chat.onDidRequestPromptChatResponse((context: PromptChatRequestContext) => {
    const model = context.modelInformation;  // Contains multiplier data
});
```

---

## 5. Registered Extension Commands

**File:** `/workspace/vscode-fork/extensions/copilot/src/extension/context/vscode/context.contribution.ts`

```typescript
// Historic commands that forward to VS Code core
commands.registerCommand('github.copilot.chat.attachFile', ...)
commands.registerCommand('github.copilot.chat.attachSelection', ...)
```

**Note:** No dedicated `copilot.getModelInfo` command exists, but the public API provides model information through the standard vscode.lm interface.

---

## 6. Context Values and Global State

### 6.1 Extension Context State
The extension stores model metadata in `extensionContext.globalState`:

```typescript
// From LanguageModelAccessPromptBaseCountCache
const key = `lmBaseCount/${endpoint.model}`;
const cached = this._extensionContext.globalState.get<{ 
	extensionVersion: string; 
	baseCount: number 
}>(key);
```

**Potential access pattern:**
```typescript
// Within extension code:
const baseCountKey = `lmBaseCount/${modelName}`;
const cached = context.globalState.get(baseCountKey);
```

---

## 7. API Response Structure (From /models Endpoint)

**Raw format from CAPI `/models` endpoint:**

```json
{
	"data": [
		{
			"id": "gpt-4o",
			"vendor": "openai",
			"name": "GPT-4o",
			"model_picker_enabled": true,
			"is_chat_default": true,
			"is_chat_fallback": false,
			"version": "2024-11-20",
			"billing": {
				"is_premium": false,
				"multiplier": 2,           // ← MULTIPLIER HERE
				"token_prices": {
					"batch_size": 1000000,
					"cache_price": 0.15,
					"input_price": 2.5,
					"output_price": 10.0
				}
			},
			"capabilities": {
				"type": "chat",
				"family": "gpt-4o",
				"tokenizer": "cl100k_base",
				"supports": {
					"tool_calls": true,
					"vision": true,
					"streaming": true,
					"reasoning_effort": ["low", "medium", "high"]
				}
			}
		}
	]
}
```

---

## 8. Summary: How to Get Multiplier Data

### ✅ **Within the Copilot Extension (Full Access)**

1. **Inject IEndpointProvider service:**
   ```typescript
   const endpoints = await this._endpointProvider.getAllChatEndpoints();
   endpoints.forEach(ep => console.log(ep.multiplier));
   ```

2. **Inject IModelMetadataFetcher service:**
   ```typescript
   const models = await this._modelMetadataFetcher.getAllChatModels();
   models.forEach(m => console.log(m.billing?.multiplier));
   ```

3. **Access LanguageModelAccess._currentModels** (if you have reference):
   ```typescript
   // Field: multiplierNumeric on each model
   ```

### ⚠️ **Outside Extension (Limited Access)**

1. **Use vscode.lm.getLanguageModels():**
   ```typescript
   const models = await vscode.lm.getLanguageModels('copilot');
   models.forEach(m => console.log(m.multiplierNumeric));
   ```

2. **Listen to model updates:**
   ```typescript
   vscode.lm.onDidChangeLanguageModels(() => {
       // Re-fetch models with current multiplier values
   });
   ```

---

## 9. Pricing-Related Fields Exposed

| Field | Type | Source | Accessible Via |
|-------|------|--------|-----------------|
| `multiplier` | `number \| undefined` | `IChatEndpoint.multiplier` | IEndpointProvider |
| `multiplierNumeric` | `number \| undefined` | `LanguageModelChatInformation` | vscode.lm API |
| `inputCost` | `number \| undefined` | `IChatEndpointTokenPricing.inputPrice` | vscode.lm API |
| `outputCost` | `number \| undefined` | `IChatEndpointTokenPricing.outputPrice` | vscode.lm API |
| `cacheCost` | `number \| undefined` | `IChatEndpointTokenPricing.cacheReadTokenPrice` | vscode.lm API |
| `priceCategory` | `string \| undefined` | `IChatEndpoint.priceCategory` | vscode.lm API |
| `isPremium` | `boolean \| undefined` | `IModelBilling.is_premium` | Internal only |
| `tokenPricing` | `IChatEndpointTokenPricing \| undefined` | `IChatEndpoint.tokenPricing` | Internal only |

---

## 10. Undocumented Debug/Telemetry APIs

### 10.1 Request Logger Service
**File:** `/workspace/vscode-fork/extensions/copilot/src/platform/requestLogger/node/requestLogger.ts`

Logs model list calls including multiplier:
```typescript
this._requestLogger.logModelListCall(requestId, requestMetadata, data);
// where `data` includes IModelAPIResponse with billing.multiplier
```

### 10.2 Telemetry Service
The extension logs model information in telemetry, but this is not directly accessible to external code.

---

## Key Findings Summary

✅ **Multiplier IS accessible through:**
1. `IChatEndpoint.multiplier` (internal service)
2. `IModelBilling.multiplier` (from API response)
3. `LanguageModelChatInformation.multiplierNumeric` (public VS Code API)
4. `IChatEndpointTokenPricing` (pricing details)

⚠️ **No undocumented commands like `copilot.getModelInfo` exist**

⚠️ **Public API exposure is intentional and limited** (multiplierNumeric on model info)

✅ **Full multiplier + pricing data is available internally** through the endpoint provider service

---

## Example: Complete Multiplier Retrieval Flow

```typescript
// Within Copilot extension with DI
async function getAllModelsWithMultiplier(
    @IEndpointProvider endpointProvider: IEndpointProvider
) {
    const endpoints = await endpointProvider.getAllChatEndpoints();
    
    const modelData = endpoints.map(endpoint => ({
        id: endpoint.model,
        name: endpoint.name,
        family: endpoint.family,
        multiplier: endpoint.multiplier,
        inputPrice: endpoint.tokenPricing?.inputPrice,
        outputPrice: endpoint.tokenPricing?.outputPrice,
        cachePrice: endpoint.tokenPricing?.cacheReadTokenPrice,
        isPremium: endpoint.isPremium,
        priceCategory: endpoint.priceCategory,
    }));
    
    return modelData;
}

// From external extension (limited)
async function getPublicMultiplierInfo() {
    const models = await vscode.lm.getLanguageModels('copilot');
    const modelData = models.map(m => ({
        id: m.id,
        name: m.name,
        multiplierNumeric: m.multiplierNumeric,
        inputCost: m.inputCost,
        outputCost: m.outputCost,
        cacheCost: m.cacheCost,
        priceCategory: m.priceCategory,
    }));
    
    return modelData;
}
```

---

## References
- Endpoint Provider: `/workspace/vscode-fork/extensions/copilot/src/platform/endpoint/common/endpointProvider.ts`
- Chat Endpoint: `/workspace/vscode-fork/extensions/copilot/src/platform/networking/common/networking.ts`
- Language Model Access: `/workspace/vscode-fork/extensions/copilot/src/extension/conversation/vscode-node/languageModelAccess.ts`
- Model Metadata: `/workspace/vscode-fork/extensions/copilot/src/platform/endpoint/node/modelMetadataFetcher.ts`
