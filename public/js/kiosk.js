/**
 * CofFeEL Kiosk Interface
 * Vanilla JavaScript for touch-optimized iPad interface
 */

// ============================================
// State
// ============================================

let users = [];
let filteredUsers = [];
let searchQuery = '';
let debounceTimer = null;
let buttonDebounceTimers = {};

// ============================================
// DOM Elements
// ============================================

const elements = {
  userList: document.getElementById('userList'),
  loading: document.getElementById('loading'),
  emptyState: document.getElementById('emptyState'),
  searchInput: document.getElementById('searchInput'),
  addUserBtn: document.getElementById('addUserBtn'),
  addUserModal: document.getElementById('addUserModal'),
  addUserForm: document.getElementById('addUserForm'),
  closeAddUserModal: document.getElementById('closeAddUserModal'),
  cancelAddUser: document.getElementById('cancelAddUser'),
  confirmModal: document.getElementById('confirmModal'),
  confirmTitle: document.getElementById('confirmTitle'),
  confirmMessage: document.getElementById('confirmMessage'),
  confirmDetails: document.getElementById('confirmDetails'),
  confirmCancel: document.getElementById('confirmCancel'),
  confirmOk: document.getElementById('confirmOk'),
  toastContainer: document.getElementById('toastContainer'),
};

// ============================================
// API Functions
// ============================================

const api = {
  baseUrl: '/api',

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const response = await fetch(url, { ...defaultOptions, ...options });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  },

  // Users
  getUsers() {
    return this.request('/users');
  },

  createUser(userData) {
    return this.request('/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  },

  deleteUser(userId) {
    return this.request(`/users/${userId}`, {
      method: 'DELETE',
    });
  },

  // Coffee
  incrementCoffee(userId) {
    return this.request(`/users/${userId}/increment`, {
      method: 'POST',
    });
  },

  decrementCoffee(userId) {
    return this.request(`/users/${userId}/decrement`, {
      method: 'POST',
    });
  },

  // Payment
  requestPayment(userId) {
    return this.request(`/users/${userId}/pay`, {
      method: 'POST',
    });
  },
};

// ============================================
// Render Functions
// ============================================

function renderUserList() {
  const usersToRender = filteredUsers.length > 0 || searchQuery ? filteredUsers : users;

  elements.loading.style.display = 'none';

  if (usersToRender.length === 0) {
    elements.userList.innerHTML = '';
    elements.emptyState.style.display = 'flex';
    return;
  }

  elements.emptyState.style.display = 'none';
  elements.userList.innerHTML = usersToRender.map(renderUserCard).join('');

  // Attach event listeners
  attachUserCardListeners();
}

function renderUserCard(user) {
  const statusBadges = [];

  // Pending payment badge
  if (user.pendingPayment > 0) {
    statusBadges.push(`
      <span class="status-badge status-pending">
        💰 Pending: €${user.pendingPayment.toFixed(2)}
      </span>
    `);
  }

  // Credit badge
  if (user.accountBalance > 0) {
    statusBadges.push(`
      <span class="status-badge status-credit">
        ✅ Credit: €${user.accountBalance.toFixed(2)}
      </span>
    `);
  }

  // Debt badge
  if (user.accountBalance < 0) {
    statusBadges.push(`
      <span class="status-badge status-debt">
        ⚠️ Debt: €${Math.abs(user.accountBalance).toFixed(2)}
      </span>
    `);
  }

  return `
    <div class="user-card" data-user-id="${user.id}">
      <div class="user-info">
        <div class="user-name">${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}</div>
        <div class="user-email">${escapeHtml(user.email)}</div>
        ${statusBadges.length > 0 ? `<div class="user-status">${statusBadges.join('')}</div>` : ''}
      </div>
      <div class="user-actions">
        <div class="coffee-counter">
          <button class="btn btn-counter btn-minus" data-action="decrement" data-user-id="${user.id}" ${user.coffeeCount <= 0 ? 'disabled' : ''}>
            −
          </button>
          <span class="coffee-count">${user.coffeeCount}</span>
          <button class="btn btn-counter btn-plus" data-action="increment" data-user-id="${user.id}">
            +
          </button>
        </div>
        <div class="action-buttons">
          <button class="btn btn-pay" data-action="pay" data-user-id="${user.id}" ${user.coffeeCount <= 0 ? 'disabled' : ''}>
            Pay
          </button>
          <button class="btn btn-delete" data-action="delete" data-user-id="${user.id}" title="Delete">
            🗑️
          </button>
        </div>
      </div>
    </div>
  `;
}

function updateUserCard(userId, updates) {
  const user = users.find(u => u.id === userId);
  if (!user) return;

  // Update user data
  Object.assign(user, updates);

  // Re-render just this card
  const card = elements.userList.querySelector(`[data-user-id="${userId}"]`);
  if (card) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = renderUserCard(user);
    card.replaceWith(tempDiv.firstElementChild);
    attachUserCardListeners();
  }
}

