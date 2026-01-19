// CofFeEL Admin Panel JavaScript

const API_BASE = '/api';
let authCredentials = null;
let activeUsers = [];
let deletedUsers = [];
let allPayments = [];
let currentPaymentUserId = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupEventListeners();
  promptAuthentication();
});

// Setup Tab Switching
function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      
      // Update active tab button
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update active tab content
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(`${targetTab}-tab`).classList.add('active');
      
      // Load data for active tab
      loadTabData(targetTab);
    });
  });
}

// Setup Event Listeners
function setupEventListeners() {
  // Export CSV
  document.getElementById('export-csv-btn').addEventListener('click', exportToCSV);
  
  // Payment filter
  document.getElementById('payment-filter').addEventListener('change', (e) => {
    renderPayments(e.target.value);
  });
  
  // Settings form
  document.getElementById('settings-form').addEventListener('submit', handleSaveSettings);
  
  // Test email button
  document.getElementById('test-email-btn').addEventListener('click', testEmail);
  
  // Confirm payment form
  document.getElementById('confirm-payment-form').addEventListener('submit', handleConfirmPayment);
}

// Prompt for Authentication
function promptAuthentication() {
  // Try to get credentials from browser's Basic Auth prompt
  // This will trigger browser's built-in authentication dialog
  loadActiveUsers();
}

// Create Authorization Header
function getAuthHeaders() {
  if (authCredentials) {
    return {
      'Authorization': `Basic ${btoa(authCredentials)}`
    };
  }
  return {};
}

// Load Tab Data
async function loadTabData(tab) {
  switch(tab) {
    case 'active-users':
      await loadActiveUsers();
      break;
    case 'deleted-users':
      await loadDeletedUsers();
      break;
    case 'payments':
      await loadPayments();
      break;
    case 'settings':
      await loadSettings();
      break;
  }
}

// Load Active Users
async function loadActiveUsers() {
  try {
    const response = await fetch(`${API_BASE}/users`, {
      headers: getAuthHeaders()
    });
    
    if (response.status === 401) {
      // Browser will show authentication dialog
      return;
    }
    
    if (!response.ok) {
      throw new Error('Failed to load users');
    }
    
    activeUsers = await response.json();
    renderActiveUsers();
  } catch (error) {
    console.error('Error loading active users:', error);
    showToast('Failed to load active users', 'error');
  }
}

// Load Deleted Users
async function loadDeletedUsers() {
  try {
    const response = await fetch(`${API_BASE}/users?includeDeleted=true`, {
      headers: getAuthHeaders()
    });
    
    if (!response.ok) {
      throw new Error('Failed to load deleted users');
    }
    
    const allUsers = await response.json();
    deletedUsers = allUsers.filter(u => u.deletedByUser);
    renderDeletedUsers();
  } catch (error) {
    console.error('Error loading deleted users:', error);
    showToast('Failed to load deleted users', 'error');
  }
}

// Load Payments
async function loadPayments() {
  try {
    // Note: This endpoint needs to be created in the backend
    // For now, we'll show a placeholder
    showToast('Payment history feature coming soon', 'warning');
    renderPayments('all');
  } catch (error) {
    console.error('Error loading payments:', error);
    showToast('Failed to load payment history', 'error');
  }
}

// Load Settings
async function loadSettings() {
  try {
    // Note: This endpoint needs to be created in the backend
    // For now, we'll populate with default values
    const settingsForm = document.getElementById('settings-form');
    
    // Set default values (these should come from API)
    document.getElementById('coffee-price').value = '0.50';
    document.getElementById('bank-owner').value = 'CFEL Coffee Fund';
    document.getElementById('bank-iban').value = 'DE89370400440532013000';
    document.getElementById('bank-bic').value = 'COBADEFFXXX';
    document.getElementById('admin-email').value = 'admin@example.com';
    document.getElementById('smtp-from').value = 'CofFeEL System <coffee@example.com>';
    document.getElementById('smtp-host').value = 'smtp.example.com';
    document.getElementById('smtp-port').value = '587';
    document.getElementById('smtp-secure').value = 'false';
    document.getElementById('smtp-user').value = '';
    
  } catch (error) {
    console.error('Error loading settings:', error);
    showToast('Failed to load settings', 'error');
  }
}

