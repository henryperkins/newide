// A module for managing conversations in the sidebar
import { showNotification } from './notificationManager.js';
import { getSessionId, createNewConversation } from '../session.js';

let sidebarInitialized = false;

// State management
let conversations = [];
let currentFilter = 'all';
let searchQuery = '';
let isLoading = false;
let currentPage = 0;
let hasMoreConversations = true;

/*
 * Provide a queue for pin/archive operations to avoid race conditions when multiple quick actions occur
 */
let pendingActions = false; // Flag to indicate if an action is in progress
let actionQueue = []; // Stores queued functions

function enqueueAction(fn) {
  actionQueue.push(fn);
  processActionQueue();
}

async function processActionQueue() {
  if (pendingActions || actionQueue.length === 0) return;

  pendingActions = true;
  const actionFn = actionQueue.shift();
  try {
    await actionFn();
  } catch (e) {
    console.error('Queue action failed:', e);
  } finally {
    pendingActions = false;
    if (actionQueue.length > 0) {
      processActionQueue();
    }
  }
}

/**
 * Initialize the conversation manager
 */
export function initConversationManager() {
  if (sidebarInitialized) return; // Prevent double initialization

  // Fix conversations sidebar positioning
  const conversationsSidebar = document.getElementById('conversations-sidebar');
  if (conversationsSidebar) {
    // Ensure proper positioning for the conversation sidebar
    if (window.innerWidth < 768) {
      conversationsSidebar.classList.add('hidden');
    } else {
      conversationsSidebar.classList.remove('hidden');
    }

    // Ensure this sidebar doesn't interfere with the settings sidebar
    conversationsSidebar.classList.add('z-10'); // Lower than settings sidebar
  }

  // Set initialization flag
  sidebarInitialized = true;

  // Continue with normal setup
  setupEventListeners();
  loadConversations();
  window.dispatchEvent(new Event('resize'));
}

/**
 * Set up event listeners for conversation controls
 */
function setupEventListeners() {
  // New conversation button
  const newConvoBtn = document.getElementById('new-conversation-btn');
  if (newConvoBtn) {
    newConvoBtn.addEventListener('click', async () => {
      await createNewConversation();
      loadConversations();
    });
  }

  // Search input
  const searchInput = document.getElementById('conversation-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      currentPage = 0;
      loadConversations(true);
    });
  }

  // Filter tabs
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Update active button styling
      document.querySelectorAll('[data-filter]').forEach(b => {
        b.classList.remove('border-primary-500', 'text-primary-600', 'dark:text-primary-400');
        b.classList.add('text-dark-600', 'dark:text-dark-400', 'border-transparent');
      });
      e.target.classList.remove('text-dark-600', 'dark:text-dark-400', 'border-transparent');
      e.target.classList.add('border-primary-500', 'text-primary-600', 'dark:text-primary-400');

      // Set filter and reload
      currentFilter = e.target.getAttribute('data-filter');
      currentPage = 0;
      loadConversations(true);
    });
  });

  // Conversation item click delegation
  const conversationList = document.getElementById('conversation-list');
  if (conversationList) {
    conversationList.addEventListener('click', (e) => {
      // Handle conversation item click
      const conversationItem = e.target.closest('.conversation-item');
      if (conversationItem) {
        const conversationId = conversationItem.getAttribute('data-id');
        if (conversationId) {
          loadConversation(conversationId);
        }
      }

      // Handle pin button click
      const pinBtn = e.target.closest('.pin-conversation-btn');
      if (pinBtn) {
        e.stopPropagation();
        const conversationId = pinBtn.closest('.conversation-item').getAttribute('data-id');
        if (conversationId) {
          const isPinned = pinBtn.classList.contains('pinned');
          togglePinConversation(conversationId, !isPinned);
        }
      }

      // Handle archive button click
      const archiveBtn = e.target.closest('.archive-conversation-btn');
      if (archiveBtn) {
        e.stopPropagation();
        const conversationId = archiveBtn.closest('.conversation-item').getAttribute('data-id');
        if (conversationId) {
          const isArchived = archiveBtn.classList.contains('archived');
          toggleArchiveConversation(conversationId, !isArchived);
        }
      }

      // Handle rename button click
      const renameBtn = e.target.closest('.rename-conversation-btn');
      if (renameBtn) {
        e.stopPropagation();
        const conversationId = renameBtn.closest('.conversation-item').getAttribute('data-id');
        if (conversationId) {
          const oldTitle = renameBtn.closest('.conversation-item').querySelector('.conversation-title')?.textContent || 'this conversation';
          const newTitle = prompt(`Enter a new name for ${oldTitle}:`, oldTitle);
          if (newTitle && newTitle.trim() !== '') {
            renameConversation(conversationId, newTitle.trim());
          }
        }
      }

      // Handle delete button click
      const deleteBtn = e.target.closest('.delete-conversation-btn');
      if (deleteBtn) {
        e.stopPropagation();
        const conversationId = deleteBtn.closest('.conversation-item').getAttribute('data-id');
        const title = deleteBtn.closest('.conversation-item').querySelector('.conversation-title')?.textContent || 'this conversation';
        if (conversationId) {
          if (confirm(`Are you sure you want to delete ${title}? This cannot be undone.`)) {
            deleteConversation(conversationId);
          }
        }
      }
    });

    // Load more on scroll
    conversationList.addEventListener('scroll', () => {
      if (!isLoading && hasMoreConversations) {
        const { scrollTop, scrollHeight, clientHeight } = conversationList;
        if (scrollTop + clientHeight >= scrollHeight - 50) {
          currentPage++;
          loadConversations(false);
        }
      }
    });
  }
}

