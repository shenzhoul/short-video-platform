require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);

/**
 * Script runner for executing database scripts
 * Usage: node script.js <script-name>
 * Example: node script.js seed-users
 */

if (!args.length || !args[0]) {
  console.log('❌ Missing script name!');
  console.log('Usage: node script.js <script-name>');
  console.log('Example: node script.js seed-users');
  process.exit(1);
}

const scriptName = args[0];
const scriptPath = path.join(__dirname, 'scripts', `${scriptName}.js`);

// Check if script file exists
if (!fs.existsSync(scriptPath)) {
  console.log(`❌ Script file not found: ${scriptPath}`);
  console.log('Available scripts:');

  try {
    const scriptsDir = path.join(__dirname, 'scripts');
    const files = fs.readdirSync(scriptsDir)
      .filter((file) => file.endsWith('.js'))
      .map((file) => file.replace('.js', ''));

    if (files.length > 0) {
      files.forEach((file) => console.log(`  - ${file}`));
    } else {
      console.log('  No scripts found in ./scripts/ directory');
    }
  } catch (error) {
    console.log('  Could not read scripts directory');
  }

  process.exit(1);
}

async function runScript() {
  try {
    console.log(`🚀 Starting script: ${scriptName}`);
    console.log(`📁 Script path: ${scriptPath}`);

    // Connect to MongoDB (removed deprecated options)
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB successfully');

    // Execute the script
    console.log(`⚡ Executing script: ${scriptName}`);
    const scriptModule = require(scriptPath);

    // Support both default export and named export patterns
    if (typeof scriptModule === 'function') {
      await scriptModule();
    } else if (typeof scriptModule.default === 'function') {
      await scriptModule.default();
    } else if (typeof scriptModule.run === 'function') {
      await scriptModule.run();
    } else {
      throw new Error('Script must export a function (default export, named "run", or direct export)');
    }

    console.log('✅ Script completed successfully!');
  } catch (error) {
    console.error('❌ Script failed with error:');
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Always close the database connection
    try {
      await mongoose.connection.close();
      console.log('🔌 Database connection closed');
    } catch (closeError) {
      console.error('⚠️  Error closing database connection:', closeError.message);
    }
    process.exit(0);
  }
}

// Add process handlers for graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⚠️  Received SIGINT, shutting down gracefully...');
  try {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  } catch (error) {
    console.error('❌ Error during shutdown:', error.message);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️  Received SIGTERM, shutting down gracefully...');
  try {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  } catch (error) {
    console.error('❌ Error during shutdown:', error.message);
  }
  process.exit(0);
});

// Run the script
runScript();