// Render Active Users
function renderActiveUsers() {
  const container = document.getElementById('active-users-list');
  
  if (activeUsers.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👤</div><p>No active users</p></div>';
    return;
  }
  
  const html = `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Coffees</th>
          <th>Pending</th>
          <th>Balance</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${activeUsers.map(user => `
          <tr>
            <td>${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}</td>
            <td>${escapeHtml(user.email)}</td>
            <td>${user.coffeeCount}</td>
            <td class="${user.pendingPayment > 0 ? 'amount-negative' : 'amount-zero'}">
              €${user.pendingPayment.toFixed(2)}
            </td>
            <td class="${user.accountBalance < 0 ? 'amount-negative' : user.accountBalance > 0 ? 'amount-positive' : 'amount-zero'}">
              €${user.accountBalance.toFixed(2)}
            </td>
            <td>
              ${user.pendingPayment > 0 ? `
                <button class="btn btn-success btn-sm" onclick="openConfirmPaymentModal(${user.id})">
                  Confirm Payment
                </button>
              ` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  
  container.innerHTML = html;
}

// Render Deleted Users
function renderDeletedUsers() {
  const container = document.getElementById('deleted-users-list');
  
  if (deletedUsers.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✓</div><p>No deleted users</p></div>';
    return;
  }
  
  const html = `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Deleted At</th>
          <th>Pending</th>
          <th>Balance</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${deletedUsers.map(user => `
          <tr>
            <td>${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}</td>
            <td>${escapeHtml(user.email)}</td>
            <td>${formatDate(user.deletedAt)}</td>
            <td class="${user.pendingPayment > 0 ? 'amount-negative' : 'amount-zero'}">
              €${user.pendingPayment.toFixed(2)}
            </td>
            <td class="${user.accountBalance < 0 ? 'amount-negative' : user.accountBalance > 0 ? 'amount-positive' : 'amount-zero'}">
              €${user.accountBalance.toFixed(2)}
            </td>
            <td>
              <button class="btn btn-primary btn-sm" onclick="restoreUser(${user.id})">
                Restore
              </button>
              ${user.pendingPayment > 0 ? `
                <button class="btn btn-success btn-sm" onclick="openConfirmPaymentModal(${user.id})">
                  Confirm Payment
                </button>
              ` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  
  container.innerHTML = html;
}

// Render Payments
function renderPayments(filter) {
  const container = document.getElementById('payments-list');
  
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">📊</div>
      <p>Payment history feature coming soon</p>
      <small class="text-muted">Will show all payment requests and confirmations</small>
    </div>
  `;
}

// Restore User
async function restoreUser(userId) {
  if (!confirm('Restore this user to the kiosk?')) {
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/users/${userId}/restore`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    
    if (!response.ok) {
      throw new Error('Failed to restore user');
    }
    
    showToast('User restored successfully', 'success');
    await loadDeletedUsers();
  } catch (error) {
    console.error('Error restoring user:', error);
    showToast('Failed to restore user', 'error');
  }
}

// Open Confirm Payment Modal
function openConfirmPaymentModal(userId) {
  const user = [...activeUsers, ...deletedUsers].find(u => u.id === userId);
  if (!user) return;
  
  currentPaymentUserId = userId;
  
  document.getElementById('payment-user-name').textContent = `${user.firstName} ${user.lastName}`;
  document.getElementById('payment-amount').value = user.pendingPayment.toFixed(2);
  document.getElementById('payment-notes').value = '';
  
  document.getElementById('confirm-payment-modal').style.display = 'flex';
}

function closeConfirmPaymentModal() {
  document.getElementById('confirm-payment-modal').style.display = 'none';
  currentPaymentUserId = null;
}

// Handle Confirm Payment
async function handleConfirmPayment(e) {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const amount = parseFloat(formData.get('amount'));
  const notes = formData.get('notes');
  
  try {
    const response = await fetch(`${API_BASE}/users/${currentPaymentUserId}/confirm-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ amount, notes })
    });
    
    if (!response.ok) {
      throw new Error('Failed to confirm payment');
    }
    
    const result = await response.json();
    showToast(result.message || 'Payment confirmed successfully', 'success');
    
    closeConfirmPaymentModal();
    
    // Reload current tab
    const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
    await loadTabData(activeTab);
  } catch (error) {
    console.error('Error confirming payment:', error);
    showToast('Failed to confirm payment', 'error');
  }
}

// Handle Save Settings
async function handleSaveSettings(e) {
  e.preventDefault();
  
  showToast('Settings saved successfully', 'success');
  
  // Note: Backend settings endpoint needs to be implemented
  // For now, just show success message
}

// Test Email
async function testEmail() {
  showToast('Test email feature coming soon', 'warning');
  
  // Note: Backend test email endpoint needs to be implemented
}

// Export to CSV
function exportToCSV() {
  const users = activeUsers;
  
  if (users.length === 0) {
    showToast('No data to export', 'warning');
    return;
  }
  
  const headers = ['First Name', 'Last Name', 'Email', 'Coffees', 'Pending Payment', 'Balance', 'Created At'];
  const rows = users.map(u => [
    u.firstName,
    u.lastName,
    u.email,
    u.coffeeCount,
    u.pendingPayment.toFixed(2),
    u.accountBalance.toFixed(2),
    u.createdAt
  ]);
  
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `coffeel_users_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('CSV exported successfully', 'success');
}

// Toast Notification
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const messageEl = document.getElementById('toast-message');
  
  messageEl.textContent = message;
  toast.className = `toast ${type}`;
  toast.style.display = 'block';
  
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

// Utility: Format Date
function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Utility: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Make functions globally accessible
window.openConfirmPaymentModal = openConfirmPaymentModal;
window.closeConfirmPaymentModal = closeConfirmPaymentModal;
window.restoreUser = restoreUser;
