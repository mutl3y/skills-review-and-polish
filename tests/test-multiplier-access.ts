/**
 * Test script to verify if multiplier/billing data is accessible via VS Code LM API
 * Run in VS Code extension context to inspect actual LanguageModelChat objects
 */
import * as vscode from 'vscode';

export async function testMultiplierAccess() {
	console.log('=== Testing Multiplier Access via VS Code LM API ===\n');

	try {
		// Get all available models
		const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
		console.log(`Found ${models.length} Copilot models\n`);

		if (models.length === 0) {
			console.log('❌ No models found');
			return;
		}

		// Inspect first 3 models
		for (let i = 0; i < Math.min(3, models.length); i++) {
			const model = models[i];
			console.log(`\n--- Model ${i + 1}: ${model.name || 'N/A'} ---`);
			console.log(`ID: ${model.id}`);
			console.log(`Vendor: ${model.vendor}`);
			console.log(`Family: ${model.family}`);
			console.log(`Version: ${model.version}`);

			// Try to access billing/multiplier fields
			const multiplier = (model as any).multiplier;
			const billing = (model as any).billing;
			const isPremium = (model as any).isPremium;
			const priceCategory = (model as any).priceCategory;
			const inputCost = (model as any).inputCost;
			const outputCost = (model as any).outputCost;

			console.log(`\nBilling Data:`);
			console.log(`  multiplier: ${multiplier ?? 'UNDEFINED'}`);
			console.log(`  billing: ${billing ? JSON.stringify(billing) : 'UNDEFINED'}`);
			console.log(`  isPremium: ${isPremium ?? 'UNDEFINED'}`);
			console.log(`  priceCategory: ${priceCategory ?? 'UNDEFINED'}`);
			console.log(`  inputCost: ${inputCost ?? 'UNDEFINED'}`);
			console.log(`  outputCost: ${outputCost ?? 'UNDEFINED'}`);

			// Log all properties for inspection
			console.log(`\nAll Properties:`);
			const keys = Object.keys(model);
			for (const key of keys) {
				const value = (model as any)[key];
				if (typeof value !== 'function') {
					console.log(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
				}
			}
		}

		console.log('\n=== Test Complete ===');
		console.log('\nConclusion:');
		console.log('If multiplier/billing fields are UNDEFINED above, then VS Code LM API');
		console.log('does NOT expose them in the public LanguageModelChat interface.');
		console.log('\nIn that case, we must get multiplier data from:');
		console.log('1. Dynamic fetch via CAPI when available');
		console.log('2. Static config based on GitHub documentation');
		console.log('3. Or ask user to configure it');
	} catch (error) {
		console.error('❌ Error testing multiplier access:', error);
	}
}

// For running in extension context, export the test function
export default testMultiplierAccess;
