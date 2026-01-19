// CofFeEL Kiosk Interface JavaScript

const API_BASE = '/api';
let users = [];
let filteredUsers = [];
let searchDebounceTimer = null;
let actionInProgress = new Set();

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadUsers();
  setupEventListeners();
});

// Setup Event Listeners
function setupEventListeners() {
  // Add user button
  document.getElementById('add-user-btn').addEventListener('click', openAddUserModal);
  
  // Search input with debounce (150ms per WARP.md)
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      filterUsers(e.target.value);
    }, 150);
  });
  
  // Add user form
  document.getElementById('add-user-form').addEventListener('submit', handleAddUser);
}

// Load Users from API
async function loadUsers() {
  showLoadingState();
  
  try {
    const response = await fetch(`${API_BASE}/users`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch users');
    }
    
    users = await response.json();
    filteredUsers = [...users];
    
    renderUsers();
  } catch (error) {
    console.error('Error loading users:', error);
    showToast('Failed to load users', 'error');
    hideLoadingState();
  }
}

// Filter Users
function filterUsers(searchTerm) {
  const term = searchTerm.toLowerCase().trim();
  
  if (!term) {
    filteredUsers = [...users];
  } else {
    filteredUsers = users.filter(user => {
      const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
      const email = user.email.toLowerCase();
      return fullName.includes(term) || email.includes(term);
    });
  }
  
  renderUsers();
}

// Render Users Grid
function renderUsers() {
  const container = document.getElementById('users-list');
  const loadingState = document.getElementById('loading-state');
  const emptyState = document.getElementById('empty-state');
  
  loadingState.style.display = 'none';
  
  if (filteredUsers.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }
  
  emptyState.style.display = 'none';
  
  container.innerHTML = filteredUsers.map(user => createUserCard(user)).join('');
  
  // Attach event listeners to buttons
  filteredUsers.forEach(user => {
    attachUserCardListeners(user.id);
  });
}

// Create User Card HTML
function createUserCard(user) {
  const balance = user.accountBalance || 0;
  const balanceClass = balance < 0 ? 'negative' : balance > 0 ? 'positive' : '';
  const balanceSign = balance > 0 ? '+' : '';
  const payDisabled = user.coffeeCount === 0 ? 'disabled' : '';
  
  return `
    <div class="user-card" data-user-id="${user.id}">
      <div class="user-card-header">
        <div class="user-info">
          <div class="user-name">${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}</div>
          <div class="user-email">${escapeHtml(user.email)}</div>
        </div>
        <button class="user-delete" data-action="delete" aria-label="Delete user">
          🗑️
        </button>
      </div>
      
      <div class="user-stats">
        <div class="stat">
          <div class="stat-label">Coffees</div>
          <div class="stat-value">${user.coffeeCount}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Balance</div>
          <div class="stat-value ${balanceClass}">
            ${balanceSign}€${Math.abs(balance).toFixed(2)}
          </div>
        </div>
      </div>
      
      <div class="user-actions">
        <button class="btn btn-decrement" data-action="decrement" aria-label="Remove one coffee">
          −
        </button>
        <button class="btn btn-pay btn-success" data-action="pay" ${payDisabled}>
          Pay
        </button>
        <button class="btn btn-increment" data-action="increment" aria-label="Add one coffee">
          +
        </button>
      </div>
    </div>
  `;
}

// Attach Event Listeners to User Card Buttons
function attachUserCardListeners(userId) {
  const card = document.querySelector(`[data-user-id="${userId}"]`);
  if (!card) return;
  
  const buttons = card.querySelectorAll('[data-action]');
  buttons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const action = btn.dataset.action;
      handleUserAction(userId, action);
    });
  });
}

// Handle User Actions (increment, decrement, pay, delete)
async function handleUserAction(userId, action) {
  // Prevent double-clicks (300ms debounce per WARP.md)
  const actionKey = `${userId}-${action}`;
  if (actionInProgress.has(actionKey)) return;
  actionInProgress.add(actionKey);
  
  setTimeout(() => actionInProgress.delete(actionKey), 300);
  
  try {
    switch (action) {
      case 'increment':
        await incrementCoffee(userId);
        break;
      case 'decrement':
        await decrementCoffee(userId);
        break;
      case 'pay':
        await requestPayment(userId);
        break;
      case 'delete':
        openConfirmDeleteModal(userId);
        break;
    }
  } catch (error) {
    console.error(`Error handling ${action}:`, error);
    showToast(`Failed to ${action}`, 'error');
  }
}

// Increment Coffee Count
async function incrementCoffee(userId) {
  // Optimistic update
  updateUserOptimistic(userId, user => ({
    ...user,
    coffeeCount: user.coffeeCount + 1
  }));
  
  try {
    const response = await fetch(`${API_BASE}/users/${userId}/increment`, {
      method: 'POST'
    });
    
    if (!response.ok) {
      throw new Error('Failed to increment');
    }
    
    const updatedUser = await response.json();
    updateUserInState(userId, updatedUser);
    renderUsers();
  } catch (error) {
    // Rollback on error
    await loadUsers();
    throw error;
  }
}

// Decrement Coffee Count
async function decrementCoffee(userId) {
  const user = users.find(u => u.id === userId);
  if (!user || user.coffeeCount === 0) return;
  
  // Optimistic update
  updateUserOptimistic(userId, user => ({
    ...user,
    coffeeCount: Math.max(0, user.coffeeCount - 1)
  }));
  
  try {
    const response = await fetch(`${API_BASE}/users/${userId}/decrement`, {
      method: 'POST'
    });
    
    if (!response.ok) {
      throw new Error('Failed to decrement');
    }
    
    const updatedUser = await response.json();
    updateUserInState(userId, updatedUser);
    renderUsers();
  } catch (error) {
    // Rollback on error
    await loadUsers();
    throw error;
  }
}

