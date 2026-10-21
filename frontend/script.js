
const API_BASE_URL = "https://elective-3-secret-walang-clue.vercel.app";

let currentUser = null;
let accessToken = null;
let laptopList = [];
let studentBorrowings = [];

const $ = id => document.getElementById(id);

const USER_SESSION_KEY = "cpeBorrowingUser";
const TOKEN_SESSION_KEY = "cpeBorrowingToken";

// -------------------- API HELPER --------------------

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json"
  };

  // Protected backend routes require the Supabase access token.
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined
        ? undefined
        : JSON.stringify(options.body)
    });
  } catch (error) {
    console.error("Network request failed:", path, error);
    throw new Error(
      "Cannot connect to the backend. Check your internet connection and backend URL."
    );
  }

  let data = {};

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `The backend returned an invalid response (HTTP ${response.status}).`
    );
  }

  if (!response.ok || data.success === false) {
    console.error("API error:", path, response.status, data);

    if (response.status === 401) {
      throw new Error(
        data.message || "Your session has expired. Please log in again."
      );
    }

    throw new Error(
      data.message || `Request failed: HTTP ${response.status}`
    );
  }

  return data;
}

// -------------------- GENERAL HELPERS --------------------

function setMessage(id, text, type = "") {
  const element = $(id);
  if (!element) return;

  element.textContent = text || "";
  element.className = `feedback ${type}`.trim();
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

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString();
}

function badge(status) {
  const cleanStatus = String(status || "unknown").toLowerCase();

  return `<span class="status ${escapeHTML(cleanStatus)}">${escapeHTML(cleanStatus)}</span>`;
}

function saveSession() {
  if (currentUser) {
    sessionStorage.setItem(
      USER_SESSION_KEY,
      JSON.stringify(currentUser)
    );
  }

  if (accessToken) {
    sessionStorage.setItem(TOKEN_SESSION_KEY, accessToken);
  }
}

function clearSession() {
  currentUser = null;
  accessToken = null;
  laptopList = [];
  studentBorrowings = [];

  sessionStorage.removeItem(USER_SESSION_KEY);
  sessionStorage.removeItem(TOKEN_SESSION_KEY);
}

// -------------------- LOGIN / REGISTER / LOGOUT --------------------

function authPage(page) {
  $("loginPage")?.classList.toggle("hidden", page !== "login");
  $("registerPage")?.classList.toggle("hidden", page !== "register");
  $("appShell")?.classList.add("hidden");
}

function logout() {
  clearSession();

  authPage("login");

  $("loginForm")?.reset();
  $("registerForm")?.reset();

  setMessage("loginMessage", "");
  setMessage("registerMessage", "");
}

function enterApp() {
  if (!currentUser || !accessToken) {
    logout();
    return;
  }

  $("loginPage").classList.add("hidden");
  $("registerPage").classList.add("hidden");
  $("appShell").classList.remove("hidden");

  const isAdmin = currentUser.accountType === "admin";

  $("adminMenu").classList.toggle("hidden", !isAdmin);
  $("studentMenu").classList.toggle("hidden", isAdmin);

  $("headerUser").textContent =
    currentUser.fullName || currentUser.email || "User";

  $("welcomeName").textContent =
    currentUser.fullName || "Student";

  $("profileName").textContent = currentUser.fullName || "";
  $("profileID").textContent = currentUser.institutionalId ?? "";
  $("profileEmail").textContent = currentUser.email || "";
  $("profileType").textContent = currentUser.accountType || "";

  showPage(isAdmin ? "adminDashboard" : "studentDashboard");
}


async function login(event) {
  event.preventDefault();

  setMessage("loginMessage", "Signing in...");

  try {
    // Clear any old session before logging in.
    accessToken = null;
    currentUser = null;

    const result = await api("/api/login", {
      method: "POST",
      body: {
        email: $("loginEmail").value.trim().toLowerCase(),
        password: $("loginPassword").value
      }
    });

    if (!result.user || !result.session?.access_token) {
      console.error("Login response is missing required fields:", {
        hasUser: !!result.user,
        hasSession: !!result.session,
        hasAccessToken: !!result.session?.access_token
      });

      throw new Error(
        "Login succeeded, but the backend did not return an access token."
      );
    }

    // Save the user and access token.
    currentUser = result.user;
    accessToken = result.session.access_token;

    sessionStorage.setItem(
      "cpeBorrowingUser",
      JSON.stringify(currentUser)
    );

    sessionStorage.setItem(
      "cpeBorrowingToken",
      accessToken
    );

    console.log("Login successful. Token saved:", !!accessToken);
    console.log(
      "Token storage verified:",
      !!sessionStorage.getItem("cpeBorrowingToken")
    );

    setMessage("loginMessage", "");
    enterApp();

  } catch (error) {
    console.error("Login error:", error);
    setMessage("loginMessage", error.message, "error");
  }
}


