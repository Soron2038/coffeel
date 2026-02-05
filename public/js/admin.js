/**
 * CofFeEL Admin Panel
 */

// ============================================
// State
// ============================================

let allUsers = [];
let activeUsers = [];
let deletedUsers = [];
let payments = [];
let settings = {};
let adminUsers = [];
let backups = [];
let genericConfirmCallback = null;
let currentAdminUser = null;
let currentModalUserId = null; // Shared across modals
let pollInterval = null;
const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds

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
  smtpHost: document.getElementById('smtpHost'),
  smtpPort: document.getElementById('smtpPort'),
  smtpUser: document.getElementById('smtpUser'),
  smtpPass: document.getElementById('smtpPass'),
  smtpSecure: document.getElementById('smtpSecure'),
  smtpFrom: document.getElementById('smtpFrom'),
  testSmtpBtn: document.getElementById('testSmtpBtn'),

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
  adjustFirstName: document.getElementById('adjustFirstName'),
  adjustLastName: document.getElementById('adjustLastName'),
  adjustEmail: document.getElementById('adjustEmail'),
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

  // Logout & Admin User Display
  logoutBtn: document.getElementById('logoutBtn'),
  adminUserDisplay: document.getElementById('adminUserDisplay'),

  // Admin Users
  adminUsersBody: document.getElementById('adminUsersBody'),
  addAdminForm: document.getElementById('addAdminForm'),
  newAdminUsername: document.getElementById('newAdminUsername'),
  newAdminPassword: document.getElementById('newAdminPassword'),

  // Backups
  backupsBody: document.getElementById('backupsBody'),
  noBackups: document.getElementById('noBackups'),
  createBackupBtn: document.getElementById('createBackupBtn'),
  uploadBackupBtn: document.getElementById('uploadBackupBtn'),
  backupFileInput: document.getElementById('backupFileInput'),
  uploadStatus: document.getElementById('uploadStatus'),

  // Change Password Modal
  changePasswordModal: document.getElementById('changePasswordModal'),
  closePasswordModal: document.getElementById('closePasswordModal'),
  passwordUserInfo: document.getElementById('passwordUserInfo'),
  newPassword: document.getElementById('newPassword'),
  cancelPassword: document.getElementById('cancelPassword'),
  submitPassword: document.getElementById('submitPassword'),
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

  updateUser(userId, updates) {
    return this.request(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  setCurrentTab(userId, amount) {
    return this.request(`/users/${userId}/current-tab`, {
      method: 'PUT',
      body: JSON.stringify({ amount }),
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

  // Admin Auth
  getSession() {
    return this.request('/admin/session');
  },

  logout() {
    return this.request('/admin/logout', { method: 'POST' });
  },

  // Admin Users
  getAdminUsers() {
    return this.request('/admin/users');
  },

  createAdminUser(username, password) {
    return this.request('/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  changeAdminPassword(userId, password) {
    return this.request(`/admin/users/${userId}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    });
  },

  deleteAdminUser(userId) {
    return this.request(`/admin/users/${userId}`, { method: 'DELETE' });
  },

  // Backups
  getBackups() {
    return this.request('/admin/backups');
  },

  createBackup() {
    return this.request('/admin/backup', { method: 'POST' });
  },

  restoreBackup(filename) {
    return this.request('/admin/restore', {
      method: 'POST',
      body: JSON.stringify({ filename }),
    });
  },

  deleteBackup(filename) {
    return this.request(`/admin/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
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
  } else if (tabId === 'admin-users') {
    loadAdminUsers();
  } else if (tabId === 'backups') {
    loadBackups();
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

  const totalPending = activeUsers.reduce((sum, u) => sum + (u.pendingPayment || 0), 0);
  elements.totalPending.textContent = `€${totalPending.toFixed(2)}`;

  const totalCredit = activeUsers
    .filter(u => u.accountBalance > 0)
    .reduce((sum, u) => sum + u.accountBalance, 0);
  elements.totalCredit.textContent = `€${totalCredit.toFixed(2)}`;

  // Total outstanding = currentTab + pendingPayment (all unpaid amounts)
  const totalOutstanding = activeUsers.reduce((sum, u) => sum + (u.currentTab || 0) + (u.pendingPayment || 0), 0);
  elements.totalDebt.textContent = `€${totalOutstanding.toFixed(2)}`;
}

// ============================================
// Render Functions
// ============================================

// Render user row (shared between active/deleted tables)
function renderUserRow(user, isDeleted) {
  const name = `<strong>${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}</strong>`;
  const currentTab = user.currentTab || 0;
  const pendingPayment = user.pendingPayment || 0;
  const pendingClass = pendingPayment > 0 ? 'pending-amount' : '';
  const dateCol = isDeleted 
    ? (user.deletedAt ? formatDate(user.deletedAt) : '-')
    : (user.lastPaymentRequest ? formatDate(user.lastPaymentRequest) : '-');
  
  const actions = isDeleted ? `
    <button class="btn btn-primary btn-sm" onclick="restoreUser(${user.id})">Restore</button>
    <button class="btn btn-success btn-sm" onclick="openPaymentModal(${user.id})" ${pendingPayment <= 0 ? 'disabled' : ''}>Confirm Payment</button>
    <button class="btn btn-danger btn-sm" onclick="confirmPermanentDelete(${user.id})">Delete</button>
  ` : `
    <button class="btn btn-success btn-sm" onclick="openPaymentModal(${user.id})" ${pendingPayment <= 0 ? 'disabled' : ''}>Confirm Payment</button>
    <button class="btn btn-outline btn-sm" onclick="openAdjustModal(${user.id})">Adjust</button>
    ${currentTab > 0 ? `<button class="btn btn-warning btn-sm" onclick="sendPaymentRequest(${user.id})">Send Request</button>` : ''}
  `;

  return `<tr data-user-id="${user.id}">
    <td>${name}</td>
    <td>${escapeHtml(user.email)}</td>
    <td>€${currentTab.toFixed(2)}</td>
    <td class="${pendingClass}">${formatPending(pendingPayment)}</td>
    <td class="${getBalanceClass(user.accountBalance)}">${formatBalance(user.accountBalance)}</td>
    <td>${dateCol}</td>
    <td><div class="action-btns">${actions}</div></td>
  </tr>`;
}

function renderActiveUsers() {
  // Apply filter
  const filterEl = document.getElementById('filterPending');
  const filter = filterEl ? filterEl.value : 'all';
  
  let filteredUsers = activeUsers;
  if (filter === 'pending') {
    filteredUsers = activeUsers.filter(u => (u.pendingPayment || 0) > 0);
  } else if (filter === 'tab') {
    filteredUsers = activeUsers.filter(u => (u.currentTab || 0) > 0);
  } else if (filter === 'debt') {
    filteredUsers = activeUsers.filter(u => (u.currentTab || 0) + (u.pendingPayment || 0) > 0);
  }

  if (filteredUsers.length === 0) {
    const message = filter === 'all' ? 'No active users found.' : 'No users match the current filter.';
    elements.activeUsersBody.innerHTML = `<tr><td colspan="7" class="empty-message">${message}</td></tr>`;
    return;
  }
  elements.activeUsersBody.innerHTML = filteredUsers.map(u => renderUserRow(u, false)).join('');
}

function renderDeletedUsers() {
  if (deletedUsers.length === 0) {
    elements.deletedUsersBody.innerHTML = '';
    elements.noDeletedUsers.style.display = 'block';
    return;
  }
  elements.noDeletedUsers.style.display = 'none';
  elements.deletedUsersBody.innerHTML = deletedUsers.map(u => renderUserRow(u, true)).join('');
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
      <td>${payment.adminNotes ? escapeHtml(payment.adminNotes) : '-'}</td>
    </tr>
  `).join('');
}

function populateSettingsForm() {
  // Map setting keys to form elements
  const mappings = [
    ['coffee_price', elements.coffeePrice], ['bank_owner', elements.bankOwner],
    ['bank_iban', elements.bankIban], ['bank_bic', elements.bankBic],
    ['admin_email', elements.adminEmail], ['smtp_host', elements.smtpHost],
    ['smtp_port', elements.smtpPort], ['smtp_user', elements.smtpUser],
    ['smtp_secure', elements.smtpSecure], ['smtp_from', elements.smtpFrom],
  ];
  mappings.forEach(([key, el]) => setSettingValue(el, key));
  // Password: show placeholder if set (don't expose actual value)
  if (settings.smtp_pass?.value) elements.smtpPass.placeholder = '(unchanged)';
}

// ============================================
// User Actions
// ============================================

async function restoreUser(userId) {
  try {
    await api.restoreUser(userId);
    showToast('User restored successfully', 'success');
    loadUsers();
  } catch (error) { showToast(error.message, 'error'); }
}

function confirmPermanentDelete(userId) {
  const user = findUser(userId);
  if (!user) return;
  showGenericConfirm({
    title: 'Permanently Delete User?',
    message: `This will permanently delete "${user.firstName} ${user.lastName}" and all their payment history. This cannot be undone.`,
    onConfirm: async () => {
      try {
        await api.deleteUserPermanent(userId);
        showToast('User permanently deleted', 'success');
        loadUsers();
      } catch (error) { showToast(error.message, 'error'); }
    },
  });
}

async function sendPaymentRequest(userId) {
  try {
    const result = await api.requestPayment(userId);
    showToast(result.message, result.emailSent ? 'success' : 'warning');
    loadUsers();
  } catch (error) { showToast(error.message, 'error'); }
}

// ============================================
// Payment Modal
// ============================================

function openPaymentModal(userId) {
  const user = findUser(userId);
  if (!user) return;
  currentModalUserId = userId;
  elements.paymentUserInfo.textContent = `${user.firstName} ${user.lastName} - Pending: €${user.pendingPayment.toFixed(2)}`;
  elements.paymentAmount.value = user.pendingPayment > 0 ? user.pendingPayment.toFixed(2) : '';
  elements.paymentNotes.value = '';
  openModal(elements.confirmPaymentModal, elements.paymentAmount);
}

function closePaymentModal() { closeModal(elements.confirmPaymentModal); }

async function submitPaymentConfirmation() {
  if (!currentModalUserId) return;
  const amount = parseFloat(elements.paymentAmount.value);
  if (isNaN(amount) || amount <= 0) return showToast('Please enter a valid amount', 'error');
  try {
    const result = await api.confirmPayment(currentModalUserId, amount, elements.paymentNotes.value.trim());
    showToast(result.message, 'success');
    closePaymentModal();
    loadUsers();
  } catch (error) { showToast(error.message, 'error'); }
}

// ============================================
// Adjust Tab Modal
// ============================================

function openAdjustModal(userId) {
  const user = findUser(userId);
  if (!user) return;
  currentModalUserId = userId;
  const currentTab = user.currentTab || 0;
  
  // Pre-fill all user fields
  elements.adjustUserInfo.textContent = `Editing: ${user.firstName} ${user.lastName} (${user.email})`;
  elements.adjustFirstName.value = user.firstName;
  elements.adjustLastName.value = user.lastName;
  elements.adjustEmail.value = user.email;
  elements.newCoffeeCount.value = currentTab.toFixed(2);
  
  openModal(elements.adjustCoffeeModal, elements.adjustFirstName);
}

function closeAdjustModal() { closeModal(elements.adjustCoffeeModal); }

async function submitUserUpdate() {
  if (!currentModalUserId) return;
  
  // Collect all form values
  const firstName = elements.adjustFirstName.value.trim();
  const lastName = elements.adjustLastName.value.trim();
  const email = elements.adjustEmail.value.trim();
  const currentTab = parseFloat(elements.newCoffeeCount.value);
  
  // Validate inputs
  if (!firstName || firstName.length < 2) {
    return showToast('First name must be at least 2 characters', 'error');
  }
  if (!lastName || lastName.length < 2) {
    return showToast('Last name must be at least 2 characters', 'error');
  }
  if (!email || !email.includes('@')) {
    return showToast('Please enter a valid email address', 'error');
  }
  if (isNaN(currentTab) || currentTab < 0) {
    return showToast('Please enter a valid tab amount', 'error');
  }
  
  try {
    await api.updateUser(currentModalUserId, { firstName, lastName, email, currentTab });
    showToast('User updated', 'success');
    closeAdjustModal();
    loadUsers();
  } catch (error) { showToast(error.message, 'error'); }
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
    smtp_host: elements.smtpHost.value,
    smtp_port: elements.smtpPort.value,
    smtp_user: elements.smtpUser.value,
    smtp_secure: elements.smtpSecure.value,
    smtp_from: elements.smtpFrom.value,
  };

  // Only update password if a new one was entered
  if (elements.smtpPass.value) {
    updates.smtp_pass = elements.smtpPass.value;
  }

  try {
    for (const [key, value] of Object.entries(updates)) {
      await api.updateSetting(key, value);
    }
    showToast('Settings saved successfully', 'success');
    elements.smtpPass.value = '';
    loadSettings();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function testSmtp() {
  try {
    elements.testSmtpBtn.disabled = true;
    elements.testSmtpBtn.textContent = 'Testing...';
    
    const result = await api.request('/settings/test-smtp', { method: 'POST' });
    
    if (result.success) {
      showToast('Test email sent successfully!', 'success');
    } else {
      showToast('Test failed: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    showToast('SMTP test failed: ' + error.message, 'error');
  } finally {
    elements.testSmtpBtn.disabled = false;
    elements.testSmtpBtn.textContent = 'Test SMTP';
  }
}

// ============================================
// Export
// ============================================

function exportCsv() {
  window.location.href = '/api/export/csv';
}

// ============================================
// Admin Users
// ============================================

async function loadAdminUsers() {
  try {
    adminUsers = await api.getAdminUsers();
    renderAdminUsers();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderAdminUsers() {
  elements.adminUsersBody.innerHTML = adminUsers.map(user => `
    <tr>
      <td><strong>${escapeHtml(user.username)}</strong></td>
      <td>${user.createdAt ? formatDate(user.createdAt) : '-'}</td>
      <td>${user.lastLogin ? formatDate(user.lastLogin) : 'Never'}</td>
      <td>
        <button class="btn btn-secondary btn-xs" onclick="openPasswordModal(${user.id}, '${escapeHtml(user.username)}')">Change Password</button>
        <button class="btn btn-danger btn-xs" onclick="confirmDeleteAdmin(${user.id}, '${escapeHtml(user.username)}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

async function addAdminUser(e) {
  e.preventDefault();
  
  const username = elements.newAdminUsername.value.trim();
  const password = elements.newAdminPassword.value;

  if (!username || !password) {
    showToast('Please fill in all fields', 'error');
    return;
  }

  try {
    await api.createAdminUser(username, password);
    showToast(`Admin user '${username}' created`, 'success');
    elements.addAdminForm.reset();
    loadAdminUsers();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function openPasswordModal(userId, username) {
  currentModalUserId = userId;
  elements.passwordUserInfo.textContent = `Change password for: ${username}`;
  elements.newPassword.value = '';
  openModal(elements.changePasswordModal, elements.newPassword);
}

function closePasswordModal() { closeModal(elements.changePasswordModal); }

async function submitPasswordChange() {
  if (!currentModalUserId) return;
  const password = elements.newPassword.value;
  if (!password || password.length < 4) return showToast('Password must be at least 4 characters', 'error');
  try {
    await api.changeAdminPassword(currentModalUserId, password);
    showToast('Password changed successfully', 'success');
    closePasswordModal();
  } catch (error) { showToast(error.message, 'error'); }
}

function confirmDeleteAdmin(userId, username) {
  showGenericConfirm({
    title: 'Delete Admin User',
    message: `Are you sure you want to delete admin user '${username}'?`,
    onConfirm: async () => {
      try {
        await api.deleteAdminUser(userId);
        showToast(`Admin user '${username}' deleted`, 'success');
        loadAdminUsers();
      } catch (error) { showToast(error.message, 'error'); }
    },
  });
}

// ============================================
// Backups
// ============================================

async function loadBackups() {
  try {
    backups = await api.getBackups();
    renderBackups();
  } catch (error) {
    showToast('Failed to load backups: ' + error.message, 'error');
  }
}

function renderBackups() {
  if (backups.length === 0) {
    elements.backupsBody.innerHTML = '';
    elements.noBackups.style.display = 'block';
    return;
  }
  elements.noBackups.style.display = 'none';
  elements.backupsBody.innerHTML = backups.map(b => `
    <tr>
      <td><code>${escapeHtml(b.filename)}</code></td>
      <td>${b.sizeMB} MB</td>
      <td>${formatDate(b.createdAt)}</td>
      <td>
        <div class="action-btns">
          <button class="btn btn-secondary btn-sm" onclick="downloadBackup('${escapeHtml(b.filename)}')">Download</button>
          <button class="btn btn-primary btn-sm" onclick="confirmRestoreBackup('${escapeHtml(b.filename)}')">Restore</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteBackup('${escapeHtml(b.filename)}')">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function createBackup() {
  try {
    elements.createBackupBtn.disabled = true;
    elements.createBackupBtn.textContent = 'Creating...';
    
    const result = await api.createBackup();
    showToast(`Backup created: ${result.filename} (${result.sizeMB} MB)`, 'success');
    loadBackups();
  } catch (error) {
    showToast('Failed to create backup: ' + error.message, 'error');
  } finally {
    elements.createBackupBtn.disabled = false;
    elements.createBackupBtn.textContent = 'Create Backup';
  }
}

function confirmRestoreBackup(filename) {
  showGenericConfirm({
    title: 'Restore Database',
    message: `Are you sure you want to restore from "${filename}"? A safety backup will be created automatically before restore. The application may briefly disconnect.`,
    onConfirm: async () => {
      try {
        const result = await api.restoreBackup(filename);
        showToast(`Database restored! Safety backup: ${result.safetyBackup}`, 'success');
        // Reload the page to refresh all data
        setTimeout(() => window.location.reload(), 1500);
      } catch (error) {
        showToast('Restore failed: ' + error.message, 'error');
      }
    },
  });
}

function confirmDeleteBackup(filename) {
  showGenericConfirm({
    title: 'Delete Backup',
    message: `Are you sure you want to delete "${filename}"? This cannot be undone.`,
    onConfirm: async () => {
      try {
        await api.deleteBackup(filename);
        showToast('Backup deleted', 'success');
        loadBackups();
      } catch (error) {
        showToast('Delete failed: ' + error.message, 'error');
      }
    },
  });
}

function downloadBackup(filename) {
  // Direct link approach - works reliably over HTTP
  const a = document.createElement('a');
  a.href = `/api/admin/backups/${encodeURIComponent(filename)}/download`;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function uploadBackup(file) {
  if (!file || !file.name.endsWith('.db')) {
    showToast('Please select a .db file', 'error');
    return;
  }
  
  elements.uploadStatus.textContent = 'Uploading...';
  elements.uploadBackupBtn.disabled = true;
  
  try {
    const response = await fetch('/api/admin/backups/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': file.name,
      },
      body: file,
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || 'Upload failed');
    }
    
    elements.uploadStatus.textContent = '';
    showToast(`Backup uploaded: ${result.filename}`, 'success');
    loadBackups();
  } catch (error) {
    elements.uploadStatus.textContent = '';
    showToast('Upload failed: ' + error.message, 'error');
  } finally {
    elements.uploadBackupBtn.disabled = false;
    elements.backupFileInput.value = '';
  }
}

// ============================================
// Logout
// ============================================

async function handleLogout() {
  try {
    await api.logout();
    window.location.href = '/login.html';
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function loadCurrentUser() {
  try {
    const session = await api.getSession();
    if (session.loggedIn && session.user) {
      currentAdminUser = session.user;
      elements.adminUserDisplay.textContent = `Logged in as: ${session.user.username}`;
    }
  } catch (error) {
    // Redirect to login if session check fails
    window.location.href = '/login.html';
  }
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
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatBalance(balance) {
  if (balance === 0) return '€0.00';
  return `${balance > 0 ? '+' : ''}€${balance.toFixed(2)}`;
}

function getBalanceClass(balance) {
  return balance > 0 ? 'balance-positive' : balance < 0 ? 'balance-negative' : 'balance-zero';
}

function showToast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span class="toast-message">${escapeHtml(message)}</span>`;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => { toast.classList.add('removing'); setTimeout(() => toast.remove(), 200); }, 3000);
}

// Find user by ID, show error toast if not found
function findUser(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) showToast('User not found', 'error');
  return user;
}

// Generic modal helpers
function openModal(modal, focusElement) {
  modal.classList.add('active');
  if (focusElement) focusElement.focus();
}

function closeModal(modal) {
  modal.classList.remove('active');
  currentModalUserId = null;
}

// Format pending payment display
function formatPending(amount) {
  return amount > 0 ? `€${amount.toFixed(2)}` : '-';
}

// Set setting value if exists
function setSettingValue(element, settingKey) {
  if (settings[settingKey]) element.value = settings[settingKey].value;
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
  elements.submitAdjust.addEventListener('click', submitUserUpdate);
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
  elements.testSmtpBtn.addEventListener('click', testSmtp);

  // Active users filter
  const filterPending = document.getElementById('filterPending');
  if (filterPending) {
    filterPending.addEventListener('change', renderActiveUsers);
  }

  // Export
  elements.exportCsvBtn.addEventListener('click', exportCsv);

  // Logout
  elements.logoutBtn.addEventListener('click', handleLogout);

  // Admin user management
  elements.addAdminForm.addEventListener('submit', addAdminUser);
  elements.closePasswordModal.addEventListener('click', closePasswordModal);
  elements.cancelPassword.addEventListener('click', closePasswordModal);
  elements.submitPassword.addEventListener('click', submitPasswordChange);
  elements.changePasswordModal.addEventListener('click', (e) => {
    if (e.target === elements.changePasswordModal) closePasswordModal();
  });

  // Backups
  elements.createBackupBtn.addEventListener('click', createBackup);
  elements.uploadBackupBtn.addEventListener('click', () => elements.backupFileInput.click());
  elements.backupFileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) uploadBackup(e.target.files[0]);
  });

  // Initial load
  loadCurrentUser();
  loadUsers();
  
  // Start polling for updates
  startPolling();
}

// ============================================
// Polling - Auto-refresh data
// ============================================

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(async () => {
    try {
      const newUsers = await api.getUsers(true);
      // Only re-render if data changed
      if (JSON.stringify(newUsers) !== JSON.stringify(allUsers)) {
        allUsers = newUsers;
        activeUsers = allUsers.filter(u => !u.deletedByUser);
        deletedUsers = allUsers.filter(u => u.deletedByUser);
        renderActiveUsers();
        renderDeletedUsers();
        updateSummary();
      }
    } catch (error) {
      console.warn('Polling failed:', error.message);
    }
  }, POLL_INTERVAL_MS);
}

// Make functions available globally for onclick handlers
window.openPaymentModal = openPaymentModal;
window.openAdjustModal = openAdjustModal;
window.restoreUser = restoreUser;
window.confirmPermanentDelete = confirmPermanentDelete;
window.sendPaymentRequest = sendPaymentRequest;
window.openPasswordModal = openPasswordModal;
window.confirmDeleteAdmin = confirmDeleteAdmin;
window.confirmRestoreBackup = confirmRestoreBackup;
window.confirmDeleteBackup = confirmDeleteBackup;
window.downloadBackup = downloadBackup;

// Start
document.addEventListener('DOMContentLoaded', init);
