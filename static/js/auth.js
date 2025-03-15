/**
 * Authentication utilities for the Azure OpenAI Chat application
 */

/**
 * Logout the current user by clearing authentication data and redirecting to login
 */
export function logout() {
  // Clear all authentication data from local storage
  // Align key names with chat.js usage
  localStorage.removeItem('authToken');
  localStorage.removeItem('activeConversationId');
  localStorage.removeItem('userId');
  
  // Optionally show a logout notification
  console.log('User logged out successfully');
  
  // Redirect to login page
  window.location.href = '/static/login.html';
}

/**
 * Validate the current authentication token with the server
 * @returns {Promise<boolean>} True if token is valid, false otherwise
 */
export async function validateToken() {
  // Check BOTH possible token locations
  const token = localStorage.getItem('authToken') || localStorage.getItem('token');

  // If no token exists, return false immediately
  if (!token) {
    return false;
  }

  try {
    // Call the token validation endpoint
    const response = await fetch('/api/auth/validate-token', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    // Parse the response
    const data = await response.json();

    // If token is invalid, clear both possible keys and return false
    if (!data.valid) {
      console.log('Token validation failed:', data.reason);
      localStorage.removeItem('authToken');
      localStorage.removeItem('token');
      return false;
    }

    // Ensure token is stored consistently with a single key name
    if (token && !localStorage.getItem('authToken')) {
      localStorage.setItem('authToken', token);
    }

    return true;
  } catch (error) {
    console.error('Error validating token:', error);
    return false;
  }
}
