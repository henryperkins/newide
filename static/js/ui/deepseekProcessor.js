export const deepSeekProcessor = {
  parseChainOfThought,
  finalizeChainOfThought,
  processChunkAndUpdateBuffers,
  processDeepSeekResponse,
  replaceThinkingBlocks,
  renderThinkingContainer,
  initializeExistingBlocks,
  preprocessChunk
};

function parseChainOfThought(buffer, mainText, thinkingText, isThinking) {
  let leftover = "",
    newMain = mainText || "",
    newThinking = thinkingText || "",
    stillThinking = isThinking || false;
  const tagRegex = /<think(\s+[^>]*)?>|<\/think>/gi;
  let cursor = 0,
    match;
  while ((match = tagRegex.exec(buffer)) !== null) {
    const matchIndex = match.index,
      tag = match[0],
      normalText = buffer.slice(cursor, matchIndex);
    if (stillThinking) newThinking += normalText;
    else newMain += normalText;
    cursor = matchIndex + tag.length;
    if (tag.toLowerCase().startsWith("<think")) stillThinking = true;
    else stillThinking = false;
  }
  const remainder = buffer.slice(cursor);
  if (
    (remainder.includes("<think") && !remainder.includes(">")) ||
    (remainder.includes("</think") && !remainder.includes(">"))
  ) {
    leftover = remainder;
  } else {
    if (stillThinking) newThinking += remainder;
    else newMain += remainder;
  }
  return { leftover, mainText: newMain, thinkingText: newThinking, isThinking: stillThinking };
}

function finalizeChainOfThought(mainText, thinkingText, isThinking) {
  if (isThinking && thinkingText.trim()) {
    console.warn("[finalizeChainOfThought] Unclosed <think> block - leaving it in thinkingText!");
  }
  return { mainContent: mainText, thinkingContent: thinkingText };
}

function processChunkAndUpdateBuffers(data, chunkBuffer, mainTextBuffer, thinkingTextBuffer, isThinking) {
  let newText = "";
  if (data.choices && data.choices.length > 0) {
    const choice = data.choices[0];
    if (choice.delta && choice.delta.content) newText = choice.delta.content;
    else if (choice.message && choice.message.content) newText = choice.message.content;
  } else if (typeof data.text === "string") newText = data.text;
  chunkBuffer += newText;
  const result = parseChainOfThought(chunkBuffer, mainTextBuffer, thinkingTextBuffer, isThinking);
  return {
    mainTextBuffer: result.mainText,
    thinkingTextBuffer: result.thinkingText,
    chunkBuffer: result.leftover,
    isThinking: result.isThinking
  };
}

function processDeepSeekResponse(content) {
  if (!content) return "";
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/<\/?think(\s+[^>]*)?>/gi, "");
  return cleaned;
}

function replaceThinkingBlocks(content) {
  return processDeepSeekResponse(content);
}

function renderThinkingContainer(parentContainer, thinkingText, options = {}) {
  if (!parentContainer) {
    console.warn("[renderThinkingContainer] No parentContainer provided");
    return null;
  }
  const textToRender = thinkingText || "";
  const shouldCreateNew = options.createNew !== false;
  const isComplete = options.isComplete === true;
  let existing = parentContainer.querySelector(".deepseek-cot-block"),
    wrapper = existing,
    contentElement = existing ? existing.querySelector(".thinking-content") : null;
  if (!existing && shouldCreateNew) {
    wrapper = document.createElement("div");
    wrapper.className = "deepseek-cot-block mt-2";
    wrapper.setAttribute("data-streaming", "true");
    wrapper.innerHTML = `
      <details open>
        <summary class="thought-header">
          <div class="header-content">
            <svg xmlns="http://www.w3.org/2000/svg" class="thought-icon thinking" viewBox="0 0 20 20" fill="currentColor">
              <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
            </svg>
            <span class="thought-title">Chain of Thought</span>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" class="chevron-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </summary>
        <div class="thinking-content" style="min-height: 20px; transition: none;"></div>
      </details>`;
    parentContainer.insertBefore(wrapper, parentContainer.firstChild);
    contentElement = wrapper.querySelector(".thinking-content");
    const details = wrapper.querySelector("details"),
      chevron = wrapper.querySelector(".chevron-icon");
    details.addEventListener("toggle", () => {
      chevron.classList.toggle("rotate-180", details.open);
    });
  } else if (existing) {
    contentElement = existing.querySelector(".thinking-content");
  }
  if (!contentElement) return null;
  if (wrapper) {
    const icon = wrapper.querySelector(".thought-icon");
    if (icon) {
      if (isComplete) {
        icon.classList.remove("thinking");
        icon.classList.add("complete");
      } else {
        icon.classList.remove("complete");
        icon.classList.add("thinking");
      }
    }
    if (!isComplete) wrapper.setAttribute("data-streaming", "true");
    else wrapper.removeAttribute("data-streaming");
  }
  if (textToRender !== contentElement.textContent) {
    contentElement.textContent = textToRender;
  }
  return contentElement;
}

function initializeExistingBlocks() {
  const assistantMessages = document.querySelectorAll(".assistant-message");
  assistantMessages.forEach(messageContainer => {
    const block = messageContainer.querySelector(".deepseek-cot-block");
    if (block) {
      if (!block.querySelector("details")) {
        const thinkingText = block.textContent || "";
        block.innerHTML = `
          <details open>
            <summary class="thought-header">
              <div class="header-content">
                <svg xmlns="http://www.w3.org/2000/svg" class="thought-icon complete" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
                </svg>
                <span class="thought-title">Chain of Thought</span>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" class="chevron-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
            </summary>
            <div class="thinking-content">${thinkingText}</div>
          </details>`;
        const details = block.querySelector("details"),
          chevron = block.querySelector(".chevron-icon");
        details.addEventListener("toggle", () => {
          chevron.classList.toggle("rotate-180", details.open);
        });
        const thoughtIcon = block.querySelector(".thought-icon");
        if (thoughtIcon) {
          thoughtIcon.classList.add("complete");
          thoughtIcon.classList.remove("thinking");
        }
      }
    } else {
      const text = messageContainer.textContent || "";
      if (text.includes("<think>") && text.includes("</think>")) {
        const matches = text.match(/<think>([\s\S]*?)<\/think>/gi);
        if (matches) {
          let thinkingText = "";
          matches.forEach(m => {
            thinkingText += m.replace(/<\/?think>/gi, "") + "\n";
          });
          renderThinkingContainer(messageContainer, thinkingText.trim(), {
            createNew: true,
            isComplete: true,
            className: "deepseek-cot-block mt-2"
          });
          const mainDiv = messageContainer.querySelector(".message-content");
          if (mainDiv) mainDiv.textContent = processDeepSeekResponse(text);
        }
      }
    }
  });
}

function preprocessChunk(data) {
  if (data && typeof data === "object") {
    if (data.choices && data.choices[0] && data.choices[0].delta) {
      return { text: data.choices[0].delta.content || "" };
    } else if (data.text !== undefined) {
      return { text: String(data.text) };
    }
  }
  if (typeof data === "string") return { text: data };
  return { text: "" };
}
