/**
 * Authentication utilities for the Azure OpenAI Chat application
 */

/**
 * Logout the current user by clearing authentication data and redirecting to login
 */
export function logout() {
  // Clear all authentication data from local storage
  localStorage.removeItem('token');
  localStorage.removeItem('sessionId');
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
  const token = localStorage.getItem('token');
  
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
    
    // If token is invalid, clear it and return false
    if (!data.valid) {
      console.log('Token validation failed:', data.reason);
      localStorage.removeItem('token');
      return false;
    }
    
    // Token is valid
    console.log('Authentication valid for user:', data.user_id);
    return true;
    
  } catch (error) {
    // Error during validation
    console.error('Error validating token:', error);
    return false;
  }
}