async function register(event) {
  event.preventDefault();

  const fullName = $("registerName").value.trim();
  const institutionalId = $("registerID").value.trim();
  const email = $("registerEmail").value.trim().toLowerCase();
  const password = $("registerPassword").value;

  if (!fullName || !institutionalId || !email || !password) {
    setMessage(
      "registerMessage",
      "Please complete all registration fields.",
      "error"
    );
    return;
  }

  if (!/^\d+$/.test(institutionalId)) {
    setMessage(
      "registerMessage",
      "Institutional ID must contain digits only.",
      "error"
    );
    return;
  }

  if (password !== $("confirmPassword").value) {
    setMessage("registerMessage", "Passwords do not match.", "error");
    return;
  }

  if (password.length < 8) {
    setMessage(
      "registerMessage",
      "Password must be at least 8 characters.",
      "error"
    );
    return;
  }

  setMessage("registerMessage", "Creating account...");

  try {
    const result = await api("/api/register", {
      method: "POST",
      body: {
        fullName,
        institutionalId,
        email,
        password
      }
    });

    $("registerForm").reset();

    setMessage(
      "registerMessage",
      result.message || "Registration successful. You can now log in.",
      "success"
    );
  } catch (error) {
    setMessage("registerMessage", error.message, "error");
  }
}

// -------------------- PAGE NAVIGATION --------------------

function showPage(pageId) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.toggle("active", page.id === pageId);
  });

  document.querySelectorAll(
    ".sidebar-menu button[data-page]"
  ).forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === pageId
    );
  });

  const page = $(pageId);

  const title = page?.querySelector(
    ".page-title h1, .welcome-box h2, h2"
  );

  if ($("headerTitle")) {
    $("headerTitle").textContent =
      title?.textContent || "Dashboard";
  }

  if (!currentUser || !accessToken) return;

  if (pageId === "studentDashboard") loadStudentLaptops();
  if (pageId === "studentHistory") loadHistory();
  if (pageId === "adminDashboard") loadAdminDashboard();
  if (pageId === "borrowRequests") loadRequests();
  if (pageId === "manageLaptops") loadInventory();
  if (pageId === "registeredUsers") loadUsers();
  if (pageId === "borrowingLogs") loadLogs();
}

// -------------------- STUDENT: LAPTOP LIST --------------------

async function loadStudentLaptops() {
  if (!currentUser || !accessToken) return;

  try {
    const [laptopResult, borrowingResult] = await Promise.all([
      api("/api/laptops"),
      api(`/api/borrowings/${encodeURIComponent(currentUser.id)}`)
    ]);

    laptopList = laptopResult.laptops || [];

    // Backend returns "borrowings", not "history".
    studentBorrowings = borrowingResult.borrowings || [];

    renderLaptops();
    setMessage("laptopMessage", "");
  } catch (error) {
    setMessage("laptopMessage", error.message, "error");
  }
}

