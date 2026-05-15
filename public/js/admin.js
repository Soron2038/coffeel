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

  // Broadcasts
  broadcastSubject: document.getElementById('broadcastSubject'),
  broadcastBody: document.getElementById('broadcastBody'),
  broadcastRecipientCount: document.getElementById('broadcastRecipientCount'),
  broadcastPreviewBtn: document.getElementById('broadcastPreviewBtn'),
  broadcastTestSendBtn: document.getElementById('broadcastTestSendBtn'),
  broadcastSendBtn: document.getElementById('broadcastSendBtn'),
  broadcastsBody: document.getElementById('broadcastsBody'),
  noBroadcasts: document.getElementById('noBroadcasts'),
  broadcastCompose: document.getElementById('broadcastCompose'),
  broadcastProgress: document.getElementById('broadcastProgress'),
  broadcastProgressTitle: document.getElementById('broadcastProgressTitle'),
  broadcastProgressStatus: document.getElementById('broadcastProgressStatus'),
  broadcastProgressFill: document.getElementById('broadcastProgressFill'),
  broadcastPreviewModal: document.getElementById('broadcastPreviewModal'),
  closeBroadcastPreview: document.getElementById('closeBroadcastPreview'),
  closeBroadcastPreviewBtn: document.getElementById('closeBroadcastPreviewBtn'),
  broadcastPreviewSampleName: document.getElementById('broadcastPreviewSampleName'),
  broadcastPreviewSubject: document.getElementById('broadcastPreviewSubject'),
  broadcastPreviewFrame: document.getElementById('broadcastPreviewFrame'),
  broadcastPreviewText: document.getElementById('broadcastPreviewText'),
  broadcastDetailModal: document.getElementById('broadcastDetailModal'),
  closeBroadcastDetail: document.getElementById('closeBroadcastDetail'),
  closeBroadcastDetailBtn: document.getElementById('closeBroadcastDetailBtn'),
  broadcastDetailSubject: document.getElementById('broadcastDetailSubject'),
  broadcastDetailMeta: document.getElementById('broadcastDetailMeta'),
  broadcastDetailBody: document.getElementById('broadcastDetailBody'),
  broadcastDetailFailedBlock: document.getElementById('broadcastDetailFailedBlock'),
  broadcastDetailFailedList: document.getElementById('broadcastDetailFailedList'),
  broadcastDetailBouncesBlock: document.getElementById('broadcastDetailBouncesBlock'),
  broadcastDetailBouncesList: document.getElementById('broadcastDetailBouncesList'),
  broadcastResendFailedBtn: document.getElementById('broadcastResendFailedBtn'),

  // IMAP settings
  imapHost: document.getElementById('imapHost'),
  imapPort: document.getElementById('imapPort'),
  imapUser: document.getElementById('imapUser'),
  imapPass: document.getElementById('imapPass'),
  imapSecure: document.getElementById('imapSecure'),
  imapPollIntervalMinutes: document.getElementById('imapPollIntervalMinutes'),
  imapInboxFolder: document.getElementById('imapInboxFolder'),
  imapProcessedFolder: document.getElementById('imapProcessedFolder'),
  testImapBtn: document.getElementById('testImapBtn'),
  runBounceCheckBtn: document.getElementById('runBounceCheckBtn'),
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

  // Broadcasts
  previewBroadcast(subject, body) {
    return this.request('/broadcasts/preview', {
      method: 'POST',
      body: JSON.stringify({ subject, body }),
    });
  },

  testSendBroadcast(subject, body) {
    return this.request('/broadcasts/test-send', {
      method: 'POST',
      body: JSON.stringify({ subject, body }),
    });
  },

  startBroadcast(subject, body) {
    return this.request('/broadcasts', {
      method: 'POST',
      body: JSON.stringify({ subject, body }),
    });
  },

  getBroadcasts(limit = 20) {
    return this.request(`/broadcasts?limit=${limit}`);
  },

  getActiveBroadcast() {
    return this.request('/broadcasts/active');
  },

  getBroadcast(id) {
    return this.request(`/broadcasts/${id}`);
  },

  resendFailedBroadcast(id) {
    return this.request(`/broadcasts/${id}/resend-failed`, { method: 'POST' });
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
  } else if (tabId === 'broadcasts') {
    loadBroadcastsTab();
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
    ['imap_host', elements.imapHost], ['imap_port', elements.imapPort],
    ['imap_user', elements.imapUser], ['imap_secure', elements.imapSecure],
    ['imap_poll_interval_minutes', elements.imapPollIntervalMinutes],
    ['imap_inbox_folder', elements.imapInboxFolder],
    ['imap_processed_folder', elements.imapProcessedFolder],
  ];
  mappings.forEach(([key, el]) => setSettingValue(el, key));
  // Password: show placeholder if set (don't expose actual value)
  if (settings.smtp_pass?.value) elements.smtpPass.placeholder = '(unchanged)';
  if (settings.imap_pass?.value) elements.imapPass.placeholder = '(unchanged)';
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
    imap_host: elements.imapHost.value,
    imap_port: elements.imapPort.value,
    imap_user: elements.imapUser.value,
    imap_secure: elements.imapSecure.value,
    imap_poll_interval_minutes: elements.imapPollIntervalMinutes.value,
    imap_inbox_folder: elements.imapInboxFolder.value,
    imap_processed_folder: elements.imapProcessedFolder.value,
  };

  // Only update passwords if a new one was entered (blank = keep existing)
  if (elements.smtpPass.value) {
    updates.smtp_pass = elements.smtpPass.value;
  }
  if (elements.imapPass.value) {
    updates.imap_pass = elements.imapPass.value;
  }

  try {
    for (const [key, value] of Object.entries(updates)) {
      await api.updateSetting(key, value);
    }
    showToast('Settings saved successfully', 'success');
    elements.smtpPass.value = '';
    elements.imapPass.value = '';
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

async function testImap() {
  try {
    elements.testImapBtn.disabled = true;
    elements.testImapBtn.textContent = 'Testing...';

    const result = await api.request('/settings/test-imap', { method: 'POST' });

    if (result.success) {
      const folderNote = result.processedFolderExists
        ? `'${result.processedFolder}' folder is ready`
        : `'${result.processedFolder}' folder doesn't exist yet — will be auto-created on first bounce`;
      const msg = `Connected to ${result.host}:${result.port} as ${result.user}\n`
        + `Inbox '${result.inboxFolder}': ${result.totalMessages} messages (${result.unseenMessages} unseen)\n`
        + folderNote;
      showToast(msg, 'success', 8000);
    } else {
      showToast('IMAP test failed: ' + (result.error || 'Unknown error'), 'error', 8000);
    }
  } catch (error) {
    showToast('IMAP test failed: ' + error.message, 'error');
  } finally {
    elements.testImapBtn.disabled = false;
    elements.testImapBtn.textContent = 'Test IMAP Connection';
  }
}

async function runBounceCheckNow() {
  try {
    elements.runBounceCheckBtn.disabled = true;
    elements.runBounceCheckBtn.textContent = 'Running...';

    const result = await api.request('/settings/run-bounce-check', { method: 'POST' });

    if (result.success) {
      const msg = `Scanned ${result.processed} unread message(s) — `
        + `${result.matched} bounce(s) matched, ${result.unmatched} unmatched`;
      showToast(msg, result.matched > 0 ? 'success' : 'info', 8000);
    } else if (result.error === 'disabled') {
      showToast('Bounce check skipped — IMAP host is not configured', 'warning');
    } else if (result.error === 'in-flight') {
      showToast('A bounce check is already running, please wait', 'warning');
    } else {
      showToast('Bounce check failed: ' + (result.error || 'Unknown error'), 'error', 8000);
    }
  } catch (error) {
    showToast('Bounce check failed: ' + error.message, 'error');
  } finally {
    elements.runBounceCheckBtn.disabled = false;
    elements.runBounceCheckBtn.textContent = 'Run Bounce Check Now';
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
// Broadcasts
// ============================================

let broadcastPollInterval = null;
let broadcasts = [];
let currentDetailBroadcast = null;
const BROADCAST_POLL_MS = 1500;

async function loadBroadcastsTab() {
  // Recipient count
  try {
    const users = await api.getUsers(false);
    elements.broadcastRecipientCount.textContent = users.length;
  } catch (error) {
    elements.broadcastRecipientCount.textContent = '?';
    showToast('Failed to load recipients: ' + error.message, 'error');
  }

  // History
  await loadBroadcastsHistory();

  // Active broadcast detection — if one is in flight, switch to progress mode
  try {
    const active = await api.getActiveBroadcast();
    if (active && active.id) {
      enterProgressMode(active);
    } else {
      exitProgressMode();
    }
  } catch (error) {
    console.warn('Failed to check active broadcast:', error.message);
  }
}

async function loadBroadcastsHistory() {
  try {
    broadcasts = await api.getBroadcasts(20);
    renderBroadcasts();
  } catch (error) {
    showToast('Failed to load broadcasts: ' + error.message, 'error');
  }
}

function renderBroadcasts() {
  if (!broadcasts || broadcasts.length === 0) {
    elements.broadcastsBody.innerHTML = '';
    elements.noBroadcasts.style.display = 'block';
    return;
  }
  elements.noBroadcasts.style.display = 'none';
  elements.broadcastsBody.innerHTML = broadcasts.map((b) => {
    const subjectShort = b.subject.length > 60 ? b.subject.slice(0, 57) + '…' : b.subject;
    const statusClass = `status-${b.status}`;
    return `<tr class="broadcast-row" data-broadcast-id="${b.id}">
      <td>${formatDate(b.createdAt)}</td>
      <td><strong>${escapeHtml(subjectShort)}</strong></td>
      <td>${b.sentCount} / ${b.totalCount}</td>
      <td>${b.failedCount > 0 ? `<span class="failed-count">${b.failedCount}</span>` : '0'}</td>
      <td><span class="status-badge ${statusClass}">${escapeHtml(b.status)}</span></td>
    </tr>`;
  }).join('');

  // Event delegation for row click → detail modal
  elements.broadcastsBody.querySelectorAll('.broadcast-row').forEach((row) => {
    row.addEventListener('click', () => {
      const id = parseInt(row.dataset.broadcastId, 10);
      openBroadcastDetail(id);
    });
  });
}

async function previewBroadcastClick() {
  const subject = elements.broadcastSubject.value.trim();
  const body = elements.broadcastBody.value.trim();
  if (!subject || !body) {
    return showToast('Please fill in subject and message', 'error');
  }
  try {
    const result = await api.previewBroadcast(subject, body);
    elements.broadcastPreviewSubject.textContent = result.subject;
    elements.broadcastPreviewSampleName.textContent = result.sampleUserId
      ? `first active user (id ${result.sampleUserId})`
      : 'synthetic sample (no active users)';
    // Render HTML safely via srcdoc + sandbox iframe
    elements.broadcastPreviewFrame.removeAttribute('src');
    elements.broadcastPreviewFrame.srcdoc = result.html;
    elements.broadcastPreviewText.textContent = result.text;

    // Default to HTML tab
    switchPreviewTab('html');
    openModal(elements.broadcastPreviewModal, null);
  } catch (error) {
    showToast('Preview failed: ' + error.message, 'error');
  }
}

function switchPreviewTab(tab) {
  document.querySelectorAll('.preview-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.previewTab === tab);
  });
  elements.broadcastPreviewFrame.style.display = tab === 'html' ? 'block' : 'none';
  elements.broadcastPreviewText.style.display = tab === 'text' ? 'block' : 'none';
}

async function testSendBroadcastClick() {
  const subject = elements.broadcastSubject.value.trim();
  const body = elements.broadcastBody.value.trim();
  if (!subject || !body) {
    return showToast('Please fill in subject and message', 'error');
  }
  try {
    elements.broadcastTestSendBtn.disabled = true;
    elements.broadcastTestSendBtn.textContent = 'Sending…';
    const result = await api.testSendBroadcast(subject, body);
    showToast(`Test mail sent to ${result.sentTo}`, 'success');
  } catch (error) {
    showToast('Test send failed: ' + error.message, 'error');
  } finally {
    elements.broadcastTestSendBtn.disabled = false;
    elements.broadcastTestSendBtn.textContent = 'Test send to me';
  }
}

function sendToAllClick() {
  const subject = elements.broadcastSubject.value.trim();
  const body = elements.broadcastBody.value.trim();
  if (!subject || !body) {
    return showToast('Please fill in subject and message', 'error');
  }
  const count = elements.broadcastRecipientCount.textContent;
  showGenericConfirm({
    title: 'Send broadcast?',
    message: `Send to ${count} recipients?`,
    onConfirm: async () => {
      try {
        const result = await api.startBroadcast(subject, body);
        const broadcast = await api.getBroadcast(result.broadcastId);
        enterProgressMode(broadcast);
      } catch (error) {
        if (error.message === 'BROADCAST_IN_PROGRESS') {
          showToast('Another broadcast is already in progress.', 'warning');
          // Switch to progress mode for the active one
          const active = await api.getActiveBroadcast().catch(() => null);
          if (active) enterProgressMode(active);
        } else {
          showToast('Send failed: ' + error.message, 'error');
        }
      }
    },
  });
}

function enterProgressMode(broadcast) {
  elements.broadcastCompose.style.display = 'none';
  elements.broadcastProgress.style.display = 'block';
  updateProgressDisplay(broadcast);
  startBroadcastPolling(broadcast.id);
}

function exitProgressMode() {
  elements.broadcastProgress.style.display = 'none';
  elements.broadcastCompose.style.display = 'block';
  stopBroadcastPolling();
}

function updateProgressDisplay(b) {
  const total = b.totalCount || 0;
  const sent = b.sentCount || 0;
  const failed = b.failedCount || 0;
  const done = sent + failed;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  elements.broadcastProgressTitle.textContent = b.status === 'sending' ? 'Sending broadcast…' : `Broadcast ${b.status}`;
  elements.broadcastProgressStatus.textContent = `${sent} / ${total} sent, ${failed} failed`;
  elements.broadcastProgressFill.style.width = `${pct}%`;
}

function startBroadcastPolling(broadcastId) {
  stopBroadcastPolling();
  broadcastPollInterval = setInterval(async () => {
    try {
      const b = await api.getBroadcast(broadcastId);
      updateProgressDisplay(b);
      if (b.status !== 'sending') {
        stopBroadcastPolling();
        // Final state: completed | failed | interrupted
        if (b.status === 'completed') {
          const msg = b.failedCount === 0
            ? `Broadcast sent to ${b.sentCount} recipient(s).`
            : `Broadcast finished: ${b.sentCount} sent, ${b.failedCount} failed.`;
          showToast(msg, b.failedCount === 0 ? 'success' : 'warning');
        } else if (b.status === 'failed') {
          showToast('Broadcast failed — see history for details.', 'error');
        } else if (b.status === 'interrupted') {
          showToast('Broadcast was interrupted (server restart).', 'warning');
        }
        // Reset compose form
        elements.broadcastSubject.value = '';
        elements.broadcastBody.value = '';
        exitProgressMode();
        loadBroadcastsHistory();
      }
    } catch (error) {
      console.warn('Broadcast poll failed:', error.message);
    }
  }, BROADCAST_POLL_MS);
}

function stopBroadcastPolling() {
  if (broadcastPollInterval) {
    clearInterval(broadcastPollInterval);
    broadcastPollInterval = null;
  }
}

async function openBroadcastDetail(id) {
  try {
    const b = await api.getBroadcast(id);
    currentDetailBroadcast = b;
    elements.broadcastDetailSubject.textContent = b.subject;
    elements.broadcastDetailMeta.textContent =
      `${formatDate(b.createdAt)} · status: ${b.status} · ${b.sentCount}/${b.totalCount} sent · ${b.failedCount} failed`
      + (b.originBroadcastId ? ` · resent from #${b.originBroadcastId}` : '');
    elements.broadcastDetailBody.textContent = b.body;

    if (b.failedCount > 0 && b.failedRecipients && b.failedRecipients.length > 0) {
      elements.broadcastDetailFailedBlock.style.display = 'block';
      elements.broadcastDetailFailedList.innerHTML = '';
      b.failedRecipients.forEach((f) => {
        const li = document.createElement('li');
        const emailSpan = document.createElement('span');
        emailSpan.className = 'failed-email';
        emailSpan.textContent = f.email;
        const errorSpan = document.createElement('span');
        errorSpan.className = 'failed-error';
        errorSpan.textContent = f.error || 'Unknown error';
        li.appendChild(emailSpan);
        li.appendChild(document.createTextNode(' — '));
        li.appendChild(errorSpan);
        elements.broadcastDetailFailedList.appendChild(li);
      });
      // Resend button only for completed broadcasts with failures
      elements.broadcastResendFailedBtn.style.display = b.status === 'completed' ? 'inline-block' : 'none';
    } else {
      elements.broadcastDetailFailedBlock.style.display = 'none';
      elements.broadcastResendFailedBtn.style.display = 'none';
    }

    // Bounces — populated asynchronously by the IMAP poller. May be empty
    // even on a finished broadcast if there was nothing to bounce or the
    // poller hasn't run yet.
    const bounces = Array.isArray(b.bounces) ? b.bounces : [];
    if (bounces.length > 0) {
      elements.broadcastDetailBouncesBlock.style.display = 'block';
      elements.broadcastDetailBouncesList.innerHTML = '';
      bounces.forEach((bc) => {
        const li = document.createElement('li');
        const emailSpan = document.createElement('span');
        emailSpan.className = 'failed-email';
        emailSpan.textContent = bc.email;
        const badge = document.createElement('span');
        const isHard = bc.status === 'bounced_hard';
        badge.className = 'bounce-badge ' + (isHard ? 'bounce-hard' : 'bounce-soft');
        badge.textContent = isHard ? 'hard' : 'soft';
        const reasonSpan = document.createElement('span');
        reasonSpan.className = 'failed-error';
        const codePart = bc.code ? `[${bc.code}] ` : '';
        reasonSpan.textContent = codePart + (bc.reason || 'No diagnostic info');
        li.appendChild(emailSpan);
        li.appendChild(document.createTextNode(' '));
        li.appendChild(badge);
        li.appendChild(document.createTextNode(' — '));
        li.appendChild(reasonSpan);
        elements.broadcastDetailBouncesList.appendChild(li);
      });
    } else {
      elements.broadcastDetailBouncesBlock.style.display = 'none';
    }

    openModal(elements.broadcastDetailModal, null);
  } catch (error) {
    showToast('Failed to load broadcast detail: ' + error.message, 'error');
  }
}

function closeBroadcastDetail() {
  closeModal(elements.broadcastDetailModal);
  currentDetailBroadcast = null;
}

function resendFailedBroadcastClick() {
  if (!currentDetailBroadcast) return;
  const failedCount = currentDetailBroadcast.failedCount;
  const id = currentDetailBroadcast.id;
  showGenericConfirm({
    title: 'Resend to failed?',
    message: `Resend to ${failedCount} recipient(s) that failed in the original broadcast?`,
    onConfirm: async () => {
      try {
        const result = await api.resendFailedBroadcast(id);
        const broadcast = await api.getBroadcast(result.broadcastId);
        closeBroadcastDetail();
        enterProgressMode(broadcast);
      } catch (error) {
        if (error.message === 'BROADCAST_IN_PROGRESS') {
          showToast('Another broadcast is already in progress.', 'warning');
        } else {
          showToast('Resend failed: ' + error.message, 'error');
        }
      }
    },
  });
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

function showToast(message, type = 'info', durationMs = 3000) {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  // white-space: pre-line lets callers pass multi-line diagnostics with \n.
  toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span class="toast-message" style="white-space: pre-line;">${escapeHtml(message)}</span>`;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => { toast.classList.add('removing'); setTimeout(() => toast.remove(), 200); }, durationMs);
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
  elements.testImapBtn.addEventListener('click', testImap);
  elements.runBounceCheckBtn.addEventListener('click', runBounceCheckNow);

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

  // Broadcasts
  elements.broadcastPreviewBtn.addEventListener('click', previewBroadcastClick);
  elements.broadcastTestSendBtn.addEventListener('click', testSendBroadcastClick);
  elements.broadcastSendBtn.addEventListener('click', sendToAllClick);
  elements.closeBroadcastPreview.addEventListener('click', () => closeModal(elements.broadcastPreviewModal));
  elements.closeBroadcastPreviewBtn.addEventListener('click', () => closeModal(elements.broadcastPreviewModal));
  elements.broadcastPreviewModal.addEventListener('click', (e) => {
    if (e.target === elements.broadcastPreviewModal) closeModal(elements.broadcastPreviewModal);
  });
  document.querySelectorAll('.preview-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchPreviewTab(tab.dataset.previewTab));
  });
  elements.closeBroadcastDetail.addEventListener('click', closeBroadcastDetail);
  elements.closeBroadcastDetailBtn.addEventListener('click', closeBroadcastDetail);
  elements.broadcastDetailModal.addEventListener('click', (e) => {
    if (e.target === elements.broadcastDetailModal) closeBroadcastDetail();
  });
  elements.broadcastResendFailedBtn.addEventListener('click', resendFailedBroadcastClick);

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