// Request Payment
async function requestPayment(userId) {
  const user = users.find(u => u.id === userId);
  if (!user || user.coffeeCount === 0) return;
  
  // Optimistic update
  updateUserOptimistic(userId, user => ({
    ...user,
    coffeeCount: 0
  }));
  
  try {
    const response = await fetch(`${API_BASE}/users/${userId}/pay`, {
      method: 'POST'
    });
    
    if (!response.ok) {
      throw new Error('Failed to send payment request');
    }
    
    const result = await response.json();
    updateUserInState(userId, result);
    renderUsers();
    
    if (result.emailSent) {
      showToast(result.message, 'success');
    } else if (result.emailError) {
      showToast('Payment recorded but email failed to send', 'warning');
    } else {
      showToast(result.message, 'success');
    }
  } catch (error) {
    // Rollback on error
    await loadUsers();
    showToast('Failed to process payment request', 'error');
    throw error;
  }
}

// Delete User (Soft Delete)
async function deleteUser(userId) {
  try {
    const response = await fetch(`${API_BASE}/users/${userId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Failed to delete user');
    }
    
    // Remove from local state
    users = users.filter(u => u.id !== userId);
    filterUsers(document.getElementById('search-input').value);
    
    showToast('User removed successfully', 'success');
    closeConfirmDeleteModal();
  } catch (error) {
    console.error('Error deleting user:', error);
    showToast('Failed to remove user', 'error');
    throw error;
  }
}

// Optimistic Update Helper
function updateUserOptimistic(userId, updateFn) {
  const index = users.findIndex(u => u.id === userId);
  if (index !== -1) {
    users[index] = updateFn(users[index]);
    filterUsers(document.getElementById('search-input').value);
  }
}

// Update User in State
function updateUserInState(userId, updatedData) {
  const index = users.findIndex(u => u.id === userId);
  if (index !== -1) {
    users[index] = { ...users[index], ...updatedData };
  }
}

// Add User Modal
function openAddUserModal() {
  document.getElementById('add-user-modal').style.display = 'flex';
  document.getElementById('first-name').focus();
  clearFormErrors();
}

function closeAddUserModal() {
  document.getElementById('add-user-modal').style.display = 'none';
  document.getElementById('add-user-form').reset();
  clearFormErrors();
}

// Handle Add User Form
async function handleAddUser(e) {
  e.preventDefault();
  clearFormErrors();
  
  const formData = new FormData(e.target);
  const userData = {
    firstName: formData.get('firstName').trim(),
    lastName: formData.get('lastName').trim(),
    email: formData.get('email').trim().toLowerCase()
  };
  
  // Client-side validation
  const errors = validateUserData(userData);
  if (Object.keys(errors).length > 0) {
    displayFormErrors(errors);
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(userData)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to add user');
    }
    
    const newUser = await response.json();
    users.push(newUser);
    filterUsers(document.getElementById('search-input').value);
    
    closeAddUserModal();
    showToast('User added successfully', 'success');
    
    // Scroll to new user
    setTimeout(() => {
      const card = document.querySelector(`[data-user-id="${newUser.id}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 100);
  } catch (error) {
    console.error('Error adding user:', error);
    showToast(error.message, 'error');
  }
}

// Validate User Data
function validateUserData(data) {
  const errors = {};
  
  if (!data.firstName || data.firstName.length < 2) {
    errors.firstName = 'First name must be at least 2 characters';
  }
  
  if (!data.lastName || data.lastName.length < 2) {
    errors.lastName = 'Last name must be at least 2 characters';
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!data.email || !emailRegex.test(data.email)) {
    errors.email = 'Invalid email address';
  }
  
  return errors;
}

// Display Form Errors
function displayFormErrors(errors) {
  Object.keys(errors).forEach(field => {
    const input = document.getElementById(field.replace(/([A-Z])/g, '-$1').toLowerCase());
    const errorSpan = document.getElementById(`${field.replace(/([A-Z])/g, '-$1').toLowerCase()}-error`);
    
    if (input && errorSpan) {
      input.classList.add('error');
      errorSpan.textContent = errors[field];
    }
  });
}

// Clear Form Errors
function clearFormErrors() {
  document.querySelectorAll('.form-error').forEach(el => el.textContent = '');
  document.querySelectorAll('.form-group input').forEach(el => el.classList.remove('error'));
}

// Confirm Delete Modal
function openConfirmDeleteModal(userId) {
  const user = users.find(u => u.id === userId);
  if (!user) return;
  
  document.getElementById('delete-user-name').textContent = `${user.firstName} ${user.lastName}`;
  document.getElementById('confirm-delete-modal').style.display = 'flex';
  
  // Set up confirm button
  const confirmBtn = document.getElementById('confirm-delete-btn');
  confirmBtn.onclick = () => deleteUser(userId);
}

function closeConfirmDeleteModal() {
  document.getElementById('confirm-delete-modal').style.display = 'none';
}

// Toast Notification
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const messageEl = document.getElementById('toast-message');
  
  messageEl.textContent = message;
  toast.className = `toast ${type}`;
  toast.style.display = 'block';
  
  // Auto-dismiss after 3 seconds (per WARP.md)
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

// Loading State
function showLoadingState() {
  document.getElementById('loading-state').style.display = 'flex';
  document.getElementById('users-list').innerHTML = '';
  document.getElementById('empty-state').style.display = 'none';
}

function hideLoadingState() {
  document.getElementById('loading-state').style.display = 'none';
}

// Utility: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Make modal close functions globally accessible
window.closeAddUserModal = closeAddUserModal;
window.closeConfirmDeleteModal = closeConfirmDeleteModal;
