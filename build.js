// build.js - Tailwind CSS build tool with enhanced features
// Usage:
//   Development build:       node build.js
//   Production build:        node build.js --production
//   Watch mode:              node build.js --watch
//   Verbose output:          node build.js --verbose
//   Combine flags:           node build.js --production --verbose

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const isWindows = process.platform === 'win32';

// Config
const inputFile = 'static/css/tailwind.css';
const outputFile = 'static/css/tailwind.compiled.css';
const configFile = 'tailwind.config.js';

// Command-line arguments
const args = process.argv.slice(2);
const isProduction = args.includes('--production');
const isWatch = args.includes('--watch');
const isVerbose = args.includes('--verbose');

/**
 * Log a message, but only if verbose mode is enabled or it's an error
 */
function log(message, isError = false) {
  if (isVerbose || isError) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${message}`);
  }
}

/**
 * Check if the required files exist
 */
function checkPrerequisites() {
  const requiredFiles = [inputFile, configFile];
  const missing = requiredFiles.filter(file => !fs.existsSync(file));
  
  if (missing.length > 0) {
    console.error(`Error: The following required files are missing:`);
    missing.forEach(file => console.error(`- ${file}`));
    return false;
  }
  
  return true;
}

/**
 * Create output directory if it doesn't exist
 */
function ensureOutputDirectory() {
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    log(`Creating output directory: ${outputDir}`);
    fs.mkdirSync(outputDir, { recursive: true });
  }
}

/**
 * Build Tailwind CSS
 */
function buildTailwind() {
  if (!checkPrerequisites()) {
    process.exit(1);
  }
  
  ensureOutputDirectory();
  
  try {
    log(`Building Tailwind CSS in ${isProduction ? 'production' : 'development'} mode`);
    log(`Using updated configuration with ring opacity support`);
    
    // FIXED: Use cross-env directly instead of trying to set environment variables
    // in the shell command - this way it works across all platforms
    const env = { ...process.env, NODE_ENV: isProduction ? 'production' : 'development' };
    const postcssCmd = `npx postcss ${inputFile} -o ${outputFile}${isWatch ? ' --watch' : ''}`;
    
    if (isVerbose) {
      log(`Executing command with NODE_ENV=${env.NODE_ENV}: ${postcssCmd}`);
    }
    
    execSync(postcssCmd, { 
      env: env, 
      stdio: 'inherit' 
    });
    
    log('CSS build completed successfully');
    
    if (!isWatch) {
      const stats = fs.statSync(outputFile);
      const fileSizeKB = (stats.size / 1024).toFixed(2);
      log(`Build successful! Output size: ${fileSizeKB} KB`);
      
      if (isProduction) {
        const originalStats = fs.statSync(inputFile);
        const compressionRatio = ((1 - (stats.size / originalStats.size)) * 100).toFixed(2);
        log(`Compression ratio: ${compressionRatio}% reduction`);
      }
    } else {
      log(`Watching for changes...`);
    }
  } catch (error) {
    console.error('Build failed:', error.message);
    process.exit(1);
  }
}

// Execute the build
buildTailwind();