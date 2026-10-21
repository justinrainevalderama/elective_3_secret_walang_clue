
const API_BASE_URL = (
  window.API_BASE_URL || "http://localhost:3000"
).replace(/\/+$/, "");

const USER_STORAGE_KEY = "cpeBorrowingUser";
const SESSION_STORAGE_KEY = "cpeBorrowingSession";

let currentUser = null;
let currentSession = null;
let laptopList = [];
let studentBorrowings = [];
let currentPage = "";

// -------------------- STORAGE AND API HELPERS --------------------

function readStoredJSON(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function saveSession(user, session) {
  currentUser = user;
  currentSession = session;

  sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  currentUser = null;
  currentSession = null;
  studentBorrowings = [];

  sessionStorage.removeItem(USER_STORAGE_KEY);
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

async function api(path, options = {}) {
  const headers = {
    ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };

  if (currentSession?.access_token) {
    headers.Authorization = `Bearer ${currentSession.access_token}`;
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      body: options.body === undefined
        ? undefined
        : typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body)
    });
  } catch {
    throw new Error(
      `Cannot connect to the backend at ${API_BASE_URL}. Check that the backend is running and that the API URL is correct.`
    );
  }

  let data = {};

  try {
    data = await response.json();
  } catch {
    // Handles non-JSON responses from hosting platforms.
  }

  if (!response.ok || data.success === false) {
    if (response.status === 401 && currentUser) {
      clearSession();
      authPage("login");
    }

    throw new Error(data.message || `Request failed (${response.status}).`);
  }

  return data;
}

