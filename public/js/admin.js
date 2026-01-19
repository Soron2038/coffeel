/**
 * CofFeEL Admin Panel
 * Vanilla JavaScript for admin management interface
 */

// ============================================
// State
// ============================================

let allUsers = [];
let activeUsers = [];
let deletedUsers = [];
let payments = [];
let settings = {};
let currentPaymentUserId = null;
let currentAdjustUserId = null;
let genericConfirmCallback = null;

// ============================================
// DOM Elements
// ============================================

const elements = {
  // Navigation
  navTabs: document.querySelectorAll('.nav-tab'),
  tabContents: document.querySelectorAll('.tab-content'),

  // Summary
  totalUsers: document.getElementById('totalUsers'),
  totalPending: document.getElementById('totalPending'),
  totalCredit: document.getElementById('totalCredit'),
  totalDebt: document.getElementById('totalDebt'),

  // Tables
  activeUsersBody: document.getElementById('activeUsersBody'),
  deletedUsersBody: document.getElementById('deletedUsersBody'),
  paymentsBody: document.getElementById('paymentsBody'),
  noDeletedUsers: document.getElementById('noDeletedUsers'),
  noPayments: document.getElementById('noPayments'),

  // Filters
  filterType: document.getElementById('filterType'),
  filterStartDate: document.getElementById('filterStartDate'),
  filterEndDate: document.getElementById('filterEndDate'),
  applyFilters: document.getElementById('applyFilters'),
  clearFilters: document.getElementById('clearFilters'),

  // Settings
  settingsForm: document.getElementById('settingsForm'),
  coffeePrice: document.getElementById('coffeePrice'),
  bankOwner: document.getElementById('bankOwner'),
  bankIban: document.getElementById('bankIban'),
  bankBic: document.getElementById('bankBic'),
  adminEmail: document.getElementById('adminEmail'),

  // Export
  exportCsvBtn: document.getElementById('exportCsvBtn'),

  // Payment Modal
  confirmPaymentModal: document.getElementById('confirmPaymentModal'),
  closePaymentModal: document.getElementById('closePaymentModal'),
  paymentUserInfo: document.getElementById('paymentUserInfo'),
  paymentAmount: document.getElementById('paymentAmount'),
  paymentNotes: document.getElementById('paymentNotes'),
  cancelPayment: document.getElementById('cancelPayment'),
  submitPayment: document.getElementById('submitPayment'),

  // Adjust Modal
  adjustCoffeeModal: document.getElementById('adjustCoffeeModal'),
  closeAdjustModal: document.getElementById('closeAdjustModal'),
  adjustUserInfo: document.getElementById('adjustUserInfo'),
  newCoffeeCount: document.getElementById('newCoffeeCount'),
  cancelAdjust: document.getElementById('cancelAdjust'),
  submitAdjust: document.getElementById('submitAdjust'),

  // Generic Confirm Modal
  confirmModal: document.getElementById('confirmModal'),
  genericConfirmTitle: document.getElementById('genericConfirmTitle'),
  genericConfirmMessage: document.getElementById('genericConfirmMessage'),
  genericConfirmCancel: document.getElementById('genericConfirmCancel'),
  genericConfirmOk: document.getElementById('genericConfirmOk'),

  // Toast
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
      headers: { 'Content-Type': 'application/json' },
    };

    const response = await fetch(url, { ...defaultOptions, ...options });
    
    if (response.status === 401) {
      throw new Error('Unauthorized - please log in again');
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  },

  // Users
  getUsers(includeDeleted = true) {
    return this.request(`/users?includeDeleted=${includeDeleted}`);
  },

  restoreUser(userId) {
    return this.request(`/users/${userId}/restore`, { method: 'POST' });
  },

  deleteUserPermanent(userId) {
    return this.request(`/users/${userId}/permanent`, { method: 'DELETE' });
  },

  setCoffeeCount(userId, count) {
    return this.request(`/users/${userId}/coffee-count`, {
      method: 'PUT',
      body: JSON.stringify({ count }),
    });
  },

  requestPayment(userId) {
    return this.request(`/users/${userId}/pay`, { method: 'POST' });
  },

  confirmPayment(userId, amount, notes) {
    return this.request(`/users/${userId}/confirm-payment`, {
      method: 'POST',
      body: JSON.stringify({ amount, notes }),
    });
  },

  // Payments
  getPayments(filters = {}) {
    const params = new URLSearchParams();
    if (filters.type) params.append('type', filters.type);
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);
    return this.request(`/payments?${params.toString()}`);
  },

  getPaymentSummary() {
    return this.request('/payments/summary');
  },

  // Settings
  getSettings() {
    return this.request('/settings');
  },

  updateSetting(key, value) {
    return this.request(`/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  },
};

// ============================================
// Tab Navigation
// ============================================

function switchTab(tabId) {
  elements.navTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabId);
  });

  elements.tabContents.forEach(content => {
    content.classList.toggle('active', content.id === tabId);
  });

  // Load data for the tab
  if (tabId === 'payments') {
    loadPayments();
  } else if (tabId === 'settings') {
    loadSettings();
  }
}

// ============================================
// Data Loading
// ============================================

async function loadUsers() {
  try {
    allUsers = await api.getUsers(true);
    activeUsers = allUsers.filter(u => !u.deletedByUser);
    deletedUsers = allUsers.filter(u => u.deletedByUser);

    renderActiveUsers();
    renderDeletedUsers();
    updateSummary();
  } catch (error) {
    showToast('Failed to load users: ' + error.message, 'error');
  }
}

async function loadPayments() {
  try {
    const filters = {
      type: elements.filterType.value || undefined,
      startDate: elements.filterStartDate.value || undefined,
      endDate: elements.filterEndDate.value || undefined,
    };

    payments = await api.getPayments(filters);
    renderPayments();
  } catch (error) {
    showToast('Failed to load payments: ' + error.message, 'error');
  }
}

async function loadSettings() {
  try {
    settings = await api.getSettings();
    populateSettingsForm();
  } catch (error) {
    showToast('Failed to load settings: ' + error.message, 'error');
  }
}

function updateSummary() {
  elements.totalUsers.textContent = activeUsers.length;

  const totalPending = activeUsers.reduce((sum, u) => sum + u.pendingPayment, 0);
  elements.totalPending.textContent = `€${totalPending.toFixed(2)}`;

  const totalCredit = activeUsers
    .filter(u => u.accountBalance > 0)
    .reduce((sum, u) => sum + u.accountBalance, 0);
  elements.totalCredit.textContent = `€${totalCredit.toFixed(2)}`;

  const totalDebt = activeUsers
    .filter(u => u.accountBalance < 0)
    .reduce((sum, u) => sum + Math.abs(u.accountBalance), 0);
  elements.totalDebt.textContent = `€${totalDebt.toFixed(2)}`;
}

// ============================================
// Render Functions
// ============================================

function renderActiveUsers() {
  if (activeUsers.length === 0) {
    elements.activeUsersBody.innerHTML = '<tr><td colspan="7" class="empty-message">No active users found.</td></tr>';
    return;
  }

  elements.activeUsersBody.innerHTML = activeUsers.map(user => `
    <tr data-user-id="${user.id}">
      <td><strong>${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}</strong></td>
      <td>${escapeHtml(user.email)}</td>
      <td>${user.coffeeCount}</td>
      <td class="${user.pendingPayment > 0 ? 'pending-amount' : ''}">
        ${user.pendingPayment > 0 ? `€${user.pendingPayment.toFixed(2)}` : '-'}
      </td>
      <td class="${getBalanceClass(user.accountBalance)}">
        ${formatBalance(user.accountBalance)}
      </td>
      <td>${user.lastPaymentRequest ? formatDate(user.lastPaymentRequest) : '-'}</td>
      <td>
        <div class="action-btns">
          <button class="btn btn-success btn-sm" onclick="openPaymentModal(${user.id})" ${user.pendingPayment <= 0 && user.coffeeCount <= 0 ? 'disabled' : ''}>
            Confirm Payment
          </button>
          <button class="btn btn-outline btn-sm" onclick="openAdjustModal(${user.id})">
            Adjust
          </button>
          ${user.coffeeCount > 0 ? `
            <button class="btn btn-warning btn-sm" onclick="sendPaymentRequest(${user.id})">
              Send Request
            </button>
          ` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function renderDeletedUsers() {
  if (deletedUsers.length === 0) {
    elements.deletedUsersBody.innerHTML = '';
    elements.noDeletedUsers.style.display = 'block';
    return;
  }

  elements.noDeletedUsers.style.display = 'none';
  elements.deletedUsersBody.innerHTML = deletedUsers.map(user => `
    <tr data-user-id="${user.id}">
      <td><strong>${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}</strong></td>
      <td>${escapeHtml(user.email)}</td>
      <td>${user.coffeeCount}</td>
      <td class="${user.pendingPayment > 0 ? 'pending-amount' : ''}">
        ${user.pendingPayment > 0 ? `€${user.pendingPayment.toFixed(2)}` : '-'}
      </td>
      <td class="${getBalanceClass(user.accountBalance)}">
        ${formatBalance(user.accountBalance)}
      </td>
      <td>${user.deletedAt ? formatDate(user.deletedAt) : '-'}</td>
      <td>
        <div class="action-btns">
          <button class="btn btn-primary btn-sm" onclick="restoreUser(${user.id})">
            Restore
          </button>
          <button class="btn btn-success btn-sm" onclick="openPaymentModal(${user.id})" ${user.pendingPayment <= 0 ? 'disabled' : ''}>
            Confirm Payment
          </button>
          <button class="btn btn-danger btn-sm" onclick="confirmPermanentDelete(${user.id})">
            Delete
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderPayments() {
  if (payments.length === 0) {
    elements.paymentsBody.innerHTML = '';
    elements.noPayments.style.display = 'block';
    return;
  }

  elements.noPayments.style.display = 'none';
  elements.paymentsBody.innerHTML = payments.map(payment => `
    <tr>
      <td>${formatDate(payment.createdAt)}</td>
      <td>
        <strong>${escapeHtml(payment.userName)}</strong>
        <br><small>${escapeHtml(payment.userEmail)}</small>
      </td>
      <td>
        <span class="type-badge type-${payment.type}">
          ${payment.type === 'request' ? 'Request' : 'Received'}
        </span>
      </td>
      <td>€${payment.amount.toFixed(2)}</td>
      <td>${payment.coffeeCount || '-'}</td>
      <td>${payment.adminNotes ? escapeHtml(payment.adminNotes) : '-'}</td>
    </tr>
  `).join('');
}

function populateSettingsForm() {
  if (settings.coffee_price) elements.coffeePrice.value = settings.coffee_price.value;
  if (settings.bank_owner) elements.bankOwner.value = settings.bank_owner.value;
  if (settings.bank_iban) elements.bankIban.value = settings.bank_iban.value;
  if (settings.bank_bic) elements.bankBic.value = settings.bank_bic.value;
  if (settings.admin_email) elements.adminEmail.value = settings.admin_email.value;
}

// ============================================
// User Actions
// ============================================

async function restoreUser(userId) {
  try {
    await api.restoreUser(userId);
    showToast('User restored successfully', 'success');
    loadUsers();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function confirmPermanentDelete(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;

  showGenericConfirm({
    title: 'Permanently Delete User?',
    message: `This will permanently delete "${user.firstName} ${user.lastName}" and all their payment history. This cannot be undone.`,
    onConfirm: async () => {
      try {
        await api.deleteUserPermanent(userId);
        showToast('User permanently deleted', 'success');
        loadUsers();
      } catch (error) {
        showToast(error.message, 'error');
      }
    },
  });
}

async function sendPaymentRequest(userId) {
  try {
    const result = await api.requestPayment(userId);
    showToast(result.message, result.emailSent ? 'success' : 'warning');
    loadUsers();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ============================================
// Payment Modal
// ============================================

function openPaymentModal(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;

  currentPaymentUserId = userId;
  elements.paymentUserInfo.textContent = `${user.firstName} ${user.lastName} - Pending: €${user.pendingPayment.toFixed(2)}`;
  elements.paymentAmount.value = user.pendingPayment > 0 ? user.pendingPayment.toFixed(2) : '';
  elements.paymentNotes.value = '';
  elements.confirmPaymentModal.classList.add('active');
  elements.paymentAmount.focus();
}

function closePaymentModal() {
  elements.confirmPaymentModal.classList.remove('active');
  currentPaymentUserId = null;
}

async function submitPaymentConfirmation() {
  if (!currentPaymentUserId) return;

  const amount = parseFloat(elements.paymentAmount.value);
  const notes = elements.paymentNotes.value.trim();

  if (isNaN(amount) || amount <= 0) {
    showToast('Please enter a valid amount', 'error');
    return;
  }

  try {
    const result = await api.confirmPayment(currentPaymentUserId, amount, notes);
    showToast(result.message, 'success');
    closePaymentModal();
    loadUsers();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ============================================
// Adjust Coffee Modal
// ============================================

function openAdjustModal(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;

  currentAdjustUserId = userId;
  elements.adjustUserInfo.textContent = `${user.firstName} ${user.lastName} - Current: ${user.coffeeCount} coffees`;
  elements.newCoffeeCount.value = user.coffeeCount;
  elements.adjustCoffeeModal.classList.add('active');
  elements.newCoffeeCount.focus();
}

function closeAdjustModal() {
  elements.adjustCoffeeModal.classList.remove('active');
  currentAdjustUserId = null;
}

async function submitCoffeeAdjustment() {
  if (!currentAdjustUserId) return;

  const count = parseInt(elements.newCoffeeCount.value, 10);

  if (isNaN(count) || count < 0) {
    showToast('Please enter a valid count', 'error');
    return;
  }

  try {
    await api.setCoffeeCount(currentAdjustUserId, count);
    showToast('Coffee count updated', 'success');
    closeAdjustModal();
    loadUsers();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ============================================
// Generic Confirm Modal
// ============================================

function showGenericConfirm({ title, message, onConfirm }) {
  elements.genericConfirmTitle.textContent = title;
  elements.genericConfirmMessage.textContent = message;
  genericConfirmCallback = onConfirm;
  elements.confirmModal.classList.add('active');
}

function closeGenericConfirm() {
  elements.confirmModal.classList.remove('active');
  genericConfirmCallback = null;
}

function handleGenericConfirmOk() {
  if (genericConfirmCallback) {
    genericConfirmCallback();
  }
  closeGenericConfirm();
}

// ============================================
// Settings
// ============================================

async function saveSettings(e) {
  e.preventDefault();

  const updates = {
    coffee_price: elements.coffeePrice.value,
    bank_owner: elements.bankOwner.value,
    bank_iban: elements.bankIban.value,
    bank_bic: elements.bankBic.value,
    admin_email: elements.adminEmail.value,
  };

  try {
    for (const [key, value] of Object.entries(updates)) {
      await api.updateSetting(key, value);
    }
    showToast('Settings saved successfully', 'success');
    loadSettings();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ============================================
// Export
// ============================================

function exportCsv() {
  window.location.href = '/api/export/csv';
}

// ============================================
// Utility Functions
// ============================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBalance(balance) {
  if (balance === 0) return '€0.00';
  const sign = balance > 0 ? '+' : '';
  return `${sign}€${balance.toFixed(2)}`;
}

function getBalanceClass(balance) {
  if (balance > 0) return 'balance-positive';
  if (balance < 0) return 'balance-negative';
  return 'balance-zero';
}

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

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

// ============================================
// Event Listeners
// ============================================

function init() {
  // Tab navigation
  elements.navTabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Payment modal
  elements.closePaymentModal.addEventListener('click', closePaymentModal);
  elements.cancelPayment.addEventListener('click', closePaymentModal);
  elements.submitPayment.addEventListener('click', submitPaymentConfirmation);
  elements.confirmPaymentModal.addEventListener('click', (e) => {
    if (e.target === elements.confirmPaymentModal) closePaymentModal();
  });

  // Adjust modal
  elements.closeAdjustModal.addEventListener('click', closeAdjustModal);
  elements.cancelAdjust.addEventListener('click', closeAdjustModal);
  elements.submitAdjust.addEventListener('click', submitCoffeeAdjustment);
  elements.adjustCoffeeModal.addEventListener('click', (e) => {
    if (e.target === elements.adjustCoffeeModal) closeAdjustModal();
  });

  // Generic confirm modal
  elements.genericConfirmCancel.addEventListener('click', closeGenericConfirm);
  elements.genericConfirmOk.addEventListener('click', handleGenericConfirmOk);
  elements.confirmModal.addEventListener('click', (e) => {
    if (e.target === elements.confirmModal) closeGenericConfirm();
  });

  // Payment filters
  elements.applyFilters.addEventListener('click', loadPayments);
  elements.clearFilters.addEventListener('click', () => {
    elements.filterType.value = '';
    elements.filterStartDate.value = '';
    elements.filterEndDate.value = '';
    loadPayments();
  });

  // Settings form
  elements.settingsForm.addEventListener('submit', saveSettings);

  // Export
  elements.exportCsvBtn.addEventListener('click', exportCsv);

  // Initial load
  loadUsers();
}

// Make functions available globally for onclick handlers
window.openPaymentModal = openPaymentModal;
window.openAdjustModal = openAdjustModal;
window.restoreUser = restoreUser;
window.confirmPermanentDelete = confirmPermanentDelete;
window.sendPaymentRequest = sendPaymentRequest;

// Start
document.addEventListener('DOMContentLoaded', init);
