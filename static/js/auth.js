// Authentication utilities for the Azure OpenAI Chat application

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

    // If token is invalid or expired, clear it and return false
    if (!data.valid) {
      console.log('Token validation failed:', data.reason);

      // Check if it's an expiration issue
      if (data.reason?.includes("expired")) {
        console.log('Token has expired. Redirecting to login page.');
      }

      // Clear both possible keys
      localStorage.removeItem('authToken');
      localStorage.removeItem('token');
      localStorage.removeItem('sessionId');
      localStorage.removeItem('userId');

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

/**
 * Check if a user requires password reset
 * @param {string} errorMessage - The error message from login attempt
 * @returns {boolean} True if user needs password reset, false otherwise
 */
export function requiresPasswordReset(errorMessage) {
  return (
    errorMessage.includes('requires password reset') ||
    errorMessage.includes('Account requires password reset')
  );
}

/**
 * Handle password reset request
 * @param {string} email - User's email address
 * @returns {Promise<boolean>} True if request was successful
 */
export async function requestPasswordReset(email) {
  try {
    const formData = new FormData();
    formData.append("email", email);

    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error("Failed to request password reset");
    }

    return true;
  } catch (error) {
    console.error("Password reset request error:", error);
    return false;
  }
}
