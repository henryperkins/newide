/**
 * deepseekProcessor.js
 *
 * Consolidated module for parsing, processing, and rendering
 * "DeepSeek-R1" style chain-of-thought content. In accordance
 * with the official documentation, we look for <think>...</think>.
 *
 * Provides:
 *  - parseChainOfThought()     -> Splits text into main vs. thinking buffers, with leftover partial tags
 *  - finalizeChainOfThought()  -> Closes any unclosed <think> at the end
 *  - processChunkAndUpdateBuffers()  -> Legacy function if your streaming.js calls it
 *  - processDeepSeekResponse()/replaceThinkingBlocks() -> Hide chain-of-thought if you prefer
 *  - renderThinkingContainer() -> Renders chain-of-thought text in the DOM
 *  - preprocessChunk()         -> A helper for "streaming.js"
 */

//
// 1) Real-time parsing: parseChainOfThought() and finalizeChainOfThought()
//

/**
 * parseChainOfThought(buffer, mainText, thinkingText, isThinking)
 * 
 * Detects <think(\s+[^>]*)?> or </think> in 'buffer'.
 * Anything outside these tags goes to 'mainText', while inside is 'thinkingText'.
 *
 * If a tag is incomplete (e.g. '<thi' or '</thi'), the partial text is stored in leftover.
 * That leftover is appended to next chunk.
 */
function parseChainOfThought(buffer, mainText, thinkingText, isThinking) {
  let leftover = "";
  let newMain = mainText || "";
  let newThinking = thinkingText || "";
  let stillThinking = isThinking || false;

  // Regex for <think> or </think>, allowing optional attributes (like <think reason="xyz">).
  const tagRegex = /<think(\s+[^>]*)?>|<\/think>/gi;

  let cursor = 0;
  let match;

  while ((match = tagRegex.exec(buffer)) !== null) {
    const matchIndex = match.index;
    const tag = match[0];

    // Everything before this match is normal text
    const normalText = buffer.slice(cursor, matchIndex);

    if (stillThinking) {
      newThinking += normalText;
    } else {
      newMain += normalText;
    }

    cursor = matchIndex + tag.length;

    // Identify open vs. close
    if (tag.toLowerCase().startsWith("<think")) {
      stillThinking = true; // we've entered a thinking block
    } else {
      // must be </think>
      stillThinking = false;
    }
  }

  // After the last match, remainder
  const remainder = buffer.slice(cursor);

  // If remainder might contain partial <think or </think but no closing '>',
  // store it in leftover. Otherwise, append to the correct buffer
  if (
    (remainder.includes("<think") && !remainder.includes(">")) ||
    (remainder.includes("</think") && !remainder.includes(">"))
  ) {
    leftover = remainder;
  } else {
    if (stillThinking) {
      newThinking += remainder;
    } else {
      newMain += remainder;
    }
  }

  return {
    leftover,
    mainText: newMain,
    thinkingText: newThinking,
    isThinking: stillThinking
  };
}

/**
 * finalizeChainOfThought(mainText, thinkingText, isThinking)
 * 
 * If we still have an unclosed <think> block at the end
 * of streaming, decide what to do with the leftover chain-of-thought.
 * 
 * Option A: Move it all to mainText so the user doesn't lose anything.
 * Option B: Leave it in the thinking buffer but note it's incomplete.
 */
function finalizeChainOfThought(mainText, thinkingText, isThinking) {
  // For demonstration, let's keep them separate if they are separate
  // If you prefer to merge leftover thinking text into main, do so here
  if (isThinking && thinkingText.trim()) {
    console.warn("[finalizeChainOfThought] Unclosed <think> block - leaving it in thinkingText!");
    // You could do: mainText += "\n" + thinkingText;
    // thinkingText = "";
  }

  return {
    mainContent: mainText,
    thinkingContent: thinkingText
  };
}

//
// 2) Legacy chunk-based approach: processChunkAndUpdateBuffers()
//

/**
 * If your streaming.js code calls `deepSeekProcessor.processChunkAndUpdateBuffers(...)`
 * with "data", a chunkBuffer, mainTextBuffer, etc., use this wrapper.
 *
 * Under the hood, we still call parseChainOfThought for new text.
 */
function processChunkAndUpdateBuffers(
  data,
  chunkBuffer,
  mainTextBuffer,
  thinkingTextBuffer,
  isThinking
) {
  // 1) Extract new text from 'data'
  let newText = "";
  if (data.choices && data.choices.length > 0) {
    const choice = data.choices[0];
    if (choice.delta && choice.delta.content) {
      newText = choice.delta.content;
    } else if (choice.message && choice.message.content) {
      // final chunk
      newText = choice.message.content;
    }
  } else if (typeof data.text === "string") {
    newText = data.text;
  }

  // 2) Append newText to chunkBuffer
  chunkBuffer += newText;

  // 3) parseChainOfThought
  const result = parseChainOfThought(chunkBuffer, mainTextBuffer, thinkingTextBuffer, isThinking);

  // 4) Update
  const updatedMainText = result.mainText;
  const updatedThinkingText = result.thinkingText;
  const updatedIsThinking = result.isThinking;
  const updatedChunkBuffer = result.leftover; // partial leftover

  return {
    mainTextBuffer: updatedMainText,
    thinkingTextBuffer: updatedThinkingText,
    chunkBuffer: updatedChunkBuffer,
    isThinking: updatedIsThinking
  };
}

