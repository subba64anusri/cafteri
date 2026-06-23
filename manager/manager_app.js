/* Manager Dashboard — single page, tab-based, switches canteens without a
   reload. Mirrors the original app's pattern: vanilla JS, render functions,
   event delegation, apiFetch + showToast for all server interaction. */
  
(function () {
  'use strict';

  const managerUsername = Session.getManager();
  if (!managerUsername) {
    window.location.href = 'login.html';
    return;
  }

  const CATEGORIES = ['Tiffins', 'Meals', 'Drinks', 'Snacks', 'Desserts'];

  let allCanteens = [];      // every canteen the platform knows about
  let activeCanteen = null;  // the canteen currently open in detail view, or null
  let activeTab = 'overview';
  let socket = null;

  // Per-tab state caches, reset whenever the active canteen changes.
  let menuCache = [];
  let selectedMenuCategory = 'Tiffins';
  let editingItemId = null;
  let activeOrders = [];
  let chefsCache = [];
  let editingChefId = null;
  let resettingChefId = null;
  let salesChart = null;
  let reportDataCache = null; // <-- Kept inside the closure safe from global collision


  // ---------------------------------------------------------------------
  // Navigation between "All Canteens" grid and a single canteen's detail
  // ---------------------------------------------------------------------
  const allCanteensView = document.getElementById('allCanteensView');
  const canteenDetailView = document.getElementById('canteenDetailView');
  const canteenSwitcherWrap = document.getElementById('canteenSwitcherWrap');
  const canteenSwitcher = document.getElementById('canteenSwitcher');
  const allCanteensBtn = document.getElementById('allCanteensBtn');

  function showAllCanteensView() {
    activeCanteen = null;
    allCanteensView.style.display = '';
    canteenDetailView.style.display = 'none';
    canteenSwitcherWrap.style.display = 'none';
    allCanteensBtn.style.display = 'none';
    loadCanteenGrid();
  }

  function showCanteenDetailView(canteen) {
    activeCanteen = canteen;
    activeTab = 'overview';
    allCanteensView.style.display = 'none';
    canteenDetailView.style.display = '';
    canteenSwitcherWrap.style.display = '';
    allCanteensBtn.style.display = '';

    document.getElementById('canteenDetailEyebrow').textContent = canteen.location || 'Canteen';
    document.getElementById('canteenDetailTitle').textContent = canteen.name;

    populateCanteenSwitcher();
    setActiveTabButton('overview');
    renderActiveTab();

    if (socket) socket.switchCanteen(canteen._id);
  }

  function populateCanteenSwitcher() {
    canteenSwitcher.innerHTML = allCanteens.map(c =>
      `<option value="${c._id}" ${activeCanteen && c._id === activeCanteen._id ? 'selected' : ''}>${escapeHtml(c.name)}${c.isActive ? '' : ' (disabled)'}</option>`
    ).join('');
  }

  canteenSwitcher.addEventListener('change', () => {
    const canteen = allCanteens.find(c => c._id === canteenSwitcher.value);
    if (canteen) showCanteenDetailView(canteen);
  });

  allCanteensBtn.addEventListener('click', showAllCanteensView);

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------
  function setActiveTabButton(tab) {
    document.querySelectorAll('.manager-tab').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.tab === tab);
    });
  }

  document.getElementById('managerTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.manager-tab');
    if (!btn) return;
    activeTab = btn.dataset.tab;
    setActiveTabButton(activeTab);
    renderActiveTab();
  });

  function renderActiveTab() {
    const mount = document.getElementById('tabContent');
    if (activeTab === 'overview') return renderOverviewTab(mount);
    if (activeTab === 'menu') return renderMenuTab(mount);
    if (activeTab === 'orders') return renderOrdersTab(mount);
    if (activeTab === 'chefs') return renderChefsTab(mount);
    if (activeTab === 'reports') return renderReportsTab(mount);
  }

  // =======================================================================
  // ALL-CANTEENS GRID
  // =======================================================================
  async function loadCanteenGrid() {
    const grid = document.getElementById('canteenGrid');
    try {
      allCanteens = await apiFetch('/api/manager/canteens');

      if (allCanteens.length === 0) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
          <div class="empty-state__icon">🏠</div>
          <div class="empty-state__title">No canteens yet</div>
          <p class="text-muted">Add your first canteen to get started.</p>
        </div>`;
        return;
      }

      const statsList = await Promise.all(
        allCanteens.map(c => apiFetch(`/api/manager/canteens/${c._id}/stats`).catch(() => null))
      );

      grid.innerHTML = allCanteens.map((c, i) => {
        const stats = statsList[i];
        return `
        <div class="card card--accent canteen-card">
          <span class="canteen-card__badge ${c.isActive ? 'canteen-card__badge--active' : 'canteen-card__badge--inactive'}">${c.isActive ? 'Active' : 'Disabled'}</span>
          <h3>${escapeHtml(c.name)}</h3>
          ${c.location ? `<div class="canteen-card__location">📍 ${escapeHtml(c.location)}</div>` : ''}
          ${c.description ? `<div class="canteen-card__description">${escapeHtml(c.description)}</div>` : ''}
          ${stats ? `
          <div class="canteen-card__stats">
            <div class="canteen-card__stat"><div class="canteen-card__stat-value">${formatRupees(stats.revenue)}</div><div class="canteen-card__stat-label">Today</div></div>
            <div class="canteen-card__stat"><div class="canteen-card__stat-value">${stats.orders}</div><div class="canteen-card__stat-label">Orders</div></div>
            <div class="canteen-card__stat"><div class="canteen-card__stat-value">${stats.menuCount}</div><div class="canteen-card__stat-label">Items</div></div>
            <div class="canteen-card__stat"><div class="canteen-card__stat-value">${stats.chefCount}</div><div class="canteen-card__stat-label">Chefs</div></div>
          </div>` : ''}
          <div class="canteen-card__actions">
            <button class="btn btn-primary btn-sm" data-open="${c._id}">Open</button>
            <button class="btn btn-outline btn-sm" data-edit-canteen="${c._id}">Edit</button>
            <button class="btn ${c.isActive ? 'btn-outline' : 'btn-primary'} btn-sm" data-toggle-canteen="${c._id}">${c.isActive ? 'Disable' : 'Enable'}</button>
            <button class="btn btn-danger btn-sm" data-delete-canteen="${c._id}">Delete</button>
          </div>
        </div>`;
      }).join('');

      grid.querySelectorAll('[data-open]').forEach(btn => {
        btn.addEventListener('click', () => {
          const canteen = allCanteens.find(c => c._id === btn.dataset.open);
          if (canteen) showCanteenDetailView(canteen);
        });
      });
      grid.querySelectorAll('[data-edit-canteen]').forEach(btn => {
        btn.addEventListener('click', () => openCanteenModal(btn.dataset.editCanteen));
      });
      grid.querySelectorAll('[data-toggle-canteen]').forEach(btn => {
        btn.addEventListener('click', () => toggleCanteenStatus(btn.dataset.toggleCanteen));
      });
      grid.querySelectorAll('[data-delete-canteen]').forEach(btn => {
        btn.addEventListener('click', () => deleteCanteen(btn.dataset.deleteCanteen));
      });
    } catch (err) {
      showToast(err.message, 'error');
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state__icon">⚠️</div>
        <div class="empty-state__title">Couldn't load canteens</div>
        <p class="text-muted">${escapeHtml(err.message)}</p>
      </div>`;
    }
  }

  // --- Canteen add/edit modal ---
  const canteenModalOverlay = document.getElementById('canteenModalOverlay');
  const canteenForm = document.getElementById('canteenForm');
  const canteenModalError = document.getElementById('canteenModalError');
  let editingCanteenId = null;

  function openCanteenModal(canteenId) {
    editingCanteenId = canteenId || null;
    canteenModalError.textContent = '';
    canteenForm.reset();
    document.getElementById('canteenModalTitle').textContent = canteenId ? 'Edit Canteen' : 'Add Canteen';

    if (canteenId) {
      const canteen = allCanteens.find(c => c._id === canteenId);
      if (canteen) {
        document.getElementById('canteenName').value = canteen.name;
        document.getElementById('canteenSlug').value = canteen.slug;
        document.getElementById('canteenLocation').value = canteen.location || '';
        document.getElementById('canteenDescription').value = canteen.description || '';
      }
    }
    canteenModalOverlay.classList.add('is-open');
  }

  document.getElementById('addCanteenBtn').addEventListener('click', () => openCanteenModal(null));
  document.getElementById('canteenModalCancelBtn').addEventListener('click', () => canteenModalOverlay.classList.remove('is-open'));
  canteenModalOverlay.addEventListener('click', (e) => { if (e.target === canteenModalOverlay) canteenModalOverlay.classList.remove('is-open'); });

  canteenForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    canteenModalError.textContent = '';

    const payload = {
      name: document.getElementById('canteenName').value.trim(),
      slug: document.getElementById('canteenSlug').value.trim(),
      location: document.getElementById('canteenLocation').value.trim(),
      description: document.getElementById('canteenDescription').value.trim()
    };

    const submitBtn = document.getElementById('canteenModalSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      if (editingCanteenId) {
        await apiFetch(`/api/manager/canteens/${editingCanteenId}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Canteen updated.');
      } else {
        await apiFetch('/api/manager/canteens', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Canteen added.');
      }
      canteenModalOverlay.classList.remove('is-open');
      loadCanteenGrid();
    } catch (err) {
      canteenModalError.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save';
    }
  });

  async function toggleCanteenStatus(canteenId) {
    const canteen = allCanteens.find(c => c._id === canteenId);
    if (!canteen) return;
    try {
      await apiFetch(`/api/manager/canteens/${canteenId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !canteen.isActive })
      });
      showToast(`"${canteen.name}" ${canteen.isActive ? 'disabled' : 'enabled'}.`);
      loadCanteenGrid();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function deleteCanteen(canteenId) {
    const canteen = allCanteens.find(c => c._id === canteenId);
    if (!confirm(`Delete "${canteen ? canteen.name : 'this canteen'}"? This only works if it has no menu items, orders, or chefs left.`)) return;
    try {
      await apiFetch(`/api/manager/canteens/${canteenId}`, { method: 'DELETE' });
      showToast('Canteen deleted.');
      loadCanteenGrid();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // =======================================================================
  // OVERVIEW TAB
  // =======================================================================
  async function renderOverviewTab(mount) {
    if (!activeCanteen) return;
    mount.innerHTML = `
      <div class="grid grid--3">
        <div class="card stat-card"><div class="stat-card__label">Today's revenue</div><div class="stat-card__value" id="ovRevenue">—</div></div>
        <div class="card stat-card"><div class="stat-card__label">Today's orders</div><div class="stat-card__value" id="ovOrders">—</div></div>
        <div class="card stat-card"><div class="stat-card__label">Menu items</div><div class="stat-card__value" id="ovMenuCount">—</div></div>
      </div>`;
    try {
      const stats = await apiFetch(`/api/manager/canteens/${activeCanteen._id}/stats`);
      document.getElementById('ovRevenue').textContent = formatRupees(stats.revenue);
      document.getElementById('ovOrders').textContent = stats.orders;
      document.getElementById('ovMenuCount').textContent = stats.menuCount;
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // =======================================================================
  // MENU TAB — mirrors the original menu.html admin UI, now canteen-scoped
  // =======================================================================
  function renderMenuTab(mount) {
    mount.innerHTML = `
      <div class="shell__header" style="margin-bottom:18px;">
        <div></div>
        <button class="btn btn-primary" id="addFoodBtn">+ Add item</button>
      </div>
      <div class="category-tabs" id="categoryTabs"></div>
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Food</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead>
          <tbody id="menuTableBody"></tbody>
        </table>
      </div>`;

    const categorySelect = document.getElementById('itemCategory');
    categorySelect.innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');

    renderCategoryTabs();
    fetchMenuForTab(selectedMenuCategory);

    document.getElementById('addFoodBtn').addEventListener('click', openAddItemModal);
  }

  function renderCategoryTabs() {
    const tabs = document.getElementById('categoryTabs');
    if (!tabs) return;
    tabs.innerHTML = CATEGORIES.map(cat => `
      <button class="category-tab ${cat === selectedMenuCategory ? 'is-active' : ''}" data-cat="${cat}">${cat}</button>
    `).join('');
    tabs.querySelectorAll('.category-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedMenuCategory = btn.dataset.cat;
        renderCategoryTabs();
        fetchMenuForTab(selectedMenuCategory);
      });
    });
  }

  function stockTag(item) {
    if (item.quantity <= 0) return `<span class="stock-tag is-out">Out of stock</span>`;
    if (item.quantity <= 5) return `<span class="stock-tag is-low">${item.quantity} left</span>`;
    return `<span class="stock-tag">${item.quantity}</span>`;
  }

  function renderMenuTable() {
    const tableBody = document.getElementById('menuTableBody');
    if (!tableBody) return;

    if (menuCache.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="empty-state__icon">📋</div><div class="empty-state__title">No items in ${escapeHtml(selectedMenuCategory)}</div><p class="text-muted">Add the first item to this category.</p></div></td></tr>`;
      return;
    }

    tableBody.innerHTML = menuCache.map(item => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td class="price-cell">${formatRupees(item.price)}</td>
        <td>${stockTag(item)}</td>
        <td class="action-cell">
          <button class="btn btn-outline btn-sm" data-edit="${item._id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-delete="${item._id}">Delete</button>
        </td>
      </tr>`).join('');

    tableBody.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => openEditItemModal(btn.dataset.edit)));
    tableBody.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', () => deleteMenuItem(btn.dataset.delete)));
  }

  async function fetchMenuForTab(category) {
    if (!activeCanteen) return; // Guard clause
    try {
      menuCache = await apiFetch(`/api/menu?canteenId=${activeCanteen._id}&category=${encodeURIComponent(category)}`);
      renderMenuTable();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const itemModalOverlay = document.getElementById('itemModalOverlay');
  const itemModalError = document.getElementById('itemModalError');
  const itemForm = document.getElementById('itemForm');

  function openAddItemModal() {
    editingItemId = null;
    document.getElementById('itemModalTitle').textContent = 'Add Item';
    itemForm.reset();
    document.getElementById('itemCategory').value = selectedMenuCategory;
    itemModalError.textContent = '';
    itemModalOverlay.classList.add('is-open');
  }

  function openEditItemModal(id) {
    const item = menuCache.find(i => i._id === id);
    if (!item) return;
    editingItemId = id;
    document.getElementById('itemModalTitle').textContent = 'Edit Item';
    document.getElementById('itemName').value = item.name;
    document.getElementById('itemPrice').value = item.price;
    document.getElementById('itemQuantity').value = item.quantity;
    document.getElementById('itemCategory').value = item.category;
    itemModalError.textContent = '';
    itemModalOverlay.classList.add('is-open');
  }

  document.getElementById('itemModalCancelBtn').addEventListener('click', () => itemModalOverlay.classList.remove('is-open'));
  itemModalOverlay.addEventListener('click', (e) => { if (e.target === itemModalOverlay) itemModalOverlay.classList.remove('is-open'); });

  itemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    itemModalError.textContent = '';

    const payload = {
      name: document.getElementById('itemName').value.trim(),
      price: Number(document.getElementById('itemPrice').value),
      quantity: Number(document.getElementById('itemQuantity').value),
      category: document.getElementById('itemCategory').value,
      canteenId: activeCanteen._id
    };

    const submitBtn = document.getElementById('itemModalSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      if (editingItemId) {
        await apiFetch(`/api/menu/${editingItemId}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Item updated.');
      } else {
        await apiFetch('/api/menu', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Item added.');
      }
      itemModalOverlay.classList.remove('is-open');
      fetchMenuForTab(selectedMenuCategory);
    } catch (err) {
      itemModalError.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save';
    }
  });

  async function deleteMenuItem(id) {
    const item = menuCache.find(i => i._id === id);
    if (!confirm(`Delete "${item ? item.name : 'this item'}"? This can't be undone.`)) return;
    try {
      await apiFetch(`/api/menu/${id}`, { method: 'DELETE' });
      showToast('Item deleted.');
      fetchMenuForTab(selectedMenuCategory);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // =======================================================================
  // ORDERS TAB — live ticket view, scoped to the active canteen
  // =======================================================================
  function renderOrdersTab(mount) {
    mount.innerHTML = `<div class="grid grid--auto" id="managerOrdersContainer"><div class="card skeleton" style="height:160px;"></div></div>`;
    loadActiveOrdersForTab();
  }

  async function loadActiveOrdersForTab() {
    if (!activeCanteen) return; // Guard clause
    try {
      activeOrders = await apiFetch(`/api/orders/active?canteenId=${activeCanteen._id}`);
      renderOrdersTable();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderOrdersTable() {
    const container = document.getElementById('managerOrdersContainer');
    if (!container) return; // tab no longer active

    if (activeOrders.length === 0) {
      container.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state__icon">🧾</div>
        <div class="empty-state__title">No pending orders</div>
        <p class="text-muted">New tickets for this canteen will appear here.</p>
      </div>`;
      return;
    }

    container.innerHTML = activeOrders.map(order => {
      const itemsList = order.items.map(i => `${escapeHtml(i.name)} <span class="qty">×${i.cartQuantity}</span>`).join('<br>');
      const isReady = order.status === 'Ready';
      let statusLabel = isReady ? '✅ Ready' : '🔔 Preparing';
      const actionButton = isReady
        ? `<button class="btn btn-outline btn-block" data-complete="${order._id}">Mark picked up</button>`
        : `<button class="btn btn-primary btn-block" data-ready="${order._id}">Mark ready ✔</button>`;

      return `
        <div class="ticket">
          <div class="ticket__head">
            <div class="ticket__token">#${order.token}</div>
            <span class="status-pill ${isReady ? 'status-pill--ready' : 'status-pill--preparing'}">${statusLabel}</span>
          </div>
          <div class="ticket__body">
            <div class="ticket__items">${itemsList}</div>
            ${actionButton}
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('[data-ready]').forEach(btn => btn.addEventListener('click', () => setOrderStatus(btn.dataset.ready, 'Ready')));
    container.querySelectorAll('[data-complete]').forEach(btn => btn.addEventListener('click', () => setOrderStatus(btn.dataset.complete, 'Completed')));
  }

  async function setOrderStatus(orderId, status) {
    try {
      await apiFetch(`/api/orders/${orderId}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      loadActiveOrdersForTab();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // =======================================================================
  // CHEFS TAB — manager-only chef CRUD, scoped to the active canteen
  // =======================================================================
  function renderChefsTab(mount) {
    mount.innerHTML = `
      <div class="shell__header" style="margin-bottom:18px;">
        <div></div>
        <button class="btn btn-primary" id="addChefBtn">+ Add chef</button>
      </div>
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Username</th><th>Name</th><th>Contact</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="chefTableBody"></tbody>
        </table>
      </div>`;

    document.getElementById('addChefBtn').addEventListener('click', () => openChefModal(null));
    loadChefsForTab();
  }

  async function loadChefsForTab() {
    if (!activeCanteen) return; // Guard clause
    try {
      chefsCache = await apiFetch(`/api/manager/chefs?canteenId=${activeCanteen._id}`);
      renderChefsTable();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderChefsTable() {
    const tbody = document.getElementById('chefTableBody');
    if (!tbody) return;

    if (chefsCache.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-state__icon">👨‍🍳</div><div class="empty-state__title">No chefs assigned yet</div><p class="text-muted">Add a chef to staff this canteen's kitchen.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = chefsCache.map(chef => `
      <tr>
        <td>${escapeHtml(chef.username)}</td>
        <td>${escapeHtml(chef.fullName || '—')}</td>
        <td>${escapeHtml(chef.contact || '—')}</td>
        <td><span class="role-badge ${chef.isActive ? 'role-badge--active' : 'role-badge--inactive'}">${chef.isActive ? 'Active' : 'Disabled'}</span></td>
        <td class="action-cell">
          <button class="btn btn-outline btn-sm" data-edit-chef="${chef._id}">Edit</button>
          <button class="btn btn-outline btn-sm" data-reset-chef="${chef._id}">Reset password</button>
          <button class="btn btn-danger btn-sm" data-delete-chef="${chef._id}">Delete</button>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-edit-chef]').forEach(btn => btn.addEventListener('click', () => openChefModal(btn.dataset.editChef)));
    tbody.querySelectorAll('[data-reset-chef]').forEach(btn => btn.addEventListener('click', () => openResetPasswordModal(btn.dataset.resetChef)));
    tbody.querySelectorAll('[data-delete-chef]').forEach(btn => btn.addEventListener('click', () => deleteChef(btn.dataset.deleteChef)));
  }

  const chefModalOverlay = document.getElementById('chefModalOverlay');
  const chefModalError = document.getElementById('chefModalError');
  const chefForm = document.getElementById('chefForm');
  const chefPasswordField = document.getElementById('chefPasswordField');
  const chefCanteenSelect = document.getElementById('chefCanteen');

  function openChefModal(chefId) {
    editingChefId = chefId || null;
    chefModalError.textContent = '';
    chefForm.reset();

    chefCanteenSelect.innerHTML = allCanteens.map(c => `<option value="${c._id}">${escapeHtml(c.name)}</option>`).join('');
    chefCanteenSelect.value = activeCanteen._id;

    if (chefId) {
      const chef = chefsCache.find(c => c._id === chefId);
      document.getElementById('chefModalTitle').textContent = 'Edit Chef';
      chefPasswordField.style.display = 'none'; // password changes go through Reset Password
      if (chef) {
        document.getElementById('chefUsername').value = chef.username;
        document.getElementById('chefUsername').disabled = true;
        document.getElementById('chefFullName').value = chef.fullName || '';
        document.getElementById('chefContact').value = chef.contact || '';
        document.getElementById('chefIsActive').value = String(chef.isActive);
        if (chef.canteen) chefCanteenSelect.value = chef.canteen.id;
      }
    } else {
      document.getElementById('chefModalTitle').textContent = 'Add Chef';
      chefPasswordField.style.display = '';
      document.getElementById('chefUsername').disabled = false;
    }

    chefModalOverlay.classList.add('is-open');
  }

  document.getElementById('chefModalCancelBtn').addEventListener('click', () => chefModalOverlay.classList.remove('is-open'));
  chefModalOverlay.addEventListener('click', (e) => { if (e.target === chefModalOverlay) chefModalOverlay.classList.remove('is-open'); });

  chefForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    chefModalError.textContent = '';

    const submitBtn = document.getElementById('chefModalSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      if (editingChefId) {
        await apiFetch(`/api/manager/chefs/${editingChefId}`, {
          method: 'PUT',
          body: JSON.stringify({
            fullName: document.getElementById('chefFullName').value.trim(),
            contact: document.getElementById('chefContact').value.trim(),
            isActive: document.getElementById('chefIsActive').value === 'true',
            canteenId: chefCanteenSelect.value
          })
        });
        showToast('Chef updated.');
      } else {
        const password = document.getElementById('chefPassword').value.trim();
        if (!password || password.length < 4) {
          chefModalError.textContent = 'Password must be at least 4 characters.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save';
          return;
        }
        await apiFetch('/api/manager/chefs', {
          method: 'POST',
          body: JSON.stringify({
            username: document.getElementById('chefUsername').value.trim(),
            password,
            fullName: document.getElementById('chefFullName').value.trim(),
            contact: document.getElementById('chefContact').value.trim(),
            canteenId: chefCanteenSelect.value
          })
        });
        showToast('Chef added.');
      }
      chefModalOverlay.classList.remove('is-open');
      loadChefsForTab();
    } catch (err) {
      chefModalError.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save';
    }
  });

  const resetPasswordModalOverlay = document.getElementById('resetPasswordModalOverlay');
  const resetPasswordForm = document.getElementById('resetPasswordForm');
  const resetPasswordModalError = document.getElementById('resetPasswordModalError');

  function openResetPasswordModal(chefId) {
    resettingChefId = chefId;
    const chef = chefsCache.find(c => c._id === chefId);
    document.getElementById('resetPasswordChefName').textContent = chef ? chef.username : '';
    document.getElementById('newChefPassword').value = '';
    resetPasswordModalError.textContent = '';
    resetPasswordModalOverlay.classList.add('is-open');
  }

  document.getElementById('resetPasswordCancelBtn').addEventListener('click', () => resetPasswordModalOverlay.classList.remove('is-open'));
  resetPasswordModalOverlay.addEventListener('click', (e) => { if (e.target === resetPasswordModalOverlay) resetPasswordModalOverlay.classList.remove('is-open'); });

  resetPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    resetPasswordModalError.textContent = '';
    const newPassword = document.getElementById('newChefPassword').value.trim();

    const submitBtn = document.getElementById('resetPasswordSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Resetting…';

    try {
      await apiFetch(`/api/manager/chefs/${resettingChefId}/reset-password`, {
        method: 'PUT',
        body: JSON.stringify({ newPassword })
      });
      showToast('Password reset.');
      resetPasswordModalOverlay.classList.remove('is-open');
    } catch (err) {
      resetPasswordModalError.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Reset';
    }
  });

  async function deleteChef(chefId) {
    const chef = chefsCache.find(c => c._id === chefId);
    if (!confirm(`Delete chef "${chef ? chef.username : ''}"? This can't be undone.`)) return;
    try {
      await apiFetch(`/api/manager/chefs/${chefId}`, { method: 'DELETE' });
      showToast('Chef deleted.');
      loadChefsForTab();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // =======================================================================
  // REPORTS TAB — mirrors the original reports.html chart+table, scoped
  // =======================================================================
  function renderReportsTab(mount) {
    mount.innerHTML = `
      <div class="shell__header" style="margin-bottom:18px;">
        <div></div>
        <button class="btn btn-primary btn-sm" id="exportReportPdfBtn">⬇ Export PDF</button>
      </div>
      <div class="layout-split" style="display:grid; grid-template-columns: 2fr 1fr; gap:22px; align-items:start;">
        <div class="card card--accent panel" style="padding:24px;">
          <h2>Item breakdown</h2>
          <div class="panel__sub" style="font-size:13px; color:var(--muted); margin-bottom:18px;">All-time units sold and revenue</div>
          <table>
            <thead><tr><th>Food item</th><th>Units sold</th><th>Revenue</th></tr></thead>
            <tbody id="reportTableBody"></tbody>
          </table>
        </div>
        <div class="card card--accent panel" style="padding:24px; text-align:center;">
          <h2>Revenue by category</h2>
          <div class="panel__sub" style="font-size:13px; color:var(--muted); margin-bottom:18px;">Where the money's coming from</div>
          <div class="chart-container"><canvas id="revenueChart"></canvas></div>
        </div>
      </div>
      <style>@media (max-width: 860px) { #tabContent .layout-split { grid-template-columns: 1fr !important; } }</style>`;

    document.getElementById('exportReportPdfBtn').addEventListener('click', exportReportPdf);

    loadReportsForTab();
  }

  async function loadReportsForTab() {
    if (!activeCanteen) return; // Guard clause
    try {
      const data = await apiFetch(`/api/reports/items?canteenId=${activeCanteen._id}`);
      reportDataCache = data;   // <-- Correctly writes to the IIFE cache variable
      const tbody = document.getElementById('reportTableBody');
      if (!tbody) return;

      if (data.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state"><div class="empty-state__icon">📊</div><div class="empty-state__title">No sales yet</div><p class="text-muted">Numbers will show up here once orders come in.</p></div></td></tr>`;
        renderManagerChart([]);
        return;
      }

      let totalUnits = 0, totalRevenue = 0;
      tbody.innerHTML = data.items.map(item => {
        totalUnits += item.units;
        totalRevenue += item.revenue;
        return `<tr><td>${escapeHtml(item.name)}</td><td class="qty-cell">${item.units} units</td><td class="price-cell">${formatRupees(item.revenue)}</td></tr>`;
      }).join('') + `<tr class="row--total"><td>Total</td><td>${totalUnits} units</td><td>${formatRupees(totalRevenue)}</td></tr>`;

      renderManagerChart(data.categories);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderManagerChart(categories) {
    const canvas = document.getElementById('revenueChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (salesChart) salesChart.destroy();
    if (categories.length === 0) return;

    salesChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: categories.map(c => c.category),
        datasets: [{ data: categories.map(c => c.revenue), backgroundColor: ['#2b5fd9', '#1f8a57', '#d9622b', '#d33c3c', '#9c4fd9'], borderWidth: 0 }]
      },
      options: { responsive: true, animation: { duration: 0 }, plugins: { legend: { position: 'bottom', labels: { color: '#14171f', font: { family: 'Inter', size: 12 } } } } }
    });
  }

  // Moved completely inside the IIFE closure to read local variables safely
  function exportReportPdf() {
    if (!reportDataCache) {
      showToast('Report data is still loading. Try again in a moment.', 'error');
      return;
    }

    const { items, categories } = reportDataCache;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });

    const canteenName = activeCanteen ? activeCanteen.name : 'Canteen';
    const generatedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

    // --- Header ---
    doc.setFontSize(18);
    doc.setTextColor(43, 95, 217); 
    doc.text('Sales Report', 40, 50);

    doc.setFontSize(11);
    doc.setTextColor(80, 80, 80);
    doc.text(`Canteen: ${canteenName}`, 40, 72);
    doc.text(`Generated: ${generatedAt}`, 40, 88);

    let cursorY = 110;

    // --- Item breakdown table ---
    if (!items || items.length === 0) {
      doc.setFontSize(12);
      doc.text('No sales yet.', 40, cursorY);
      cursorY += 24;
    } else {
      let totalUnits = 0, totalRevenue = 0;
      const rows = items.map(item => {
        totalUnits += item.units;
        totalRevenue += item.revenue;
        return [item.name, String(item.units), formatRupees(item.revenue)];
      });
      rows.push(['Total', String(totalUnits), formatRupees(totalRevenue)]);

      doc.autoTable({
        startY: cursorY,
        head: [['Food item', 'Units sold', 'Revenue']],
        body: rows,
        theme: 'grid',
        headStyles: { fillColor: [43, 95, 217], textColor: 255, fontStyle: 'bold' },
        bodyStyles: { fontSize: 10 },
        didParseCell: (data) => {
          if (data.row.index === rows.length - 1) {
            data.cell.styles.fontStyle = 'bold';
          }
        },
        margin: { left: 40, right: 40 }
      });

      cursorY = doc.lastAutoTable.finalY + 30;
    }

    // --- Category breakdown table ---
    if (categories && categories.length > 0) {
      doc.setFontSize(13);
      doc.setTextColor(20, 23, 31);
      doc.text('Revenue by category', 40, cursorY);
      cursorY += 12;

      const categoryRows = categories.map(c => [c.category, formatRupees(c.revenue)]);

      doc.autoTable({
        startY: cursorY,
        head: [['Category', 'Revenue']],
        body: categoryRows,
        theme: 'grid',
        headStyles: { fillColor: [43, 95, 217], textColor: 255, fontStyle: 'bold' },
        bodyStyles: { fontSize: 10 },
        margin: { left: 40, right: 40 }
      });
    }

    const fileSlug = canteenName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    doc.save(`sales-report-${fileSlug}-${Date.now()}.pdf`);
    showToast('Report exported.');
  }

  // =======================================================================
  // LOGOUT + REALTIME + BOOTSTRAP
  // =======================================================================
  document.getElementById('logoutBtn').addEventListener('click', () => {
    Session.clearManager();
    window.location.href = 'login.html';
  });

  (async () => {
    socket = await connectCanteenSocket({ role: 'manager' });
    if (socket) {
      socket.on('order:new', () => { if (activeCanteen && activeTab === 'orders') loadActiveOrdersForTab(); });
      socket.on('order:status', () => { if (activeCanteen && activeTab === 'orders') loadActiveOrdersForTab(); });
      socket.on('menu:update', () => { if (activeCanteen && activeTab === 'menu') fetchMenuForTab(selectedMenuCategory); });
    }
  })();

  showAllCanteensView();
})();