function renderLaptops() {
  const search = $("laptopSearch")?.value.trim().toLowerCase() || "";
  const grid = $("laptopGrid");

  if (!grid) return;

  const filtered = laptopList.filter(laptop =>
    `${laptop.code} ${laptop.name}`
      .toLowerCase()
      .includes(search)
  );

  grid.replaceChildren();

  if (!filtered.length) {
    grid.textContent = "No matching laptops found.";
    return;
  }

  filtered.forEach(laptop => {
    const card = document.createElement("article");
    card.className = "laptop-card";

    const image = document.createElement("img");
    image.className = "laptop-image";
    image.src =
      "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=700&q=80";
    image.alt = "Laptop";
    image.loading = "lazy";

    const title = document.createElement("h3");
    title.textContent = `${laptop.code} — ${laptop.name}`;

    const ownRecord = studentBorrowings.find(record =>
      String(record.laptopId) === String(laptop.id) &&
      ["pending", "borrowed"].includes(record.status)
    );

    const status = document.createElement("p");

    let buttonLabel;
    let action = null;
    let disabled = false;

    if (ownRecord?.status === "pending") {
      status.innerHTML = badge("pending");
      buttonLabel = "Cancel Request";
      action = button => cancelRequest(laptop.id, button);
    } else if (ownRecord?.status === "borrowed") {
      status.innerHTML = badge("borrowed");
      buttonLabel = "Return Laptop";
      action = button => returnLaptop(laptop.id, button);
    } else if (laptop.status === "available") {
      status.innerHTML = badge("available");
      buttonLabel = "Request Laptop";
      action = button => requestLaptop(laptop.id, button);
    } else {
      status.innerHTML = badge(laptop.status);
      buttonLabel = "Unavailable";
      disabled = true;
    }

    const button = document.createElement("button");

    if (buttonLabel === "Request Laptop") {
      button.className = "request-btn";
    } else if (buttonLabel === "Cancel Request") {
      button.className = "reject-btn";
    } else if (buttonLabel === "Return Laptop") {
      button.className = "return-btn";
    } else {
      button.className = "primary-btn";
    }

    button.type = "button";
    button.textContent = buttonLabel;
    button.disabled = disabled;

    if (action) {
      button.addEventListener("click", () => action(button));
    }

    card.append(image, title, status, button);
    grid.append(card);
  });
}

// -------------------- STUDENT: REQUEST LAPTOP --------------------

async function requestLaptop(laptopId, button) {
  if (button.disabled) return;

  button.disabled = true;
  button.textContent = "Submitting...";

  try {
    const result = await api("/api/borrow", {
      method: "POST",
      body: { laptopId }
    });

    setMessage(
      "laptopMessage",
      result.message || "Laptop request submitted successfully.",
      "success"
    );

    await loadStudentLaptops();
    await loadHistory();
  } catch (error) {
    setMessage("laptopMessage", error.message, "error");

    button.disabled = false;
    button.textContent = "Request Laptop";
  }
}

// -------------------- STUDENT: CANCEL REQUEST --------------------

async function cancelRequest(laptopId, button) {
  if (!confirm("Are you sure you want to cancel this request?")) {
    return;
  }

  if (button) button.disabled = true;

  try {
    const result = await api("/api/cancel-request", {
      method: "POST",
      body: { laptopId }
    });

    setMessage("laptopMessage", result.message, "success");
    setMessage("historyMessage", result.message, "success");

    await loadStudentLaptops();
    await loadHistory();
  } catch (error) {
    setMessage("laptopMessage", error.message, "error");
    setMessage("historyMessage", error.message, "error");

    if (button) button.disabled = false;
  }
}

// -------------------- STUDENT: BORROWING HISTORY --------------------

