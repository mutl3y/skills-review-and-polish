import { filterFindings } from '../../out/core/findingFilter.js';
const f1 = {code:'ambiguity-llm',message:'',severity:'warning',range:{start:{line:5,character:0},end:{line:5,character:20}},analyzer:'ambiguity-detection',relevantText:''};
const f2 = {code:'contradiction',message:'',severity:'warning',range:{start:{line:5,character:0},end:{line:5,character:20}},analyzer:'ambiguity-detection',relevantText:''};
const out = filterFindings([f1, f2], {analysisMode:'multiWave',enabledWaves:['contradictions','ambiguities'],scoreSamples:3,fixStrategy:'subtractive',fixSemanticCheck:false,fixSelfCritique:false,fixReferenceGrounding:false,filterFindings:true}, '');
console.log('out:', JSON.stringify(out.map(f=>({code:f.code,analyzer:f.analyzer})), null, 2));
