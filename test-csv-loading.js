// test-csv-loading.js - Test simple script to load CSV data
const fs = require('fs');
const path = require('path');
const csvParse = require('csv-parse/sync');

function loadCSV(filename) {
  console.log(`Trying to load: ${filename}`);
  
  try {
    if (fs.existsSync(filename)) {
      console.log(`File exists`);
      const fileContent = fs.readFileSync(filename, 'utf8');
      console.log(`File content length: ${fileContent.length} characters`);
      
      const records = csvParse.parse(fileContent, {
        columns: true,
        skip_empty_lines: true
      });
      
      console.log(`Parsed ${records.length} records`);
      if (records.length > 0) {
        console.log(`First record: ${JSON.stringify(records[0])}`);
      }
      
      return records;
    } else {
      console.error(`File doesn't exist: ${filename}`);
      return [];
    }
  } catch (error) {
    console.error(`Error loading CSV: ${error.message}`);
    return [];
  }
}

// List files in the data directory
console.log("Files in the data directory:");
const dataDir = './data';
try {
  const files = fs.readdirSync(dataDir);
  console.log(files);
} catch (error) {
  console.error(`Error listing directory: ${error.message}`);
}

// Try to load the BTC_USD data
const btcData = loadCSV(path.join(dataDir, 'BTC_USD_1h.csv'));
console.log(`Loaded ${btcData.length} BTC_USD records`);

// Try to load the ETH_USD data
const ethData = loadCSV(path.join(dataDir, 'ETH_USD_1h.csv'));
console.log(`Loaded ${ethData.length} ETH_USD records`);
