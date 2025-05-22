// simple-test.cjs - Simple script to test ES modules vs CommonJS
console.log("Hello from simple test (CJS)!");
console.log("Node version:", process.version);
console.log("ES modules setting:", typeof require === 'undefined' ? "ES modules (require is undefined)" : "CommonJS (require exists)");