async function loadHistory() {
  if (!currentUser || !accessToken) return;

  try {
    const result = await api(
      `/api/borrowings/${encodeURIComponent(currentUser.id)}`
    );

    // Backend returns "borrowings", not "history".
    const history = result.borrowings || [];
    const tbody = $("historyTable");

    if (!tbody) return;

    tbody.replaceChildren();

    if (!history.length) {
      tbody.innerHTML =
        '<tr><td colspan="6">No borrowing history yet.</td></tr>';
      return;
    }

    history.forEach(record => {
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${escapeHTML(record.laptopCode)}</td>
        <td>${escapeHTML(record.laptopName)}</td>
        <td>${escapeHTML(formatDate(record.requestedAt || record.borrowedAt))}</td>
        <td>${escapeHTML(formatDate(record.returnedAt))}</td>
        <td>${badge(record.status)}</td>
        <td></td>
      `;

      const action = tr.lastElementChild;

      if (record.status === "pending") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "reject-btn";
        button.textContent = "Cancel Request";

        button.addEventListener("click", () =>
          cancelRequest(record.laptopId, button)
        );

        action.append(button);
      } else if (record.status === "borrowed") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "return-btn";
        button.textContent = "Return Laptop";

        button.addEventListener("click", () =>
          returnLaptop(record.laptopId, button)
        );

        action.append(button);
      } else {
        action.textContent = "—";
      }

      tbody.append(tr);
    });

    setMessage("historyMessage", "");
  } catch (error) {
    setMessage("historyMessage", error.message, "error");
  }
}

// -------------------- STUDENT: RETURN LAPTOP --------------------

async function returnLaptop(laptopId, button) {
  if (!confirm("Confirm that you are returning this laptop?")) {
    return;
  }

  if (button) button.disabled = true;

  try {
    const result = await api("/api/return", {
      method: "POST",
      body: { laptopId }
    });

    setMessage("historyMessage", result.message, "success");
    setMessage("laptopMessage", result.message, "success");

    await loadStudentLaptops();
    await loadHistory();
  } catch (error) {
    setMessage("historyMessage", error.message, "error");
    setMessage("laptopMessage", error.message, "error");

    if (button) button.disabled = false;
  }
}

// -------------------- ADMIN: DASHBOARD --------------------

async function loadAdminDashboard() {
  try {
    const result = await api("/api/admin/laptops");
    const laptops = result.laptops || [];

    if ($("statTotal")) {
      $("statTotal").textContent = laptops.length;
    }

    if ($("statAvailable")) {
      $("statAvailable").textContent =
        laptops.filter(laptop => laptop.status === "available").length;
    }

    if ($("statBorrowed")) {
      $("statBorrowed").textContent =
        laptops.filter(laptop => laptop.status === "borrowed").length;
    }

    const requestResult = await api("/api/admin/requests");

    if ($("statPending")) {
      $("statPending").textContent =
        (requestResult.requests || []).length;
    }

    await loadRecentActivity();
  } catch (error) {
    console.error("Dashboard error:", error);
    setMessage("dashboardMessage", error.message, "error");
  }
}

// -------------------- ADMIN: RECENT ACTIVITY --------------------

async function loadRecentActivity() {
  const container = $("recentActivityList");

  if (!container) return;

  try {
    const result = await api("/api/admin/activity");
    const activities = result.activities || [];

    container.replaceChildren();

    if (!activities.length) {
      const empty = document.createElement("p");
      empty.className = "activity-empty";
      empty.textContent = "No recent borrowing activity yet.";
      container.append(empty);
      return;
    }

    activities.forEach(activity => {
      const item = document.createElement("div");
      item.className = "activity-item";

      const status = String(activity.status || "").toLowerCase();

      const iconClasses = {
        pending: "fa-clock",
        borrowed: "fa-laptop",
        returned: "fa-check-circle",
        rejected: "fa-times-circle",
        cancelled: "fa-ban"
      };

      const icon = document.createElement("div");
      icon.className = "activity-icon";

      const iconElement = document.createElement("i");
      iconElement.className =
        `fas ${iconClasses[status] || "fa-history"}`;

      icon.append(iconElement);

      const details = document.createElement("div");
      details.className = "activity-details";

      const description = document.createElement("p");

      const student = document.createElement("strong");
      student.textContent = activity.studentName || "Unknown student";

      const laptopDescription =
        `${activity.laptopCode || "N/A"} — ${activity.laptopName || "Unknown laptop"}`;

      description.append(
        student,
        document.createTextNode(
          ` — ${status || "unknown"}: ${laptopDescription}.`
        )
      );

      const meta = document.createElement("div");
      meta.className = "activity-meta";
      meta.textContent = formatDate(activity.date);

      details.append(description, meta);
      item.append(icon, details);
      container.append(item);
    });
  } catch (error) {
    console.error("Recent activity error:", error);

    container.replaceChildren();

    const message = document.createElement("p");
    message.className = "activity-empty";
    message.textContent = error.message || "Unable to load recent activity.";

    container.append(message);
  }
}

// -------------------- ADMIN: BORROW REQUESTS --------------------

async function loadRequests() {
  try {
    const result = await api("/api/admin/requests");
    const requests = result.requests || [];
    const tbody = $("requestsTable");

    if (!tbody) return;

    tbody.replaceChildren();

    if (!requests.length) {
      tbody.innerHTML =
        '<tr><td colspan="6">No pending requests.</td></tr>';
      setMessage("requestsMessage", "");
      return;
    }

    requests.forEach(request => {
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${escapeHTML(request.studentName)}</td>
        <td>${escapeHTML(request.institutionalId)}</td>
        <td>${escapeHTML(request.laptopCode)} — ${escapeHTML(request.laptopName)}</td>
        <td>${escapeHTML(formatDate(request.requestedAt))}</td>
        <td>${badge(request.status)}</td>
        <td></td>
      `;

      const action = tr.lastElementChild;

      const accept = document.createElement("button");
      accept.type = "button";
      accept.className = "approve-btn";
      accept.textContent = "Accept";

      const reject = document.createElement("button");
      reject.type = "button";
      reject.className = "reject-btn";
      reject.textContent = "Reject";

      accept.addEventListener("click", () =>
        decideRequest(request.id, "accept", accept, reject)
      );

      reject.addEventListener("click", () =>
        decideRequest(request.id, "reject", accept, reject)
      );

      action.append(accept, reject);
      tbody.append(tr);
    });

    setMessage("requestsMessage", "");
  } catch (error) {
    setMessage("requestsMessage", error.message, "error");
  }
}