/**
 * Load conversations from API
 * @param {boolean} reset - Whether to reset the current conversation list
 */
export async function loadConversations(reset = false) {
  const conversationList = document.getElementById('conversation-list');
  if (!conversationList) return;

  if (reset) {
    currentPage = 0;
    conversations = [];
    conversationList.innerHTML = '<div class="py-4 px-3 text-center text-dark-500 dark:text-dark-400">Loading conversations...</div>';
  }

  if (isLoading || (!hasMoreConversations && !reset)) return;
  isLoading = true;

  try {
    // Build query params
    const params = new URLSearchParams();
    params.append('offset', currentPage * 20);
    params.append('limit', 20);

    if (searchQuery) {
      params.append('search', searchQuery);
    }

    if (currentFilter === 'pinned') {
      params.append('pinned', 'true');
    } else if (currentFilter === 'archived') {
      params.append('archived', 'true');
    }

    // Fetch conversations
    const response = await fetch(`/api/chat/conversations?${params.toString()}`);
    if (!response.ok) throw new Error('Failed to load conversations');

    const data = await response.json();
    hasMoreConversations = data.has_more;

    if (reset) {
      conversations = data.conversations || [];
    } else {
      conversations = [...conversations, ...(data.conversations || [])];
    }

    renderConversations();
  } catch (error) {
    // Use standardized error handling
    import('./displayManager.js').then(module => {
      const recovery = () => {
        conversations = [];
        conversationList.innerHTML = '<div class="py-4 px-3 text-center text-dark-500 dark:text-dark-400">No conversations found</div>';
        isLoading = false;
      };

      if (module.handleConversationError) {
        module.handleConversationError(
          error,
          'Failed to load conversations',
          recovery,
          { filter: currentFilter, page: currentPage }
        );
      } else {
        // Fallback if module import fails
        console.error('Error loading conversations:', error);
        conversationList.innerHTML = '<div class="py-4 px-3 text-center text-red-500">Failed to load conversations</div>';
        recovery();
      }
    }).catch(err => {
      console.error('Error loading module:', err);
      conversationList.innerHTML = '<div class="py-4 px-3 text-center text-red-500">Failed to load conversations</div>';
    });
  } finally {
    isLoading = false;
  }
}

/**
 * Render conversations to the DOM
 */
