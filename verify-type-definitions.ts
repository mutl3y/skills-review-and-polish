/**
 * Verification script: Check VS Code type definitions for multiplier/billing properties
 * Searches vscode.d.ts for LanguageModelChat interface and related billing types
 */
import * as fs from 'fs';
import * as path from 'path';

const VSCODE_TYPES_PATH = '/workspace/vscode-fork/src/vscode-dts/vscode.d.ts';
const PROPOSED_PRICING_PATH = '/workspace/vscode-fork/src/vscode-dts/vscode.proposed.languageModelPricing.d.ts';

function checkTypeDefinitions() {
	console.log('=== Checking VS Code Type Definitions for Multiplier Support ===\n');

	// Check main vscode.d.ts
	console.log('1. Checking vscode.d.ts...');
	if (fs.existsSync(VSCODE_TYPES_PATH)) {
		const content = fs.readFileSync(VSCODE_TYPES_PATH, 'utf-8');
		
		// Find LanguageModelChat interface
		const chatModelMatch = content.match(/interface LanguageModelChat[\s\S]*?(?=\n\t\t(?:interface|type|class|\}|\/\/))/);
		if (chatModelMatch) {
			const section = chatModelMatch[0];
			const hasMultiplier = section.includes('multiplier');
			const hasBilling = section.includes('billing');
			const hasPricing = section.includes('pricing') || section.includes('inputCost') || section.includes('outputCost');
			
			console.log(`   ✓ LanguageModelChat interface found`);
			console.log(`   - Has 'multiplier' property: ${hasMultiplier ? '✅ YES' : '❌ NO'}`);
			console.log(`   - Has 'billing' property: ${hasBilling ? '✅ YES' : '❌ NO'}`);
			console.log(`   - Has pricing props (inputCost/outputCost): ${hasPricing ? '✅ YES' : '❌ NO'}`);
		} else {
			console.log('   ⚠️  LanguageModelChat interface not found');
		}
	} else {
		console.log(`   ❌ File not found: ${VSCODE_TYPES_PATH}`);
	}

	// Check proposed pricing types
	console.log('\n2. Checking vscode.proposed.languageModelPricing.d.ts...');
	if (fs.existsSync(PROPOSED_PRICING_PATH)) {
		const content = fs.readFileSync(PROPOSED_PRICING_PATH, 'utf-8');
		
		const hasMultiplier = content.includes('multiplier');
		const hasBilling = content.includes('billing') || content.includes('IModelBilling');
		const hasCosts = content.includes('inputCost') || content.includes('outputCost') || content.includes('token_prices');
		
		console.log(`   ✓ Proposed pricing file found`);
		console.log(`   - Contains 'multiplier': ${hasMultiplier ? '✅ YES' : '❌ NO'}`);
		console.log(`   - Contains 'billing' or IModelBilling: ${hasBilling ? '✅ YES' : '❌ NO'}`);
		console.log(`   - Contains cost/pricing fields: ${hasCosts ? '✅ YES' : '❌ NO'}`);
		
		if (hasMultiplier || hasBilling || hasCosts) {
			console.log('\n   Content snippet:');
			const lines = content.split('\n');
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].includes('multiplier') || lines[i].includes('billing') || 
					lines[i].includes('Cost') || lines[i].includes('cost') ||
					lines[i].includes('pricing') || lines[i].includes('Pricing')) {
					console.log(`     Line ${i + 1}: ${lines[i].trim()}`);
				}
			}
		}
	} else {
		console.log(`   ⚠️  File not found: ${PROPOSED_PRICING_PATH}`);
		console.log('   (This might be expected if proposed APIs are not in this fork)\n');
	}

	console.log('\n=== Conclusion ===');
	console.log('If multiplier is NOT in the public LanguageModelChat interface,');
	console.log('we must get it from:');
	console.log('  1. Direct CAPI access (if extension has auth)');
	console.log('  2. Static configuration from GitHub docs');
	console.log('  3. User-provided model config\n');
}

checkTypeDefinitions();
