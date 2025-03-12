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
    // Original placeholder to be replaced.
}

/**
 * Load a specific conversation
 * @param {string} conversationId - ID of the conversation to load
 */
async function loadConversation(conversationId) {
    try {
        // Set as active conversation
        sessionStorage.setItem('sessionId', conversationId);

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
    // Store previous state for recovery
    const previousState = conversations.map(c => ({ ...c }));

    try {
        // Optimistic update
        conversations = conversations.map(c =>
            c.id === conversationId ? { ...c, pinned, updating: true } : c
        );

        // Update UI immediately
        renderConversations();

        const response = await fetch(`/api/chat/conversations/${conversationId}/pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pinned })
        });

        if (!response.ok) throw new Error('Failed to update conversation');

        // Update with new state from response
        const data = await response.json();

        // Update local state
        conversations = conversations.map(c =>
            c.id === conversationId ? {
                ...c,
                pinned,
                version: data.version,
                updating: false
            } : c
        );

        // If we're filtering by pinned, reload conversations
        if (currentFilter === 'pinned' && !pinned) {
            loadConversations(true);
        } else {
            renderConversations();
        }
    } catch (error) {
        // Recover from the error by restoring previous state
        conversations = previousState;
        renderConversations();

        // Use standardized error handling if available
        import('./displayManager.js').then(module => {
            if (module.handleConversationError) {
                module.handleConversationError(error, 'Failed to update conversation');
            } else {
                showNotification('Failed to update conversation', 'error');
            }
        }).catch(() => {
            showNotification('Failed to update conversation', 'error');
        });
    }
}

/**
 * Toggle archived status of a conversation
 * @param {string} conversationId - ID of the conversation
 * @param {boolean} archived - Whether to archive or unarchive
 */
async function toggleArchiveConversation(conversationId, archived) {
    // Find conversation and get version if available
    const conversation = conversations.find(c => c.id === conversationId);
    const version = conversation?.version || 0;

    // Store previous state for recovery
    const previousState = conversations.map(c => ({ ...c }));

    try {
        // Optimistic update
        conversations = conversations.map(c =>
            c.id === conversationId ? { ...c, archived, updating: true } : c
        );

        // Update UI immediately
        renderConversations();

        const response = await fetch(`/api/chat/conversations/${conversationId}/archive`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                archived,
                version  // Send version for conflict detection
            })
        });

        if (!response.ok) throw new Error(`Server returned ${response.status}`);

        const data = await response.json();

        if (data.status === 'conflict') {
            // Handle conflict - reload the conversation
            showNotification('This conversation was modified elsewhere', 'warning');
            loadConversations(true);
            return;
        }

        // Update with new version from server
        conversations = conversations.map(c =>
            c.id === conversationId ? {
                ...c,
                archived,
                version: data.version,
                updating: false
            } : c
        );

        // If filtering, reload conversations
        if ((currentFilter === 'archived' && !archived) ||
            (currentFilter !== 'archived' && archived)) {
            loadConversations(true);
        } else {
            renderConversations();
        }
    } catch (error) {
        // Reset updating flag in case of error
        conversations = conversations.map(c =>
            c.id === conversationId ? { ...c, updating: false } : c
        );
        renderConversations();

        // Use standardized error handling if available
        import('./displayManager.js').then(module => {
            if (module.handleConversationError) {
                module.handleConversationError(error, 'Failed to update conversation');
            } else {
                showNotification('Failed to update conversation', 'error');
            }
        }).catch(() => {
            showNotification('Failed to update conversation', 'error');
        });
    }
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
        if (!response.ok) throw new Error('Failed to delete conversation');

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
// Add window resize handler at the end of the file
window.addEventListener('resize', () => {
    const conversationsSidebar = document.getElementById('conversations-sidebar');
    if (conversationsSidebar) {
        if (window.innerWidth < 768) {
            conversationsSidebar.classList.add('hidden');
            const conversationsToggle = document.getElementById('conversations-toggle');
            if (conversationsToggle) {
                conversationsToggle.setAttribute('aria-expanded', 'false');
            }
        } else {
            conversationsSidebar.classList.remove('hidden');
            const conversationsToggle = document.getElementById('conversations-toggle');
            if (conversationsToggle) {
                conversationsToggle.setAttribute('aria-expanded', 'true');
            }
        }
    }
});
 // Add click listener for the conversations toggle button for mobile devices
 const conversationsToggleBtn = document.getElementById('conversations-toggle');
 if (conversationsToggleBtn) {
     conversationsToggleBtn.addEventListener('click', () => {
         const conversationsSidebar = document.getElementById('conversations-sidebar');
         if (conversationsSidebar) {
             const isHidden = conversationsSidebar.classList.contains('hidden');
             if (conversationsSidebar.classList.contains('sidebar-open')) {
                 conversationsSidebar.classList.remove('sidebar-open');
                 conversationsToggleBtn.setAttribute('aria-expanded', 'false');
             } else {
                 conversationsSidebar.classList.add('sidebar-open');
                 conversationsToggleBtn.setAttribute('aria-expanded', 'true');
             }
         }
     });
 }
const settingsIcon = document.getElementById('sidebar-toggle');
const settingsSidebar = document.getElementById('sidebar');
if (settingsIcon && settingsSidebar) {
    settingsIcon.addEventListener('click', () => {
        if (settingsSidebar.classList.contains('sidebar-open')) {
            settingsSidebar.classList.remove('sidebar-open');
        } else {
            settingsSidebar.classList.add('sidebar-open');
        }
    });
}

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

  // Clear or reset the UI if needed (for example clearing the conversation list in the sidebar)
  const conversationList = document.getElementById('conversation-list');
  if (conversationList) {
    conversationList.innerHTML = '';
  }

  console.log('[createAndSetupNewConversation] New conversation created with ID:', newSessionId);
  return newSessionId;
}
