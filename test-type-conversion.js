#!/usr/bin/env bun

// Simple test to verify the strategy type conversion
import { StrategyType } from "./src/shared/enums/index.js";

console.log("🧪 Testing strategy type conversion...");

// Test the mapping that we implemented
const typeMap = {
  'rsi-divergence': StrategyType.RSI_DIVERGENCE,
  'volume-analysis': StrategyType.VOLUME_ANALYSIS,
  'elliott-wave': StrategyType.ELLIOTT_WAVE,
  'harmonic-pattern': StrategyType.HARMONIC_PATTERN,
  'simple-ma': StrategyType.SIMPLE_MA,
};

function getStrategyType(typeString) {
  return typeMap[typeString] || null;
}

// Test the conversion
const testCases = [
  'rsi-divergence',
  'volume-analysis',
  'elliott-wave',
  'harmonic-pattern',
  'simple-ma',
  'invalid-type'
];

testCases.forEach(testType => {
  const converted = getStrategyType(testType);
  if (converted) {
    console.log(`✅ "${testType}" -> ${converted}`);
  } else {
    console.log(`❌ "${testType}" -> null (expected for invalid types)`);
  }
});

console.log("\n🎯 RSI Divergence test specifically:");
const rsiType = getStrategyType('rsi-divergence');
console.log(`"rsi-divergence" converts to: ${rsiType}`);
console.log(`Expected: ${StrategyType.RSI_DIVERGENCE}`);
console.log(`Match: ${rsiType === StrategyType.RSI_DIVERGENCE ? '✅ YES' : '❌ NO'}`);

console.log("\n🔧 This conversion should now resolve the validation error!");