function renderConversations() {
  const conversationList = document.getElementById('conversation-list');
  if (!conversationList) return;

  conversationList.innerHTML = '';

  if (!conversations || conversations.length === 0) {
    conversationList.innerHTML = '<div class="py-4 px-3 text-center text-dark-500 dark:text-dark-400">No conversations</div>';
    return;
  }

  conversations.forEach(conv => {
    // container
    const item = document.createElement('div');
    item.classList.add('conversation-item', 'p-2', 'border-b', 'border-dark-200', 'dark:border-dark-600', 'flex', 'flex-col', 'gap-1', 'cursor-pointer');
    item.setAttribute('data-id', conv.id);

    // pinned (visual) highlight
    if (conv.pinned) {
      item.classList.add('bg-primary-50', 'dark:bg-dark-800');
    }

    // conversation title
    const titleEl = document.createElement('div');
    titleEl.classList.add('conversation-title', 'font-semibold', 'truncate');
    titleEl.textContent = conv.title || '(untitled)';

    // container for action buttons
    const actionContainer = document.createElement('div');
    actionContainer.classList.add('flex', 'gap-2');

    // pin/unpin button
    const pinBtn = document.createElement('button');
    pinBtn.classList.add('pin-conversation-btn', 'border', 'py-1', 'px-2');
    if (conv.pinned) {
      pinBtn.classList.add('pinned');
      pinBtn.textContent = 'Unpin';
    } else {
      pinBtn.textContent = 'Pin';
    }
    actionContainer.appendChild(pinBtn);

    // archive/unarchive button
    const archiveBtn = document.createElement('button');
    archiveBtn.classList.add('archive-conversation-btn', 'border', 'py-1', 'px-2');
    if (conv.archived) {
      archiveBtn.classList.add('archived');
      archiveBtn.textContent = 'Unarchive';
    } else {
      archiveBtn.textContent = 'Archive';
    }
    actionContainer.appendChild(archiveBtn);

    // delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.classList.add('delete-conversation-btn', 'border', 'py-1', 'px-2');
    deleteBtn.textContent = 'Delete';
    actionContainer.appendChild(deleteBtn);

    // Rename button
    const renameBtn = document.createElement('button');
    renameBtn.classList.add('rename-conversation-btn', 'border', 'py-1', 'px-2');
    renameBtn.textContent = 'Rename';
    actionContainer.appendChild(renameBtn);

    // if updating
    if (conv.updating) {
      item.classList.add('opacity-50', 'pointer-events-none');
    }

    // assemble
    item.appendChild(titleEl);
    item.appendChild(actionContainer);
    conversationList.appendChild(item);
  });
}

/**
 * Load a specific conversation
 * @param {string} conversationId - ID of the conversation to load
 */
async function loadConversation(conversationId) {
  try {
    // Store the active conversation ID in both sessionStorage and localStorage for cross-tab sync
    sessionStorage.setItem('sessionId', conversationId);
    localStorage.setItem('activeConversationId', conversationId);

    // Highlight active conversation
    document.querySelectorAll('.conversation-item').forEach(item => {
      item.classList.remove('bg-dark-100', 'dark:bg-dark-700/50');
    });
    document.querySelector(`.conversation-item[data-id="${conversationId}"]`)?.classList.add('bg-dark-100', 'dark:bg-dark-700/50');

    // Load conversation messages
    const displayManagerModule = await import('./displayManager.js');
    await displayManagerModule.loadConversationFromDb();

    // On mobile, close the sidebar
    const conversationsSidebar = document.getElementById('conversations-sidebar');
    if (window.innerWidth < 768 && conversationsSidebar) {
      conversationsSidebar.classList.add('hidden');
    }
  } catch (error) {
    console.error('Error loading conversation:', error);
    showNotification('Failed to load conversation', 'error');
  }
}

/**
 * Toggle pinned status of a conversation
 * @param {string} conversationId - ID of the conversation
 * @param {boolean} pinned - Whether to pin or unpin
 */