//
// 3) Final answer logic
//

/**
 * If you want to remove chain-of-thought from a final answer
 * after all streaming is complete, call this function:
 * It finds <think>...</think> blocks and strips them out.
 */
function processDeepSeekResponse(content) {
  if (!content) return "";
  // Remove <think> sections entirely
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // Remove leftover tags if they're unbalanced
  cleaned = cleaned.replace(/<\/?think(\s+[^>]*)?>/gi, "");
  return cleaned;
}

/**
 * If your code references a function named replaceThinkingBlocks, alias it:
 */
function replaceThinkingBlocks(content) {
  return processDeepSeekResponse(content);
}

//
// 4) Renders chain-of-thought text in the DOM
//

/**
 * Minimal code to create a separate "Chain of Thought" section in the UI:
 */
function renderThinkingContainer(parentContainer, thinkingText, options = {}) {
  if (!parentContainer) {
    console.warn("[renderThinkingContainer] No parentContainer provided");
    return null;
  }
  if (!thinkingText || !thinkingText.trim()) {
    console.warn("[renderThinkingContainer] No thinking text to render");
    return null;
  }

  // If "createNew" isn't explicitly false, default to true
  const shouldCreateNew = options.createNew !== false;

  let existing = parentContainer.querySelector(".deepseek-cot-block");
  if (!existing && shouldCreateNew) {
    const wrapper = document.createElement("div");
    wrapper.className = "deepseek-cot-block mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded";
    wrapper.innerHTML = `
      <details open>
        <summary class="font-bold cursor-pointer">Chain of Thought</summary>
        <div class="thinking-content mt-2"></div>
      </details>
    `;
    parentContainer.insertBefore(wrapper, parentContainer.firstChild);
    existing = wrapper.querySelector(".thinking-content");
  }

  if (!existing) return null; // no container to update

  // Just do textContent or minimal sanitize
  // For more advanced formatting, parse markdown
  existing.textContent = thinkingText;

  return existing;
}

//
// 5) Optional "preprocessChunk" hook if streaming.js expects it
//

function preprocessChunk(data) {
  // If you just want to unify data into {text: "..."}
  if (data && typeof data === "object") {
    if (data.choices && data.choices[0] && data.choices[0].delta) {
      return { text: data.choices[0].delta.content || "" };
    } else if (data.text !== undefined) {
      return { text: String(data.text) };
    }
  }
  if (typeof data === "string") {
    return { text: data };
  }
  return { text: "" };
}

/**
 * Scans the DOM for existing assistant messages with thinking blocks
 * and initializes them properly
 */
function initializeExistingBlocks() {
  console.log("Initializing existing thinking blocks...");
  
  // Find all existing assistant message containers
  const assistantMessages = document.querySelectorAll('.assistant-message');
  
  assistantMessages.forEach(messageContainer => {
    // Check if this message has any thinking content
    const thinkingContent = messageContainer.querySelector('.deepseek-cot-block');
    
    // If there's already a thinking block container, ensure it's properly formatted
    if (thinkingContent) {
      // Make sure it has the proper structure (details/summary)
      if (!thinkingContent.querySelector('details')) {
        const thinkingText = thinkingContent.textContent || '';
        
        // Recreate with proper structure
        thinkingContent.innerHTML = `
          <details open>
            <summary class="font-bold cursor-pointer">Chain of Thought</summary>
            <div class="thinking-content mt-2">${thinkingText}</div>
          </details>
        `;
      }
    } else {
      // Look for potential thinking content that may not be properly formatted
      // Check for text containing <think> tags
      const messageText = messageContainer.textContent || '';
      if (messageText.includes('<think>') && messageText.includes('</think>')) {
        // Parse out the thinking content
        const thinkMatches = messageText.match(/<think>([\s\S]*?)<\/think>/gi);
        
        if (thinkMatches && thinkMatches.length > 0) {
          // Extract thinking content from all matches
          let thinkingText = '';
          thinkMatches.forEach(match => {
            // Remove the opening and closing think tags
            const content = match.replace(/<\/?think>/gi, '');
            thinkingText += content + '\n';
          });
          
          // Create a new thinking container
          renderThinkingContainer(messageContainer, thinkingText.trim(), { createNew: true });
          
          // Optionally, clean the original message content
          const mainContentDiv = messageContainer.querySelector('.message-content');
          if (mainContentDiv) {
            mainContentDiv.textContent = processDeepSeekResponse(messageText);
          }
        }
      }
    }
  });
  
  console.log("Finished initializing thinking blocks");
}

//
// 6) Export everything as a single object
//
export const deepSeekProcessor = {
  // Main streaming logic
  parseChainOfThought,
  finalizeChainOfThought,
  processChunkAndUpdateBuffers,

  // Post-processing/hiding chain-of-thought
  processDeepSeekResponse,
  replaceThinkingBlocks,


  // UI rendering
  renderThinkingContainer,
  
  // Initialize existing blocks on page load
  initializeExistingBlocks,

  // If streaming.js calls it:
  preprocessChunk,
};
