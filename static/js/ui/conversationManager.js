// A module for managing conversations in the sidebar
import { showNotification } from './notificationManager.js';
import { getSessionId, createNewConversation } from '../session.js';

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
    setupEventListeners();
    loadConversations();
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
        console.error('Error loading conversations:', error);
        conversationList.innerHTML = '<div class="py-4 px-3 text-center text-red-500">Failed to load conversations</div>';
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

    if (conversations.length === 0) {
        conversationList.innerHTML = '<div class="py-4 px-3 text-center text-dark-500 dark:text-dark-400">No conversations found</div>';
        return;
    }

    if (currentPage === 0) {
        conversationList.innerHTML = '';
    }

    // Get current conversation ID
    const currentSessionId = sessionStorage.getItem('sessionId');

    // Add conversation items
    conversations.forEach(conversation => {
        const isActive = conversation.id === currentSessionId;
        const date = new Date(conversation.updated_at);
        const formattedDate = date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
        });

        const item = document.createElement('div');
        item.className = `conversation-item p-3 border-b border-dark-200 dark:border-dark-700 cursor-pointer hover:bg-dark-100 dark:hover:bg-dark-700/50 relative ${isActive ? 'bg-dark-100 dark:bg-dark-700/50' : ''}`;
        item.setAttribute('data-id', conversation.id);

        item.innerHTML = `
      <div class="flex justify-between items-start mb-1">
        <h3 class="conversation-title text-sm font-medium truncate pr-16">${conversation.title || 'Untitled Conversation'}</h3>
        <div class="flex space-x-1">
          <button class="pin-conversation-btn p-1 text-dark-400 hover:text-primary-500 ${conversation.pinned ? 'pinned text-primary-500' : ''}" 
                  title="${conversation.pinned ? 'Unpin conversation' : 'Pin conversation'}">
            <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="${conversation.pinned ? 'currentColor' : 'none'}" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </button>
          <button class="archive-conversation-btn p-1 text-dark-400 hover:text-primary-500 ${conversation.archived ? 'archived text-primary-500' : ''}" 
                  title="${conversation.archived ? 'Unarchive conversation' : 'Archive conversation'}">
            <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
          </button>
          <button class="delete-conversation-btn p-1 text-dark-400 hover:text-red-500" title="Delete conversation">
            <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
      <div class="flex justify-between">
        <span class="text-xs text-dark-500">${conversation.message_count} message${conversation.message_count !== 1 ? 's' : ''}</span>
        <span class="text-xs text-dark-500">${formattedDate}</span>
      </div>
    `;

        conversationList.appendChild(item);
    });

    if (hasMoreConversations) {
        const loadMoreItem = document.createElement('div');
        loadMoreItem.className = 'text-center p-2 text-sm text-primary-500 hover:underline cursor-pointer';
        loadMoreItem.textContent = 'Load more';
        loadMoreItem.addEventListener('click', () => {
            currentPage++;
            loadConversations();
        });
        conversationList.appendChild(loadMoreItem);
    }
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
    try {
        const response = await fetch(`/api/chat/conversations/${conversationId}/pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pinned })
        });

        if (!response.ok) throw new Error('Failed to update conversation');

        // Update UI without reloading
        const button = document.querySelector(`.conversation-item[data-id="${conversationId}"] .pin-conversation-btn`);
        if (button) {
            if (pinned) {
                button.classList.add('pinned', 'text-primary-500');
                button.title = 'Unpin conversation';
            } else {
                button.classList.remove('pinned', 'text-primary-500');
                button.title = 'Pin conversation';
            }

            // Update the SVG fill
            const svg = button.querySelector('svg');
            if (svg) {
                svg.setAttribute('fill', pinned ? 'currentColor' : 'none');
            }
        }

        // If we're filtering by pinned, reload conversations
        if (currentFilter === 'pinned' && !pinned) {
            loadConversations(true);
        } else {
            // Update local data
            conversations = conversations.map(c =>
                c.id === conversationId ? { ...c, pinned } : c
            );
        }
    } catch (error) {
        console.error('Error updating conversation:', error);
        showNotification('Failed to update conversation', 'error');
    }
}

/**
 * Toggle archived status of a conversation
 * @param {string} conversationId - ID of the conversation
 * @param {boolean} archived - Whether to archive or unarchive
 */
async function toggleArchiveConversation(conversationId, archived) {
    try {
        const response = await fetch(`/api/chat/conversations/${conversationId}/archive`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ archived })
        });

        if (!response.ok) throw new Error('Failed to update conversation');

        // Update UI without reloading
        const button = document.querySelector(`.conversation-item[data-id="${conversationId}"] .archive-conversation-btn`);
        if (button) {
            if (archived) {
                button.classList.add('archived', 'text-primary-500');
                button.title = 'Unarchive conversation';
            } else {
                button.classList.remove('archived', 'text-primary-500');
                button.title = 'Archive conversation';
            }
        }

        // If filtering, reload conversations
        if ((currentFilter === 'archived' && !archived) ||
            (currentFilter !== 'archived' && archived)) {
            loadConversations(true);
        } else {
            // Update local data
            conversations = conversations.map(c =>
                c.id === conversationId ? { ...c, archived } : c
            );
        }
    } catch (error) {
        console.error('Error updating conversation:', error);
        showNotification('Failed to update conversation', 'error');
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
            const displayManagerModule = await import('./displayManager.js');
            await displayManagerModule.loadConversationFromDb();
        }

        showNotification('Conversation deleted', 'success');
    } catch (error) {
        console.error('Error deleting conversation:', error);
        showNotification('Failed to delete conversation', 'error');
    }
}

// Add API endpoints for pin/archive
export async function addPinAndArchiveEndpoints() {
    try {
        // Make POST request to API to add missing endpoints
        const response = await fetch('/api/admin/add_conversation_endpoints', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: 'development_setup_2034'
            })
        });

        if (response.ok) {
            console.log('Conversation endpoints added successfully');
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error adding conversation endpoints:', error);
        return false;
    }
}