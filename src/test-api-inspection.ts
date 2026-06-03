/**
 * Direct API inspection test - run in VS Code extension context
 * This tests what data is ACTUALLY available at runtime from the VS Code LM APIs
 */
import * as vscode from 'vscode';

export async function inspectLMAPIs() {
	console.log('\n========== LIVE API INSPECTION ==========\n');

	try {
		// Test 1: Get models via standard API
		console.log('TEST 1: vscode.lm.selectChatModels()');
		console.log('-------------------------------------------');
		const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
		console.log(`✓ Found ${models.length} Copilot models\n`);

		if (models.length > 0) {
			// Inspect first 3 models
			for (let i = 0; i < Math.min(3, models.length); i++) {
				const model = models[i];
				console.log(`\nModel ${i + 1}: ${model.name}`);
				console.log(`  id: ${model.id}`);
				console.log(`  vendor: ${model.vendor}`);
				console.log(`  family: ${model.family}`);

				// Try to access proposed pricing fields
				const pricing = (model as any).pricing;
				const inputCost = (model as any).inputCost;
				const outputCost = (model as any).outputCost;
				const cacheCost = (model as any).cacheCost;
				const priceCategory = (model as any).priceCategory;
				const multiplier = (model as any).multiplier;
				const multiplierNumeric = (model as any).multiplierNumeric;
				const isPremium = (model as any).isPremium;

				console.log(`  \n  Pricing fields:`);
				console.log(`    pricing: ${pricing ?? '❌ undefined'}`);
				console.log(`    inputCost: ${inputCost ?? '❌ undefined'}`);
				console.log(`    outputCost: ${outputCost ?? '❌ undefined'}`);
				console.log(`    cacheCost: ${cacheCost ?? '❌ undefined'}`);
				console.log(`    priceCategory: ${priceCategory ?? '❌ undefined'}`);
				console.log(`    multiplier: ${multiplier ?? '❌ undefined'}`);
				console.log(`    multiplierNumeric: ${multiplierNumeric ?? '❌ undefined'}`);
				console.log(`    isPremium: ${isPremium ?? '❌ undefined'}`);

				// Log all enumerable properties
				console.log(`\n  All properties on model object:`);
				const keys = Object.getOwnPropertyNames(model);
				for (const key of keys) {
					const value = (model as any)[key];
					if (typeof value !== 'function') {
						console.log(`    ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
					}
				}
			}
		}

		// Test 2: Check if Copilot extension exports anything
		console.log('\n\nTEST 2: Check for Copilot extension APIs');
		console.log('-------------------------------------------');
		try {
			const copilotExt = vscode.extensions.getExtension('GitHub.copilot');
			if (copilotExt) {
				console.log(`✓ Copilot extension found: ${copilotExt.id}`);
				console.log(`  isActive: ${copilotExt.isActive}`);
				
				if (copilotExt.isActive && copilotExt.exports) {
					console.log(`  Exports available: ${typeof copilotExt.exports}`);
					const exportKeys = Object.keys(copilotExt.exports);
					console.log(`  Export keys: ${exportKeys.length > 0 ? exportKeys.join(', ') : 'none'}`);
					
					// List all exported functions/objects
					for (const key of exportKeys) {
						const value = (copilotExt.exports as any)[key];
						console.log(`    ${key}: ${typeof value}`);
					}
				}
			} else {
				console.log('❌ Copilot extension not found');
			}
		} catch (e) {
			console.log(`❌ Error checking Copilot extension: ${e}`);
		}

		// Test 3: Check extension context
		console.log('\n\nTEST 3: Check for model-related context');
		console.log('-------------------------------------------');
		try {
			// Try to get all available extensions
			const allExts = vscode.extensions.all;
			console.log(`Total extensions loaded: ${allExts.length}`);
			
			// Look for any that might have model data
			const relevantExts = allExts.filter(e => 
				e.id.toLowerCase().includes('copilot') || 
				e.id.toLowerCase().includes('model') ||
				e.id.toLowerCase().includes('chat')
			);
			console.log(`\nRelevant extensions: ${relevantExts.length}`);
			for (const ext of relevantExts) {
				console.log(`  - ${ext.id} (active: ${ext.isActive})`);
			}
		} catch (e) {
			console.log(`❌ Error checking extensions: ${e}`);
		}

		// Test 4: Check environment variables
		console.log('\n\nTEST 4: Check vscode.env for model data');
		console.log('-------------------------------------------');
		try {
			const appName = vscode.env.appName;
			const remoteName = vscode.env.remoteName;
			const shell = vscode.env.shell;
			console.log(`  appName: ${appName}`);
			console.log(`  remoteName: ${remoteName}`);
			console.log(`  shell: ${shell}`);
		} catch (e) {
			console.log(`❌ Error: ${e}`);
		}

		console.log('\n========== SUMMARY ==========\n');
		console.log('FINDINGS:');
		console.log('1. Check if inputCost/outputCost/priceCategory are populated above');
		console.log('2. Check if multiplier/multiplierNumeric fields exist');
		console.log('3. Check if Copilot extension exports model APIs');
		console.log('\nShare the output above and we can determine next steps.');

	} catch (error) {
		console.error('❌ Error in API inspection:', error);
	}
}

export default inspectLMAPIs;