async function decideRequest(
  requestId,
  decision,
  acceptButton,
  rejectButton
) {
  if (!confirm(`Are you sure you want to ${decision} this request?`)) {
    return;
  }

  if (acceptButton) acceptButton.disabled = true;
  if (rejectButton) rejectButton.disabled = true;

  try {
    const result = await api(
      `/api/admin/requests/${encodeURIComponent(requestId)}`,
      {
        method: "POST",
        body: { decision }
      }
    );

    setMessage("requestsMessage", result.message, "success");

    await Promise.all([
      loadRequests(),
      loadInventory(),
      loadLogs(),
      loadAdminDashboard()
    ]);
  } catch (error) {
    setMessage("requestsMessage", error.message, "error");
  } finally {
    if (acceptButton) acceptButton.disabled = false;
    if (rejectButton) rejectButton.disabled = false;
  }
}

// -------------------- ADMIN: LAPTOP INVENTORY --------------------

async function loadInventory() {
  try {
    const result = await api("/api/admin/laptops");
    const laptops = result.laptops || [];
    const tbody = $("inventoryTable");

    if (!tbody) return;

    tbody.replaceChildren();

    if (!laptops.length) {
      tbody.innerHTML =
        '<tr><td colspan="4">No laptops in inventory.</td></tr>';
      return;
    }

    laptops.forEach(laptop => {
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${escapeHTML(laptop.code)}</td>
        <td>${escapeHTML(laptop.name)}</td>
        <td>${badge(laptop.status)}</td>
        <td></td>
      `;

      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "edit-btn";
      editButton.innerHTML = '<i class="fas fa-pen"></i> Edit';
      editButton.addEventListener("click", () => openEditLaptop(laptop));

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "delete-btn";
      removeButton.textContent = "Remove";
      removeButton.disabled = ["borrowed", "pending"].includes(laptop.status);

      removeButton.addEventListener("click", () =>
        removeLaptop(laptop.id)
      );

      tr.lastElementChild.append(editButton, removeButton);
      tbody.append(tr);
    });

    setMessage("inventoryMessage", "");
  } catch (error) {
    setMessage("inventoryMessage", error.message, "error");
  }
}

function openEditLaptop(laptop) {
  $("editLaptopId").value = laptop.id;
  $("editLaptopName").value = laptop.name || "";
  $("editLaptopCode").value = laptop.code || "";

  setMessage("editLaptopMessage", "");

  $("editLaptopPanel").classList.remove("hidden");
  $("editLaptopPanel").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  $("editLaptopName").focus();
}

function cancelEditLaptop() {
  $("editLaptopForm")?.reset();
  $("editLaptopPanel")?.classList.add("hidden");
  setMessage("editLaptopMessage", "");
}

async function saveLaptopChanges(event) {
  event.preventDefault();

  const laptopId = $("editLaptopId").value;
  const laptopName = $("editLaptopName").value.trim();
  const laptopCode = $("editLaptopCode").value.trim();

  if (!laptopName || !laptopCode) {
    setMessage(
      "editLaptopMessage",
      "Laptop name and code are required.",
      "error"
    );
    return;
  }

  const saveButton = $("saveLaptopChanges");

  if (saveButton) saveButton.disabled = true;

  setMessage("editLaptopMessage", "Saving changes...");

  try {
    const result = await api(
      `/api/admin/laptops/${encodeURIComponent(laptopId)}`,
      {
        method: "PATCH",
        body: { laptopName, laptopCode }
      }
    );

    setMessage(
      "inventoryMessage",
      result.message || "Laptop updated successfully.",
      "success"
    );

    cancelEditLaptop();

    await loadInventory();

    // Only student accounts can access the student borrowing endpoint.
    if (currentUser?.accountType === "student") {
      await loadStudentLaptops();
    }
  } catch (error) {
    setMessage("editLaptopMessage", error.message, "error");
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

async function addLaptop(event) {
  event.preventDefault();

  const laptopName = $("newLaptopName").value.trim();
  const laptopCode = $("newLaptopCode").value.trim();

  if (!laptopName || !laptopCode) {
    setMessage(
      "inventoryMessage",
      "Laptop name and code are required.",
      "error"
    );
    return;
  }

  try {
    const result = await api("/api/admin/laptops", {
      method: "POST",
      body: { laptopName, laptopCode }
    });

    setMessage("inventoryMessage", result.message, "success");

    $("addLaptopForm").reset();

    await loadInventory();
    await loadAdminDashboard();
  } catch (error) {
    setMessage("inventoryMessage", error.message, "error");
  }
}

async function removeLaptop(id) {
  if (!confirm("Remove this laptop from the inventory?")) {
    return;
  }

  try {
    const result = await api(
      `/api/admin/laptops/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );

    setMessage("inventoryMessage", result.message, "success");

    await loadInventory();
    await loadAdminDashboard();
  } catch (error) {
    setMessage("inventoryMessage", error.message, "error");
  }
}

// -------------------- ADMIN: REGISTERED USERS --------------------

async function loadUsers() {
  try {
    const result = await api("/api/admin/users");
    const users = result.users || [];
    const tbody = $("usersTable");

    if (!tbody) return;

    tbody.replaceChildren();

    if (!users.length) {
      tbody.innerHTML =
        '<tr><td colspan="4">No users found.</td></tr>';
      return;
    }

    users.forEach(user => {
      const tr = document.createElement("tr");

      [
        user.fullName,
        user.institutionalId,
        user.email,
        user.accountType
      ].forEach(value => {
        const td = document.createElement("td");
        td.textContent = value ?? "—";
        tr.append(td);
      });

      tbody.append(tr);
    });

    setMessage("usersMessage", "");
  } catch (error) {
    setMessage("usersMessage", error.message, "error");
  }
}

// -------------------- ADMIN: BORROWING LOGS --------------------

async function loadLogs() {
  try {
    const result = await api("/api/admin/logs");
    const logs = result.logs || [];
    const tbody = $("logsTable");

    if (!tbody) return;

    tbody.replaceChildren();

    if (!logs.length) {
      tbody.innerHTML =
        '<tr><td colspan="6">No borrowing records.</td></tr>';
      return;
    }

    logs.forEach(record => {
      const tr = document.createElement("tr");

      // Backend returns flat fields, not nested student/laptop objects.
      [
        record.studentName,
        record.institutionalId,
        `${record.laptopCode || ""} ${record.laptopName || ""}`.trim(),
        formatDate(record.requestedAt),
        formatDate(record.returnedAt)
      ].forEach(value => {
        const td = document.createElement("td");
        td.textContent = value || "—";
        tr.append(td);
      });

      const status = document.createElement("td");
      status.innerHTML = badge(record.status);

      tr.append(status);
      tbody.append(tr);
    });

    setMessage("logsMessage", "");
  } catch (error) {
    setMessage("logsMessage", error.message, "error");
  }
}

// -------------------- STUDENT: PROFILE --------------------

function openProfileEditor() {
  if (!currentUser) return;

  $("editProfileName").value = currentUser.fullName || "";
  $("editProfileID").value = currentUser.institutionalId ?? "";
  $("editProfileEmail").value = currentUser.email || "";
  $("editProfileType").value = currentUser.accountType || "";

  $("profileView").classList.add("hidden");
  $("editProfileForm").classList.remove("hidden");

  setMessage("profileMessage", "");
}

function closeProfileEditor() {
  $("editProfileForm")?.classList.add("hidden");
  $("profileView")?.classList.remove("hidden");
  setMessage("profileMessage", "");
}

async function saveProfile(event) {
  event.preventDefault();

  const fullName = $("editProfileName").value.trim();
  const institutionalId = $("editProfileID").value.trim();

  if (!fullName || !institutionalId) {
    setMessage(
      "profileMessage",
      "Full name and institutional ID are required.",
      "error"
    );
    return;
  }

  if (!/^\d+$/.test(institutionalId)) {
    setMessage(
      "profileMessage",
      "Institutional ID must contain digits only.",
      "error"
    );
    return;
  }

  const saveButton = $("editProfileForm").querySelector(
    'button[type="submit"]'
  );

  if (saveButton) saveButton.disabled = true;

  setMessage("profileMessage", "Saving changes...");

  try {
    const result = await api(
      `/api/profile/${encodeURIComponent(currentUser.id)}`,
      {
        method: "PATCH",
        body: { fullName, institutionalId }
      }
    );

    // Backend returns "user", not "profile".
    const updatedUser = result.user;

    if (!updatedUser) {
      throw new Error("The backend did not return the updated profile.");
    }

    currentUser.fullName = updatedUser.fullName;
    currentUser.institutionalId = updatedUser.institutionalId;

    saveSession();

    $("profileName").textContent = currentUser.fullName || "";
    $("profileID").textContent = currentUser.institutionalId ?? "";
    $("profileEmail").textContent = currentUser.email || "";
    $("profileType").textContent = currentUser.accountType || "";

    $("headerUser").textContent =
      currentUser.fullName || currentUser.email;

    $("welcomeName").textContent =
      currentUser.fullName || "Student";

    closeProfileEditor();

    setMessage(
      "profileMessage",
      "Profile updated successfully.",
      "success"
    );
  } catch (error) {
    setMessage("profileMessage", error.message, "error");
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

// -------------------- INITIALIZATION --------------------

document.addEventListener("DOMContentLoaded", () => {
  $("loginForm")?.addEventListener("submit", login);
  $("registerForm")?.addEventListener("submit", register);

  $("editProfileBtn")?.addEventListener("click", openProfileEditor);
  $("cancelProfileEdit")?.addEventListener("click", closeProfileEditor);
  $("editProfileForm")?.addEventListener("submit", saveProfile);

  $("showRegister")?.addEventListener("click", event => {
    event.preventDefault();
    authPage("register");
  });

  $("showLogin")?.addEventListener("click", event => {
    event.preventDefault();
    authPage("login");
  });

  $("studentLogout")?.addEventListener("click", logout);
  $("adminLogout")?.addEventListener("click", logout);

  $("addLaptopForm")?.addEventListener("submit", addLaptop);
  $("editLaptopForm")?.addEventListener("submit", saveLaptopChanges);
  $("cancelEditLaptop")?.addEventListener("click", cancelEditLaptop);

  $("laptopSearch")?.addEventListener("input", renderLaptops);
  $("refreshRequests")?.addEventListener("click", loadRequests);

  document.querySelectorAll(
    ".sidebar-menu button[data-page]"
  ).forEach(button => {
    button.addEventListener("click", () =>
      showPage(button.dataset.page)
    );
  });

  document.querySelectorAll("[data-goto]").forEach(button => {
    button.addEventListener("click", () =>
      showPage(button.dataset.goto)
    );
  });

  // Restore both the user and the Supabase token after a page refresh.
  const savedUser = sessionStorage.getItem(USER_SESSION_KEY);
  const savedToken = sessionStorage.getItem(TOKEN_SESSION_KEY);

  if (savedUser && savedToken) {
    try {
      currentUser = JSON.parse(savedUser);
      accessToken = savedToken;

      if (
        currentUser?.id &&
        ["student", "admin"].includes(currentUser.accountType)
      ) {
        enterApp();
      } else {
        logout();
      }
    } catch (error) {
      console.error("Could not restore session:", error);
      logout();
    }
  } else {
    logout();
  }
});