async function togglePinConversation(conversationId, pinned) {
  enqueueAction(async () => {
    const previousState = conversations.map(c => ({ ...c }));

    try {
      // Optimistic update
      conversations = conversations.map(c =>
        c.id === conversationId ? { ...c, pinned, updating: true } : c
      );
      renderConversations();

      const response = await fetch(`/api/chat/conversations/${conversationId}/pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': document.cookie.match(/csrftoken=([\w-]+)/)?.[1] || ''
        },
        body: JSON.stringify({ pinned })
      });
      if (!response.ok) throw new Error('Failed to update conversation');

      const data = await response.json();
      conversations = conversations.map(c =>
        c.id === conversationId
          ? { ...c, pinned, version: data.version, updating: false }
          : c
      );

      // If we're filtering by pinned, reload conversations
      if (currentFilter === 'pinned' && !pinned) {
        loadConversations(true);
      } else {
        renderConversations();
      }
    } catch (error) {
      conversations = previousState;
      renderConversations();

      import('./displayManager.js')
        .then(module => {
          if (module.handleConversationError) {
            module.handleConversationError(error, 'Failed to update conversation');
          } else {
            showNotification('Failed to update conversation', 'error');
          }
        })
        .catch(() => {
          showNotification('Failed to update conversation', 'error');
        });
    }
  });
}

/**
 * Toggle archived status of a conversation
 * @param {string} conversationId - ID of the conversation
 * @param {boolean} archived - Whether to archive or unarchive
 */
async function toggleArchiveConversation(conversationId, archived) {
  enqueueAction(async () => {
    const conversation = conversations.find(c => c.id === conversationId);
    const version = conversation?.version || 0;
    const previousState = conversations.map(c => ({ ...c }));

    try {
      // Optimistic update
      conversations = conversations.map(c =>
        c.id === conversationId ? { ...c, archived, updating: true } : c
      );
      renderConversations();

      const response = await fetch(`/api/chat/conversations/${conversationId}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archived,
          version
        })
      });
      if (!response.ok) throw new Error(`Server returned ${response.status}`);

      const data = await response.json();
      if (data.status === 'conflict') {
        showNotification('This conversation was modified elsewhere', 'warning');
        loadConversations(true);
        return;
      }

      conversations = conversations.map(c =>
        c.id === conversationId
          ? { ...c, archived, version: data.version, updating: false }
          : c
      );

      if ((currentFilter === 'archived' && !archived) ||
          (currentFilter !== 'archived' && archived)) {
        loadConversations(true);
      } else {
        renderConversations();
      }
    } catch (error) {
      conversations = previousState;
      renderConversations();

      import('./displayManager.js')
        .then(module => {
          if (module.handleConversationError) {
            module.handleConversationError(error, 'Failed to update conversation');
          } else {
            showNotification('Failed to update conversation', 'error');
          }
        })
        .catch(() => {
          showNotification('Failed to update conversation', 'error');
        });
    }
  });
}

/**
 * Delete a conversation
 * @param {string} conversationId - ID of the conversation to delete
 */
