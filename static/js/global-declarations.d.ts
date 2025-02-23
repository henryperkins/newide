// This file provides basic type declarations to satisfy the TypeScript compiler for the existing JS modules and global usage.

// Declare each importable module so that "Cannot find module ... or its corresponding type declarations" errors are silenced.
declare module '/static/js/session.js';
declare module '/static/js/config.js';
declare module '/static/js/ui/notificationManager.js';
declare module '/static/js/ui/displayManager.js';
declare module '/static/js/ui/markdownParser.js';
declare module '/static/js/utils/helpers.js';
declare module '/static/js/fileManager.js';
declare module '/static/js/ui/statsDisplay.js';  // Added the lowercased statsDisplay module

// Provide global augmentation for window properties and other variables referenced in main.js:
declare global {
  interface Window {
    azureOpenAIConfig?: any;
    serverCalculatedTimeout?: number;
    isO1Model?: boolean;
  }

  // Prism is used for syntax highlighting
  var Prism: any;

  // If there's a global handleApplicationError function, declare it here:
  function handleApplicationError(error: any, context?: string): void;

  // Some code references a global 'config'
  // If 'config' is actually meant to hold the same data as getCurrentConfig or fallback config, refine the type here:
  var config: any;
}

export {};