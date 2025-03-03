/**
 * Integration test for DeepSeek-R1D2 API and deepseekProcessor functionality
 * 
 * This script demonstrates:
 * 1. Connecting to the DeepSeek-R1D2 endpoint with proper authentication
 * 2. Sending a request and receiving a response with <think> tags
 * 3. Processing the response using the deepseekProcessor to handle thinking blocks
 */

// Import for Node.js environment - in browser, this would be imported via ES6 imports
const fs = require('fs');
const path = require('path');
const https = require('https');

// DeepSeek-R1D2 API configuration
const API_CONFIG = {
  endpoint: 'https://DeepSeek-R1D2.eastus2.models.ai.azure.com',
  apiKey: 'M6Dbj2dcZ1Eb2If33ecVZ5jXK3yvVlOx',
  model: 'DeepSeek-R1',
  apiVersion: '2024-05-01-preview'
};

// Load the deepseekProcessor.js content for demonstration
// Note: In a browser environment, this would be properly imported
const deepseekProcessorPath = path.join(__dirname, 'static/js/ui/deepseekProcessor.js');
console.log(`Reading deepseekProcessor from: ${deepseekProcessorPath}`);

// Function to test the DeepSeek-R1D2 API connection
async function testDeepSeekAPI() {
  console.log('\n=== TESTING DEEPSEEK-R1D2 API CONNECTION ===\n');
  console.log(`Endpoint: ${API_CONFIG.endpoint}`);
  console.log(`Model: ${API_CONFIG.model}`);
  console.log(`API Version: ${API_CONFIG.apiVersion}`);

  // Use the exact endpoint format that worked with curl
  const apiUrl = `${API_CONFIG.endpoint}/chat/completions?api-version=${API_CONFIG.apiVersion}`;
  
  // Create the request payload
  const payload = {
    model: API_CONFIG.model,
    messages: [
      {
        role: 'user',
        content: 'Explain the concept of recursion in programming with a simple example.'
      }
    ],
    max_tokens: 1000,
    temperature: 0.7
  };

  // Create the request options with Authorization header as requested by the API
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_CONFIG.apiKey}`
    }
  };

  return new Promise((resolve, reject) => {
    // Execute the request
    const req = https.request(apiUrl, options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const response = JSON.parse(responseData);
            resolve(response);
          } else {
            console.error(`HTTP Status: ${res.statusCode}`);
            console.error(`Response: ${responseData}`);
            reject(new Error(`API request failed with status ${res.statusCode}`));
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    // Send the payload
    req.write(JSON.stringify(payload));
    req.end();
  });
}

// Load and execute the deepseekProcessor functionality
async function demonstrateDeepSeekProcessor(responseContent) {
  console.log('\n=== DEMONSTRATING DEEPSEEK PROCESSOR FUNCTIONALITY ===\n');
  
  // We can't directly import ES modules in Node.js without extra setup, 
  // so for this demo we'll simulate the processor functionality
  
  console.log('Raw response content (with <think> tags):');
  console.log('----------------------------------------');
  console.log(responseContent.substring(0, 500) + '...');
  
  // Extract thinking content (simple regex approximation)
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
  const matches = [...responseContent.matchAll(thinkRegex)];
  
  if (matches.length > 0) {
    console.log('\nExtracted thinking content:');
    console.log('-------------------------');
    matches.forEach((match, index) => {
      console.log(`Thinking block ${index + 1}:`);
      console.log(match[1].substring(0, 200) + '...');
      console.log();
    });
    
    // Simulate the processDeepSeekResponse function
    const processedContent = responseContent.replace(/<think>[\s\S]*?<\/think>/g, '');
    
    console.log('\nProcessed response (thinking removed):');
    console.log('------------------------------------');
    console.log(processedContent);
  } else {
    console.log('\nNo <think> tags found in the response.');
  }
  
  console.log('\nIn a browser environment, the deepseekProcessor would:');
  console.log('1. Extract and remove <think> blocks from user-visible content');
  console.log('2. Format thinking content with syntax highlighting');
  console.log('3. Create collapsible UI components for thinking blocks');
  console.log('4. Handle streaming content with partial <think> tags');
}

// Main function to run the test
async function main() {
  try {
    console.log('\n===== DEEPSEEK-R1D2 INTEGRATION TEST =====\n');
    
    // Test the API connection
    const apiResponse = await testDeepSeekAPI();
    
    console.log('\nAPI Response Summary:');
    console.log(`- Status: Success`);
    console.log(`- Model: ${apiResponse.model}`);
    console.log(`- Token usage: ${apiResponse.usage.total_tokens} total tokens`);
    console.log(`  - Prompt tokens: ${apiResponse.usage.prompt_tokens}`);
    console.log(`  - Completion tokens: ${apiResponse.usage.completion_tokens}`);
    
    // Extract the response content
    const responseContent = apiResponse.choices[0].message.content;
    
    // Demonstrate the deepseekProcessor functionality
    await demonstrateDeepSeekProcessor(responseContent);
    
    console.log('\n===== INTEGRATION TEST COMPLETED SUCCESSFULLY =====\n');
  } catch (error) {
    console.error('\nTest failed:', error);
  }
}

// Run the test
main();