async function deleteConversation(conversationId) {
  try {
    const response = await fetch(`/api/chat/conversations/${conversationId}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      if (response.status === 404) {
        console.warn('Conversation not found. Possibly already deleted on the server.');
      } else {
        throw new Error(`Failed to delete conversation: ${response.status}`);
      }
    }

    // Remove from UI
    const item = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
    if (item) {
      item.remove();
    }

    // Remove from local data
    conversations = conversations.filter(c => c.id !== conversationId);

    // If current conversation was deleted, create a new one
    if (sessionStorage.getItem('sessionId') === conversationId) {
      await createNewConversation();
      // Skip reloading conversation for the just-deleted ID
    }

    showNotification('Conversation deleted', 'success');
  } catch (error) {
    console.error('Error deleting conversation:', error);
    showNotification('Failed to delete conversation', 'error');
  }
}

/**
 * Rename a conversation
 * @param {string} conversationId - ID of the conversation to rename
 * @param {string} newTitle - The new title for the conversation
 */
async function renameConversation(conversationId, newTitle) {
  // Save previous state for rollback in case of error
  const previousState = conversations.map(c => ({ ...c }));

  try {
    // Optimistic update
    conversations = conversations.map(c =>
      c.id === conversationId ? { ...c, title: newTitle, updating: true } : c
    );
    renderConversations();

    const response = await fetch(`/api/chat/conversations/${conversationId}/rename`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': document.cookie.match(/csrftoken=([\w-]+)/)?.[1] || ''
      },
      body: JSON.stringify({ newTitle })
    });
    if (!response.ok) throw new Error('Failed to rename conversation');

    const data = await response.json();
    conversations = conversations.map(c =>
      c.id === conversationId
        ? { ...c, title: data.title || newTitle, version: data.version, updating: false }
        : c
    );
    renderConversations();
  } catch (error) {
    console.error('Error renaming conversation:', error);
    conversations = previousState;
    renderConversations();

    import('./displayManager.js')
      .then(module => {
        if (module.handleConversationError) {
          module.handleConversationError(error, 'Failed to rename conversation');
        } else {
          showNotification('Failed to rename conversation', 'error');
        }
      })
      .catch(() => {
        showNotification('Failed to rename conversation', 'error');
      });
  }
}

/**
 * Toggle the conversation sidebar with consistent show/hide logic
 */
export function toggleConversationSidebar() {
  const conversationsSidebar = document.getElementById('conversations-sidebar');
  const conversationsToggleBtn = document.getElementById('conversations-toggle');
  if (!conversationsSidebar || !conversationsToggleBtn) return;

  const isOpen = conversationsSidebar.classList.contains('sidebar-open');

  if (isOpen) {
    // Close
    conversationsSidebar.classList.remove('sidebar-open', 'translate-x-0');
    conversationsSidebar.classList.add('-translate-x-full');
    conversationsToggleBtn.setAttribute('aria-expanded', 'false');
  } else {
    // Open
    conversationsSidebar.classList.add('sidebar-open', 'translate-x-0');
    conversationsSidebar.classList.remove('-translate-x-full');
    conversationsToggleBtn.setAttribute('aria-expanded', 'true');
  }
  
  // For mobile, handle the 'hidden' class too
  if (window.innerWidth < 768) {
    conversationsSidebar.classList.toggle('hidden', isOpen);
  }
}

// Set up conversation sidebar toggle
function initConversationSidebarToggle() {
  const conversationsToggleBtn = document.getElementById('conversations-toggle');
  if (conversationsToggleBtn) {
    // Remove any existing listeners to avoid duplicates
    const newBtn = conversationsToggleBtn.cloneNode(true);
    conversationsToggleBtn.parentNode.replaceChild(newBtn, conversationsToggleBtn);
    
    // Add our listener to the NEW button (this line was missing)
    newBtn.addEventListener('click', toggleConversationSidebar);
  }
}

// Call this function during initialization
document.addEventListener('DOMContentLoaded', () => {
  initConversationSidebarToggle();
});

/**
 * Create a new conversation and set it in session storage, then clear the conversation list in the UI
 * This allows displayManager.js to import and call createAndSetupNewConversation() when a conversation 404s.
 */
export async function createAndSetupNewConversation() {
  // Remove the old session ID to avoid reusing it
  sessionStorage.removeItem("sessionId");

  // Create a fresh conversation
  const newSessionId = await createNewConversation();
  if (!newSessionId) {
    throw new Error('Failed to create new conversation');
  }

  // Ensure sessionId in storage matches the newly created one
  if (sessionStorage.getItem("sessionId") !== newSessionId) {
    sessionStorage.setItem("sessionId", newSessionId);
  }
  // Also store in localStorage for cross-tab sync
  localStorage.setItem('activeConversationId', newSessionId);

  // Clear or reset the UI if needed (for example clearing the conversation list in the sidebar)
  const conversationList = document.getElementById('conversation-list');
  if (conversationList) {
    conversationList.innerHTML = '';
  }

  console.log('[createAndSetupNewConversation] New conversation created with ID:', newSessionId);
  return newSessionId;
}

/**
 * Listen for storage events to sync active conversation across tabs
 */
window.addEventListener('storage', (e) => {
  if (e.key === 'activeConversationId' && e.newValue) {
    // If another tab changed "activeConversationId", update the current tab
    sessionStorage.setItem('sessionId', e.newValue);
    loadConversation(e.newValue);
  }
});