function setMessage(elementId, message, type = "") {
  const element = document.getElementById(elementId);
  if (!element) return;

  element.textContent = message || "";
  element.classList.remove("error", "success");

  if (type) element.classList.add(type);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function statusBadge(status) {
  const safeStatus = String(status || "unknown").toLowerCase();
  return `<span class="status ${escapeHTML(safeStatus)}">${escapeHTML(safeStatus)}</span>`;
}

function emptyRow(columns, message = "No records to display.") {
  return `<tr><td colspan="${columns}">${escapeHTML(message)}</td></tr>`;
}

function userId() {
  return currentUser?.id || "";
}

// -------------------- AUTHENTICATION PAGES --------------------

function authPage(page) {
  document.getElementById("appShell")?.classList.add("hidden");
  document.getElementById("loginPage")?.classList.toggle("hidden", page !== "login");
  document.getElementById("registerPage")?.classList.toggle("hidden", page !== "register");

  if (page === "login") {
    setMessage("loginMessage", "");
  } else {
    setMessage("registerMessage", "");
  }
}

function logout() {
  clearSession();
  laptopList = [];
  studentBorrowings = [];
  currentPage = "";

  document.querySelectorAll(".sidebar-menu button").forEach(button => {
    button.classList.remove("active");
  });

  authPage("login");
  setMessage("loginMessage", "You have been logged out.", "success");
}

async function login(event) {
  event.preventDefault();
  setMessage("loginMessage", "");

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const button = event.submitter || document.querySelector("#loginForm button[type='submit']");

  if (button) button.disabled = true;

  try {
    const result = await api("/api/login", {
      method: "POST",
      body: { email, password }
    });

    if (!result.user || !result.session?.access_token) {
      throw new Error("The server did not return a valid login session.");
    }

    saveSession(result.user, result.session);
    document.getElementById("loginForm").reset();

    await enterApp();
  } catch (error) {
    setMessage("loginMessage", error.message, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function register(event) {
  event.preventDefault();
  setMessage("registerMessage", "");

  const fullName = document.getElementById("registerName").value.trim();
  const institutionalId = document.getElementById("registerID").value.trim();
  const email = document.getElementById("registerEmail").value.trim();
  const password = document.getElementById("registerPassword").value;
  const confirmPassword = document.getElementById("confirmPassword").value;
  const button = event.submitter || document.querySelector("#registerForm button[type='submit']");

  if (password !== confirmPassword) {
    setMessage("registerMessage", "Passwords do not match.", "error");
    return;
  }

  if (password.length < 8) {
    setMessage("registerMessage", "Password must be at least 8 characters.", "error");
    return;
  }

  if (!/^\d+$/.test(institutionalId)) {
    setMessage("registerMessage", "Institutional ID must contain digits only.", "error");
    return;
  }

  if (button) button.disabled = true;

  try {
    const result = await api("/api/register", {
      method: "POST",
      body: { fullName, institutionalId, email, password }
    });

    document.getElementById("registerForm").reset();
    authPage("login");
    setMessage("loginMessage", result.message || "Registration successful. You can now log in.", "success");
  } catch (error) {
    setMessage("registerMessage", error.message, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

// -------------------- ENTERING AND NAVIGATING THE APP --------------------

async function enterApp() {
  if (!currentUser || !currentSession?.access_token) {
    clearSession();
    authPage("login");
    return;
  }

  document.getElementById("loginPage").classList.add("hidden");
  document.getElementById("registerPage").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");

  const isAdmin = currentUser.accountType === "admin";

  document.getElementById("studentMenu").classList.toggle("hidden", isAdmin);
  document.getElementById("adminMenu").classList.toggle("hidden", !isAdmin);

  const name = currentUser.fullName || "User";
  document.getElementById("headerUser").textContent = name;
  document.getElementById("welcomeName").textContent = name;

  renderProfile();

  await showPage(isAdmin ? "adminDashboard" : "studentDashboard");
}

async function showPage(pageId) {
  const isAdmin = currentUser?.accountType === "admin";
  const adminPages = [
    "adminDashboard",
    "borrowRequests",
    "manageLaptops",
    "registeredUsers",
    "borrowingLogs"
  ];
  const studentPages = [
    "studentDashboard",
    "studentHistory",
    "studentProfile"
  ];

  if (isAdmin && !adminPages.includes(pageId)) pageId = "adminDashboard";
  if (!isAdmin && !studentPages.includes(pageId)) pageId = "studentDashboard";

  currentPage = pageId;

  document.querySelectorAll(".page").forEach(page => {
    page.classList.toggle("active", page.id === pageId);
  });

  document.querySelectorAll(".sidebar-menu button[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === pageId);
  });

  const pageTitles = {
    studentDashboard: "Dashboard",
    studentHistory: "My History",
    studentProfile: "My Profile",
    adminDashboard: "Admin Dashboard",
    borrowRequests: "Borrow Requests",
    manageLaptops: "Manage Laptops",
    registeredUsers: "Registered Users",
    borrowingLogs: "Borrowing Logs"
  };

  document.getElementById("headerTitle").textContent = pageTitles[pageId] || "Dashboard";

  try {
    if (pageId === "studentDashboard") await loadStudentLaptops();
    if (pageId === "studentHistory") await loadHistory();
    if (pageId === "studentProfile") renderProfile();
    if (pageId === "adminDashboard") await loadAdminDashboard();
    if (pageId === "borrowRequests") await loadRequests();
    if (pageId === "manageLaptops") await loadInventory();
    if (pageId === "registeredUsers") await loadUsers();
    if (pageId === "borrowingLogs") await loadLogs();
  } catch (error) {
    const target = {
      studentDashboard: "laptopMessage",
      studentHistory: "historyMessage",
      adminDashboard: "recentActivityList",
      borrowRequests: "requestsMessage",
      manageLaptops: "inventoryMessage",
      registeredUsers: "usersMessage",
      borrowingLogs: "logsMessage"
    }[pageId];

    if (target === "recentActivityList") {
      document.getElementById(target).innerHTML =
        `<p class="activity-empty">${escapeHTML(error.message)}</p>`;
    } else if (target) {
      setMessage(target, error.message, "error");
    }
  }
}

// -------------------- STUDENT LAPTOPS --------------------

async function loadStudentLaptops() {
  setMessage("laptopMessage", "");

  const [laptopResult, borrowingResult] = await Promise.all([
    api("/api/laptops"),
    api(`/api/borrowings/${encodeURIComponent(userId())}`)
  ]);

  laptopList = laptopResult.laptops || [];
  studentBorrowings = borrowingResult.borrowings || [];

  renderLaptops();
}

function getStudentLaptopBorrowing(laptopId) {
  return studentBorrowings.find(item =>
    item.laptopId === laptopId &&
    ["pending", "borrowed"].includes(String(item.status).toLowerCase())
  );
}


function renderLaptops() {
  const grid = document.getElementById("laptopGrid");
  const searchInput = document.getElementById("laptopSearch");
  const search = searchInput ? searchInput.value.trim().toLowerCase() : "";

  const filtered = laptopList.filter(laptop =>
    `${laptop.name} ${laptop.code} ${laptop.status}`
      .toLowerCase()
      .includes(search)
  );

  if (!filtered.length) {
    grid.innerHTML = `<p class="activity-empty">No laptops match your search.</p>`;
    return;
  }

  // Default laptop photo from Unsplash
  const laptopPhoto =
    "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=800&q=80";

  grid.innerHTML = filtered.map(laptop => {
    const status = String(laptop.status || "unknown").toLowerCase();
    const borrowing = getStudentLaptopBorrowing(laptop.id);
    let button = "";

    if (borrowing?.status === "pending") {
      button = `
        <button class="reject-btn" type="button"
          data-action="cancel-request"
          data-laptop-id="${escapeHTML(laptop.id)}">
          Cancel Request
        </button>`;
    } else if (borrowing?.status === "borrowed") {
      button = `
        <button class="return-btn" type="button"
          data-action="return-laptop"
          data-laptop-id="${escapeHTML(laptop.id)}">
          Return Laptop
        </button>`;
    } else if (status === "available") {
      button = `
        <button class="request-btn" type="button"
          data-action="request-laptop"
          data-laptop-id="${escapeHTML(laptop.id)}">
          Request to Borrow
        </button>`;
    } else {
      button = `
        <button class="requested-btn" type="button" disabled>
          Unavailable
        </button>`;
    }

    return `
      <article class="laptop-card">
        <img
          class="laptop-image"
          src="${laptopPhoto}"
          alt="${escapeHTML(laptop.name)} laptop"
          loading="lazy"
          onerror="
            const fallback = document.createElement('div');
            fallback.className = 'laptop-image';
            fallback.setAttribute('role', 'img');
            fallback.setAttribute('aria-label', 'Laptop image unavailable');
            fallback.innerHTML = '<i class=&quot;fas fa-laptop&quot; aria-hidden=&quot;true&quot;></i>';
            this.replaceWith(fallback);
          "
        >

        <div class="laptop-card-body">
          <h3>${escapeHTML(laptop.name)}</h3>
          <p><strong>Code:</strong> ${escapeHTML(laptop.code)}</p>
          <p><strong>Inventory status:</strong> ${escapeHTML(status)}</p>

          ${borrowing
            ? `<p><strong>Your request:</strong> ${escapeHTML(borrowing.status)}</p>`
            : ""}

          <div class="status ${escapeHTML(status)}">
            ${escapeHTML(status)}
          </div>

          ${button}
        </div>
      </article>
    `;
  }).join("");
}


async function requestLaptop(laptopId) {
  try {
    setMessage("laptopMessage", "");

    const result = await api("/api/borrow", {
      method: "POST",
      body: { laptopId }
    });

    setMessage("laptopMessage", result.message || "Request submitted.", "success");
    await loadStudentLaptops();
  } catch (error) {
    setMessage("laptopMessage", error.message, "error");
  }
}

async function cancelRequest(laptopId, messageTarget = "historyMessage") {
  try {
    const result = await api("/api/cancel-request", {
      method: "POST",
      body: { laptopId }
    });

    setMessage(messageTarget, result.message || "Request cancelled.", "success");

    if (currentPage === "studentDashboard") {
      await loadStudentLaptops();
    } else {
      await loadHistory();
      await loadStudentLaptops();
    }
  } catch (error) {
    setMessage(messageTarget, error.message, "error");
  }
}

async function returnLaptop(laptopId, messageTarget = "historyMessage") {
  try {
    const result = await api("/api/return", {
      method: "POST",
      body: { laptopId }
    });

    setMessage(messageTarget, result.message || "Laptop returned.", "success");
    await loadStudentLaptops();

    if (currentPage === "studentHistory") await loadHistory();
  } catch (error) {
    setMessage(messageTarget, error.message, "error");
  }
}

// -------------------- STUDENT HISTORY --------------------

async function loadHistory() {
  const tbody = document.getElementById("historyTable");
  setMessage("historyMessage", "");

  const result = await api(`/api/borrowings/${encodeURIComponent(userId())}`);
  studentBorrowings = result.borrowings || [];

  if (!studentBorrowings.length) {
    tbody.innerHTML = emptyRow(6, "You have no borrowing history yet.");
    return;
  }

  tbody.innerHTML = studentBorrowings.map(item => {
    const status = String(item.status || "").toLowerCase();
    let action = "—";

    if (status === "pending") {
      action = `<button class="reject-btn" data-action="cancel-request" data-laptop-id="${escapeHTML(item.laptopId)}">Cancel</button>`;
    } else if (status === "borrowed") {
      action = `<button class="return-btn" data-action="return-laptop" data-laptop-id="${escapeHTML(item.laptopId)}">Return</button>`;
    }

    return `
      <tr>
        <td>${escapeHTML(item.laptopCode)}</td>
        <td>${escapeHTML(item.laptopName)}</td>
        <td>${escapeHTML(formatDate(item.requestedAt))}</td>
        <td>${escapeHTML(formatDate(item.returnedAt))}</td>
        <td>${statusBadge(status)}</td>
        <td>${action}</td>
      </tr>
    `;
  }).join("");
}

// -------------------- STUDENT PROFILE --------------------

function renderProfile() {
  if (!currentUser) return;

  document.getElementById("profileName").textContent = currentUser.fullName || "";
  document.getElementById("profileID").textContent = currentUser.institutionalId ?? "";
  document.getElementById("profileEmail").textContent = currentUser.email || "";
  document.getElementById("profileType").textContent = currentUser.accountType || "";

  document.getElementById("editProfileName").value = currentUser.fullName || "";
  document.getElementById("editProfileID").value = currentUser.institutionalId ?? "";
  document.getElementById("editProfileEmail").value = currentUser.email || "";
  document.getElementById("editProfileType").value = currentUser.accountType || "";
}

function beginProfileEdit() {
  renderProfile();
  document.getElementById("profileView").classList.add("hidden");
  document.getElementById("editProfileForm").classList.remove("hidden");
  setMessage("profileMessage", "");
}

function cancelProfileEdit() {
  document.getElementById("profileView").classList.remove("hidden");
  document.getElementById("editProfileForm").classList.add("hidden");
  renderProfile();
  setMessage("profileMessage", "");
}

async function saveProfile(event) {
  event.preventDefault();
  setMessage("profileMessage", "");

  const fullName = document.getElementById("editProfileName").value.trim();
  const institutionalId = document.getElementById("editProfileID").value.trim();

  try {
    const result = await api(`/api/profile/${encodeURIComponent(userId())}`, {
      method: "PATCH",
      body: { fullName, institutionalId }
    });

    if (result.user) {
      currentUser = result.user;
      sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser));
    }

    document.getElementById("headerUser").textContent = currentUser.fullName;
    document.getElementById("welcomeName").textContent = currentUser.fullName;

    renderProfile();
    document.getElementById("profileView").classList.remove("hidden");
    document.getElementById("editProfileForm").classList.add("hidden");
    setMessage("profileMessage", result.message || "Profile updated successfully.", "success");
  } catch (error) {
    setMessage("profileMessage", error.message, "error");
  }
}

// -------------------- ADMIN DASHBOARD --------------------

async function loadAdminDashboard() {
  const [inventoryResult, requestsResult, logsResult] = await Promise.all([
    api("/api/admin/laptops"),
    api("/api/admin/requests"),
    api("/api/admin/logs")
  ]);

  const laptops = inventoryResult.laptops || [];
  const requests = requestsResult.requests || [];
  const logs = logsResult.logs || [];

  document.getElementById("statTotal").textContent = laptops.length;
  document.getElementById("statAvailable").textContent =
    laptops.filter(item => String(item.status).toLowerCase() === "available").length;
  document.getElementById("statBorrowed").textContent =
    laptops.filter(item => String(item.status).toLowerCase() === "borrowed").length;
  document.getElementById("statPending").textContent = requests.length;

  renderRecentActivity(logs);
}

function renderRecentActivity(logs) {
  const container = document.getElementById("recentActivityList");

  if (!logs.length) {
    container.innerHTML = `<p class="activity-empty">No borrowing activity yet.</p>`;
    return;
  }

  container.innerHTML = logs.slice(0, 8).map(item => {
    const status = String(item.status || "").toLowerCase();
    const iconClass = status === "returned"
      ? "return"
      : status === "borrowed"
        ? "approval"
        : status === "cancelled" || status === "rejected"
          ? "cancel"
          : "request";

    const icon = status === "returned"
      ? "fa-rotate-left"
      : status === "borrowed"
        ? "fa-check"
        : status === "cancelled" || status === "rejected"
          ? "fa-ban"
          : "fa-clipboard-list";

    return `
      <div class="activity-item">
        <div class="activity-icon ${iconClass}">
          <i class="fas ${icon}" aria-hidden="true"></i>
        </div>
        <div class="activity-details">
          <p><strong>${escapeHTML(item.studentName)}</strong> — ${escapeHTML(item.laptopName)} (${escapeHTML(item.laptopCode)})</p>
          <p>Status: ${escapeHTML(status)}</p>
          <span class="activity-meta">${escapeHTML(formatDate(item.returnedAt || item.requestedAt))}</span>
        </div>
      </div>
    `;
  }).join("");
}

// -------------------- ADMIN REQUESTS --------------------

async function loadRequests() {
  setMessage("requestsMessage", "");

  const result = await api("/api/admin/requests");
  const requests = result.requests || [];
  const tbody = document.getElementById("requestsTable");

  if (!requests.length) {
    tbody.innerHTML = emptyRow(6, "There are no pending requests.");
    return;
  }

  tbody.innerHTML = requests.map(request => `
    <tr>
      <td>${escapeHTML(request.studentName)}</td>
      <td>${escapeHTML(request.institutionalId)}</td>
      <td>${escapeHTML(request.laptopName)} (${escapeHTML(request.laptopCode)})</td>
      <td>${escapeHTML(formatDate(request.requestedAt))}</td>
      <td>${statusBadge(request.status)}</td>
      <td>
        <button class="approve-btn" data-action="decide-request" data-request-id="${escapeHTML(request.id)}" data-decision="accept">Accept</button>
        <button class="reject-btn" data-action="decide-request" data-request-id="${escapeHTML(request.id)}" data-decision="reject">Reject</button>
      </td>
    </tr>
  `).join("");
}

async function decideRequest(requestId, decision) {
  try {
    setMessage("requestsMessage", "");

    const result = await api(`/api/admin/requests/${encodeURIComponent(requestId)}`, {
      method: "POST",
      body: { decision }
    });

    setMessage("requestsMessage", result.message || "Request updated.", "success");

    await Promise.all([
      loadRequests(),
      loadInventory(),
      loadAdminDashboard()
    ]);
  } catch (error) {
    setMessage("requestsMessage", error.message, "error");
  }
}

// -------------------- ADMIN INVENTORY --------------------

async function loadInventory() {
  setMessage("inventoryMessage", "");

  const result = await api("/api/admin/laptops");
  const laptops = result.laptops || [];
  const tbody = document.getElementById("inventoryTable");

  if (!laptops.length) {
    tbody.innerHTML = emptyRow(4, "No laptops have been added.");
    return;
  }

  tbody.innerHTML = laptops.map(laptop => `
    <tr>
      <td>${escapeHTML(laptop.code)}</td>
      <td>${escapeHTML(laptop.name)}</td>
      <td>${statusBadge(laptop.status)}</td>
      <td>
        <button class="edit-btn" data-action="edit-laptop" data-laptop-id="${escapeHTML(laptop.id)}">Edit</button>
        <button class="delete-btn" data-action="delete-laptop" data-laptop-id="${escapeHTML(laptop.id)}">Remove</button>
      </td>
    </tr>
  `).join("");
}

async function addLaptop(event) {
  event.preventDefault();
  setMessage("inventoryMessage", "");

  const laptopName = document.getElementById("newLaptopName").value.trim();
  const laptopCode = document.getElementById("newLaptopCode").value.trim();

  try {
    const result = await api("/api/admin/laptops", {
      method: "POST",
      body: { laptopName, laptopCode }
    });

    document.getElementById("addLaptopForm").reset();
    setMessage("inventoryMessage", result.message || "Laptop added.", "success");

    await loadInventory();
    await loadAdminDashboard();
  } catch (error) {
    setMessage("inventoryMessage", error.message, "error");
  }
}

function beginLaptopEdit(laptopId) {
  const laptop = laptopList.find(item => item.id === laptopId);

  // Inventory data is fetched separately from the student laptop list.
  if (!laptop) {
    loadInventoryForEdit(laptopId);
    return;
  }

  fillLaptopEdit(laptop);
}

async function loadInventoryForEdit(laptopId) {
  try {
    const result = await api("/api/admin/laptops");
    const laptop = (result.laptops || []).find(item => item.id === laptopId);

    if (!laptop) {
      setMessage("inventoryMessage", "Laptop not found.", "error");
      return;
    }

    fillLaptopEdit(laptop);
  } catch (error) {
    setMessage("inventoryMessage", error.message, "error");
  }
}

function fillLaptopEdit(laptop) {
  document.getElementById("editLaptopId").value = laptop.id;
  document.getElementById("editLaptopName").value = laptop.name;
  document.getElementById("editLaptopCode").value = laptop.code;
  document.getElementById("editLaptopPanel").classList.remove("hidden");
  setMessage("editLaptopMessage", "");

  document.getElementById("editLaptopPanel").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function cancelLaptopEdit() {
  document.getElementById("editLaptopPanel").classList.add("hidden");
  document.getElementById("editLaptopForm").reset();
  setMessage("editLaptopMessage", "");
}

async function saveLaptopEdit(event) {
  event.preventDefault();
  setMessage("editLaptopMessage", "");

  const id = document.getElementById("editLaptopId").value;
  const laptopName = document.getElementById("editLaptopName").value.trim();
  const laptopCode = document.getElementById("editLaptopCode").value.trim();

  try {
    const result = await api(`/api/admin/laptops/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { laptopName, laptopCode }
    });

    setMessage("editLaptopMessage", result.message || "Laptop updated.", "success");
    await loadInventory();
    await loadAdminDashboard();
    cancelLaptopEdit();
    setMessage("inventoryMessage", "Laptop information updated.", "success");
  } catch (error) {
    setMessage("editLaptopMessage", error.message, "error");
  }
}

async function removeLaptop(laptopId) {
  if (!confirm("Are you sure you want to remove this laptop from the inventory?")) {
    return;
  }

  try {
    const result = await api(`/api/admin/laptops/${encodeURIComponent(laptopId)}`, {
      method: "DELETE"
    });

    setMessage("inventoryMessage", result.message || "Laptop removed.", "success");
    await loadInventory();
    await loadAdminDashboard();
  } catch (error) {
    setMessage("inventoryMessage", error.message, "error");
  }
}

// -------------------- ADMIN USERS AND LOGS --------------------

async function loadUsers() {
  setMessage("usersMessage", "");

  const result = await api("/api/admin/users");
  const users = result.users || [];
  const tbody = document.getElementById("usersTable");

  if (!users.length) {
    tbody.innerHTML = emptyRow(4, "No registered users found.");
    return;
  }

  tbody.innerHTML = users.map(user => `
    <tr>
      <td>${escapeHTML(user.fullName)}</td>
      <td>${escapeHTML(user.institutionalId)}</td>
      <td>${escapeHTML(user.email)}</td>
      <td>${statusBadge(user.accountType)}</td>
    </tr>
  `).join("");
}

async function loadLogs() {
  setMessage("logsMessage", "");

  const result = await api("/api/admin/logs");
  const logs = result.logs || [];
  const tbody = document.getElementById("logsTable");

  if (!logs.length) {
    tbody.innerHTML = emptyRow(6, "No borrowing logs found.");
    return;
  }

  tbody.innerHTML = logs.map(item => `
    <tr>
      <td>${escapeHTML(item.studentName)}</td>
      <td>${escapeHTML(item.institutionalId)}</td>
      <td>${escapeHTML(item.laptopName)} (${escapeHTML(item.laptopCode)})</td>
      <td>${escapeHTML(formatDate(item.requestedAt))}</td>
      <td>${escapeHTML(formatDate(item.returnedAt))}</td>
      <td>${statusBadge(item.status)}</td>
    </tr>
  `).join("");
}

// -------------------- CLICK HANDLERS --------------------

document.addEventListener("click", async event => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) {
    event.preventDefault();
    await showPage(pageButton.dataset.page);
    return;
  }

  const gotoButton = event.target.closest("[data-goto]");
  if (gotoButton) {
    event.preventDefault();
    await showPage(gotoButton.dataset.goto);
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;

  const action = actionButton.dataset.action;
  const laptopId = actionButton.dataset.laptopId;
  const requestId = actionButton.dataset.requestId;

  actionButton.disabled = true;

  try {
    if (action === "request-laptop") await requestLaptop(laptopId);
    if (action === "cancel-request") {
      const target = currentPage === "studentDashboard" ? "laptopMessage" : "historyMessage";
      await cancelRequest(laptopId, target);
    }
    if (action === "return-laptop") {
      const target = currentPage === "studentDashboard" ? "laptopMessage" : "historyMessage";
      await returnLaptop(laptopId, target);
    }
    if (action === "decide-request") {
      await decideRequest(requestId, actionButton.dataset.decision);
    }
    if (action === "edit-laptop") beginLaptopEdit(laptopId);
    if (action === "delete-laptop") await removeLaptop(laptopId);
  } finally {
    actionButton.disabled = false;
  }
});

// -------------------- FORM AND NAVIGATION EVENTS --------------------

document.getElementById("loginForm").addEventListener("submit", login);
document.getElementById("registerForm").addEventListener("submit", register);
document.getElementById("showRegister").addEventListener("click", event => {
  event.preventDefault();
  authPage("register");
});
document.getElementById("showLogin").addEventListener("click", event => {
  event.preventDefault();
  authPage("login");
});

document.getElementById("studentLogout").addEventListener("click", logout);
document.getElementById("adminLogout").addEventListener("click", logout);

document.getElementById("laptopSearch").addEventListener("input", renderLaptops);
document.getElementById("refreshRequests").addEventListener("click", loadRequests);
document.getElementById("addLaptopForm").addEventListener("submit", addLaptop);
document.getElementById("editLaptopForm").addEventListener("submit", saveLaptopEdit);
document.getElementById("cancelEditLaptop").addEventListener("click", cancelLaptopEdit);

document.getElementById("editProfileBtn").addEventListener("click", beginProfileEdit);
document.getElementById("cancelProfileEdit").addEventListener("click", cancelProfileEdit);
document.getElementById("editProfileForm").addEventListener("submit", saveProfile);

// -------------------- RESTORE SESSION --------------------

document.addEventListener("DOMContentLoaded", async () => {
  currentUser = readStoredJSON(USER_STORAGE_KEY);
  currentSession = readStoredJSON(SESSION_STORAGE_KEY);

  if (!currentUser || !currentSession?.access_token) {
    clearSession();
    authPage("login");
    return;
  }

  await enterApp();
});