// ============================================
// Event Handlers
// ============================================

function attachUserCardListeners() {
  // Increment/Decrement buttons
  elements.userList.querySelectorAll('[data-action="increment"], [data-action="decrement"]').forEach(btn => {
    btn.addEventListener('click', handleCoffeeChange);
  });

  // Pay buttons
  elements.userList.querySelectorAll('[data-action="pay"]').forEach(btn => {
    btn.addEventListener('click', handlePayClick);
  });

  // Delete buttons
  elements.userList.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', handleDeleteClick);
  });
}

async function handleCoffeeChange(e) {
  const btn = e.currentTarget;
  const userId = parseInt(btn.dataset.userId, 10);
  const action = btn.dataset.action;

  // Debounce to prevent double-clicks (300ms)
  const debounceKey = `${action}-${userId}`;
  if (buttonDebounceTimers[debounceKey]) return;

  buttonDebounceTimers[debounceKey] = true;
  setTimeout(() => {
    delete buttonDebounceTimers[debounceKey];
  }, 300);

  // Optimistic UI update
  const user = users.find(u => u.id === userId);
  if (!user) return;

  const oldCount = user.coffeeCount;
  const newCount = action === 'increment' ? oldCount + 1 : Math.max(0, oldCount - 1);

  updateUserCard(userId, { coffeeCount: newCount });

  try {
    const result = action === 'increment'
      ? await api.incrementCoffee(userId)
      : await api.decrementCoffee(userId);

    // Update with server response
    updateUserCard(userId, {
      coffeeCount: result.coffeeCount,
      accountBalance: result.accountBalance,
    });
  } catch (error) {
    // Rollback on error
    updateUserCard(userId, { coffeeCount: oldCount });
    showToast(error.message, 'error');
  }
}

async function handlePayClick(e) {
  const btn = e.currentTarget;
  const userId = parseInt(btn.dataset.userId, 10);
  const user = users.find(u => u.id === userId);

  if (!user || user.coffeeCount <= 0) return;

  // Calculate amount (rough estimate for confirmation)
  const coffeePrice = 0.50; // Default, will be calculated server-side
  const estimatedAmount = (user.coffeeCount * coffeePrice).toFixed(2);

  showConfirmDialog({
    title: 'Confirm Payment Request',
    message: `Send payment request for ${user.coffeeCount} coffee(s)?`,
    details: `Estimated amount: €${estimatedAmount}`,
    confirmText: 'Send Request',
    onConfirm: async () => {
      try {
        btn.disabled = true;
        const result = await api.requestPayment(userId);

        updateUserCard(userId, {
          coffeeCount: result.coffeeCount,
          pendingPayment: result.pendingPayment,
          accountBalance: result.accountBalance,
        });

        showToast(result.message, result.emailSent ? 'success' : 'warning');
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        btn.disabled = false;
      }
    },
  });
}

async function handleDeleteClick(e) {
  const btn = e.currentTarget;
  const userId = parseInt(btn.dataset.userId, 10);
  const user = users.find(u => u.id === userId);

  if (!user) return;

  const details = user.coffeeCount > 0
    ? `Outstanding coffees: ${user.coffeeCount} (not yet paid)`
    : '';

  showConfirmDialog({
    title: 'Delete Entry?',
    message: 'Do you really want to delete your entry?',
    details: details + (details ? '\n' : '') + 'You can ask the admin to restore it later.',
    confirmText: 'Delete',
    danger: true,
    onConfirm: async () => {
      try {
        await api.deleteUser(userId);

        // Remove from local state
        users = users.filter(u => u.id !== userId);
        filterUsers();

        showToast('Your entry has been removed', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    },
  });
}

function handleSearch(e) {
  const query = e.target.value.trim().toLowerCase();

  // Debounce search (150ms)
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    searchQuery = query;
    filterUsers();
  }, 150);
}

function filterUsers() {
  if (!searchQuery) {
    filteredUsers = [];
  } else {
    filteredUsers = users.filter(user => {
      const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
      const email = user.email.toLowerCase();
      return fullName.includes(searchQuery) || email.includes(searchQuery);
    });
  }
  renderUserList();
}

// ============================================
// Modal Functions
// ============================================

function openAddUserModal() {
  elements.addUserForm.reset();
  clearFormErrors();
  elements.addUserModal.classList.add('active');
  elements.addUserForm.querySelector('#firstName').focus();
}

function closeAddUserModal() {
  elements.addUserModal.classList.remove('active');
}

async function handleAddUserSubmit(e) {
  e.preventDefault();

  const formData = new FormData(e.target);
  const userData = {
    firstName: formData.get('firstName').trim(),
    lastName: formData.get('lastName').trim(),
    email: formData.get('email').trim().toLowerCase(),
  };

  // Client-side validation
  clearFormErrors();
  let hasErrors = false;

  if (userData.firstName.length < 2) {
    showFormError('firstName', 'First name must be at least 2 characters');
    hasErrors = true;
  }

  if (userData.lastName.length < 2) {
    showFormError('lastName', 'Last name must be at least 2 characters');
    hasErrors = true;
  }

  if (!isValidEmail(userData.email)) {
    showFormError('email', 'Please enter a valid email address');
    hasErrors = true;
  }

  if (hasErrors) return;

  try {
    const newUser = await api.createUser(userData);

    // Add to local state and re-sort
    users.push(newUser);
    users.sort((a, b) => {
      const lastNameCompare = a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' });
      if (lastNameCompare !== 0) return lastNameCompare;
      return a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' });
    });

    filterUsers();
    closeAddUserModal();
    showToast(`${newUser.firstName} ${newUser.lastName} added successfully`, 'success');
  } catch (error) {
    if (error.message.includes('Email already exists')) {
      showFormError('email', 'This email is already registered');
    } else {
      showToast(error.message, 'error');
    }
  }
}

function showFormError(field, message) {
  const input = document.getElementById(field);
  const error = document.getElementById(`${field}Error`);
  if (input) input.classList.add('error');
  if (error) error.textContent = message;
}

function clearFormErrors() {
  ['firstName', 'lastName', 'email'].forEach(field => {
    const input = document.getElementById(field);
    const error = document.getElementById(`${field}Error`);
    if (input) input.classList.remove('error');
    if (error) error.textContent = '';
  });
}

// ============================================
// Confirm Dialog
// ============================================

let confirmCallback = null;

function showConfirmDialog({ title, message, details, confirmText = 'Confirm', danger = false, onConfirm }) {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmDetails.textContent = details || '';
  elements.confirmDetails.style.display = details ? 'block' : 'none';
  elements.confirmOk.textContent = confirmText;
  elements.confirmOk.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  confirmCallback = onConfirm;
  elements.confirmModal.classList.add('active');
}

function closeConfirmDialog() {
  elements.confirmModal.classList.remove('active');
  confirmCallback = null;
}

function handleConfirmOk() {
  if (confirmCallback) {
    confirmCallback();
  }
  closeConfirmDialog();
}

// ============================================
// Toast Notifications
// ============================================

function showToast(message, type = 'info') {
  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type]}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;

  elements.toastContainer.appendChild(toast);

  // Auto-dismiss after 3 seconds
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

// ============================================
// Utility Functions
// ============================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// ============================================
// Initialization
// ============================================

async function init() {
  // Event listeners
  elements.searchInput.addEventListener('input', handleSearch);
  elements.addUserBtn.addEventListener('click', openAddUserModal);
  elements.closeAddUserModal.addEventListener('click', closeAddUserModal);
  elements.cancelAddUser.addEventListener('click', closeAddUserModal);
  elements.addUserForm.addEventListener('submit', handleAddUserSubmit);
  elements.confirmCancel.addEventListener('click', closeConfirmDialog);
  elements.confirmOk.addEventListener('click', handleConfirmOk);

  // Close modals on overlay click
  elements.addUserModal.addEventListener('click', (e) => {
    if (e.target === elements.addUserModal) closeAddUserModal();
  });
  elements.confirmModal.addEventListener('click', (e) => {
    if (e.target === elements.confirmModal) closeConfirmDialog();
  });

  // Load initial data
  try {
    users = await api.getUsers();
    renderUserList();
  } catch (error) {
    elements.loading.style.display = 'none';
    showToast('Failed to load users: ' + error.message, 'error');
  }
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
