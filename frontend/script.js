const API_BASE_URL = "https://your-backend.vercel.app";

let currentUser = null;
let laptopList = [];
let studentBorrowings = [];

const $ = id => document.getElementById(id);

async function api(path, options = {}) {
  let response;

  try {
    response = await fetch(API_BASE_URL + path, {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json" },
      body: options.body === undefined
        ? undefined
        : JSON.stringify(options.body)
    });
  } catch {
    throw new Error("Cannot connect to the backend. Run node server.js first.");
  }

  let data = {};
  try {
    data = await response.json();
  } catch {}

  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Request failed: ${response.status}`);
  }

  return data;
}

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
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function badge(status) {
  const clean = String(status || "unknown").toLowerCase();
  return `<span class="status ${escapeHTML(clean)}">${escapeHTML(clean)}</span>`;
}

function authPage(page) {
  $("loginPage").classList.toggle("hidden", page !== "login");
  $("registerPage").classList.toggle("hidden", page !== "register");
  $("appShell").classList.add("hidden");
}

function logout() {
  currentUser = null;
  sessionStorage.removeItem("cpeBorrowingUser");

  authPage("login");
  $("loginForm").reset();
  setMessage("loginMessage", "");
}

function enterApp() {
  $("loginPage").classList.add("hidden");
  $("registerPage").classList.add("hidden");
  $("appShell").classList.remove("hidden");

  const isAdmin = currentUser.accountType === "admin";

  $("adminMenu").classList.toggle("hidden", !isAdmin);
  $("studentMenu").classList.toggle("hidden", isAdmin);

  $("headerUser").textContent = currentUser.fullName || currentUser.email;
  $("welcomeName").textContent = currentUser.fullName || "Student";

  $("profileName").textContent = currentUser.fullName || "";
  $("profileID").textContent = currentUser.institutionalId || "";
  $("profileEmail").textContent = currentUser.email || "";
  $("profileType").textContent = currentUser.accountType || "";

  showPage(isAdmin ? "adminDashboard" : "studentDashboard");
}

function showPage(pageId) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.toggle("active", page.id === pageId);
  });

  document.querySelectorAll(".sidebar-menu button[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === pageId);
  });

  const page = $(pageId);
  const title = page?.querySelector(".page-title h1, .welcome-box h2, h2");

  $("headerTitle").textContent = title?.textContent || "Dashboard";

  if (!currentUser) return;

  if (pageId === "studentDashboard") loadStudentLaptops();
  if (pageId === "studentHistory") loadHistory();
  if (pageId === "adminDashboard") loadAdminDashboard();
  if (pageId === "borrowRequests") loadRequests();
  if (pageId === "manageLaptops") loadInventory();
  if (pageId === "registeredUsers") loadUsers();
  if (pageId === "borrowingLogs") loadLogs();
}

async function login(event) {
  event.preventDefault();
  setMessage("loginMessage", "Signing in...");

  try {
    const result = await api("/api/login", {
      method: "POST",
      body: {
        email: $("loginEmail").value.trim(),
        password: $("loginPassword").value
      }
    });

    currentUser = result.user;

    sessionStorage.setItem("cpeBorrowingUser", JSON.stringify(currentUser));
    setMessage("loginMessage", "");
    enterApp();
  } catch (error) {
    setMessage("loginMessage", error.message, "error");
  }
}

async function register(event) {
  event.preventDefault();

  const fullName = $("registerName").value.trim();
  const institutionalId = $("registerID").value.trim();
  const email = $("registerEmail").value.trim().toLowerCase();
  const password = $("registerPassword").value;

  if (password !== $("confirmPassword").value) {
    setMessage("registerMessage", "Passwords do not match.", "error");
    return;
  }

  if (password.length < 8) {
    setMessage("registerMessage", "Password must be at least 8 characters.", "error");
    return;
  }

  setMessage("registerMessage", "Creating account...");

  try {
    const result = await api("/api/register", {
      method: "POST",
      body: { fullName, institutionalId, email, password }
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



async function loadStudentLaptops() {
  try {
    const [laptopResult, borrowingResult] = await Promise.all([
      api("/api/laptops"),
      api(`/api/borrowings/${encodeURIComponent(currentUser.id)}`)
    ]);

    laptopList = laptopResult.laptops || [];
    studentBorrowings = borrowingResult.history || [];

    renderLaptops();
  } catch (error) {
    setMessage("laptopMessage", error.message, "error");
  }
}





function renderLaptops() {
  const search = $("laptopSearch").value.trim().toLowerCase();
  const grid = $("laptopGrid");

  const filtered = laptopList.filter(laptop =>
    `${laptop.code} ${laptop.name}`.toLowerCase().includes(search)
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

    // Find this student's latest active request for this laptop.
    const ownRecord = studentBorrowings.find(record =>
      record.laptopId === laptop.id &&
      ["pending", "borrowed"].includes(record.status)
    );

    const status = document.createElement("p");
    let buttonLabel = "";
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

button.textContent = buttonLabel;
button.disabled = disabled;

    if (action) {
      button.addEventListener("click", () => action(button));
    }

    card.append(image, title, status, button);
    grid.append(card);
  });
}



async function requestLaptop(laptopId, button) {
  if (button.disabled) return;

  button.disabled = true;
  button.textContent = "Submitting...";

  try {
    const result = await api("/api/borrow", {
      method: "POST",
      body: {
        userId: currentUser.id,
        laptopId
      }
    });

    setMessage(
      "laptopMessage",
      result.message || "Laptop request submitted successfully.",
      "success"
    );

    // Refresh laptop inventory and this student's requests
    await loadStudentLaptops();
  } catch (error) {
    setMessage("laptopMessage", error.message, "error");

    // Restore the button if the request failed
    button.disabled = false;
    button.textContent = "Request Laptop";
  }
}


async function cancelRequest(laptopId, button) {
  if (!confirm("Are you sure you want to cancel this request?")) {
    return;
  }

  button.disabled = true;

  try {
    const result = await api("/api/cancel-request", {
      method: "POST",
      body: {
        userId: currentUser.id,
        laptopId
      }
    });

    setMessage("laptopMessage", result.message, "success");

    await loadStudentLaptops();
    await loadHistory();
  } catch (error) {
    setMessage("laptopMessage", error.message, "error");
    button.disabled = false;
  }
}


async function loadHistory() {
  try {
    const result = await api(
      `/api/borrowings/${encodeURIComponent(currentUser.id)}`
    );

    const history = result.history || [];
    const tbody = $("historyTable");
    tbody.replaceChildren();

    if (!history.length) {
      tbody.innerHTML = '<tr><td colspan="6">No borrowing history yet.</td></tr>';
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
  button.className = "reject-btn";
  button.textContent = "Cancel Request";

  button.addEventListener("click", async () => {
    await cancelRequest(record.laptopId, button);
  });

  action.append(button);
} else if (record.status === "borrowed") {
  const button = document.createElement("button");
  button.className = "return-btn";
  button.textContent = "Return Laptop";

  button.addEventListener("click", async () => {
    await returnLaptop(record.laptopId, button);
  });

  action.append(button);
} else {
  action.textContent = "—";
}


      tbody.append(tr);
    });
  } catch (error) {
    setMessage("historyMessage", error.message, "error");
  }
}

async function returnLaptop(laptopId, button) {
  if (!confirm("Confirm that you are returning this laptop?")) return;

  button.disabled = true;

  try {
    const result = await api("/api/return", {
      method: "POST",
      body: { userId: currentUser.id, laptopId }
    });

    setMessage("historyMessage", result.message, "success");

await loadStudentLaptops();
await loadHistory();
  } catch (error) {
    setMessage("historyMessage", error.message, "error");
    button.disabled = false;
  }
}

function adminQuery(path) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}userId=${encodeURIComponent(currentUser.id)}`;
}

async function loadAdminDashboard() {
  try {
    const result = await api(adminQuery("/api/admin/laptops"));
    const laptops = result.laptops || [];

    $("statTotal").textContent = laptops.length;
    $("statAvailable").textContent =
      laptops.filter(laptop => laptop.status === "available").length;
    $("statBorrowed").textContent =
      laptops.filter(laptop => laptop.status === "borrowed").length;

    const requests = await api(adminQuery("/api/admin/requests"));
    $("statPending").textContent = (requests.requests || []).length;
    await loadRecentActivity();
  } catch (error) {
    console.error("Dashboard:", error.message);
  }
}


async function loadRecentActivity() {
  const container = $("recentActivityList");

  if (!container) return;

  try {
    const result = await api(adminQuery("/api/admin/activity"));
    const activities = result.activities || [];

    container.replaceChildren();

    if (!activities.length) {
      const empty = document.createElement("p");
      empty.className = "activity-empty";
      empty.textContent = "No recent borrowing activity yet.";
      container.append(empty);
      return;
    }

    const icons = {
      request: "fa-laptop",
      cancel: "fa-times-circle",
      return: "fa-check-circle",
      approval: "fa-clipboard-check"
    };

    activities.forEach(activity => {
      const item = document.createElement("div");
      item.className = "activity-item";

      const icon = document.createElement("div");
      icon.className = `activity-icon ${activity.type}`;

      const iconElement = document.createElement("i");
      iconElement.className = `fas ${icons[activity.type] || "fa-history"}`;
      icon.append(iconElement);

      const details = document.createElement("div");
      details.className = "activity-details";

      const description = document.createElement("p");
      const student = document.createElement("strong");
      student.textContent = activity.studentName;

      description.append(
        student,
        document.createTextNode(
          ` ${activity.message} ${activity.laptopCode} — ${activity.laptopName}.`
        )
      );

      const meta = document.createElement("div");
      meta.className = "activity-meta";

      const date = new Date(activity.timestamp);
      meta.textContent = Number.isNaN(date.getTime())
        ? "Date unavailable"
        : date.toLocaleString();

      details.append(description, meta);
      item.append(icon, details);
      container.append(item);
    });
  } catch (error) {
    console.error("Recent activity:", error.message);

    container.replaceChildren();

    const message = document.createElement("p");
    message.className = "activity-empty";
    message.textContent = "Unable to load recent activity.";
    container.append(message);
  }
}


async function loadRequests() {
  try {
    const result = await api(adminQuery("/api/admin/requests"));
    const requests = result.requests || [];
    const tbody = $("requestsTable");
    tbody.replaceChildren();

    if (!requests.length) {
      tbody.innerHTML = '<tr><td colspan="6">No pending requests.</td></tr>';
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
      accept.className = "approve-btn";
      accept.textContent = "Accept";
      accept.addEventListener("click", () => {
  decideRequest(request.id, "accept", accept, reject);});

      const reject = document.createElement("button");
      reject.className = "reject-btn";
      reject.textContent = "Reject";
      reject.addEventListener("click", () => {
  decideRequest(request.id, "reject", accept, reject);});

      action.append(accept, reject);
      tbody.append(tr);
    });

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
        body: { userId: currentUser.id, decision }
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

async function loadInventory() {
  try {
    const result = await api(adminQuery("/api/admin/laptops"));
    const laptops = result.laptops || [];
    const tbody = $("inventoryTable");
    tbody.replaceChildren();

    if (!laptops.length) {
      tbody.innerHTML = '<tr><td colspan="4">No laptops in inventory.</td></tr>';
    }

    laptops.forEach(laptop => {
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${escapeHTML(laptop.laptop_code || laptop.code)}</td>
        <td>${escapeHTML(laptop.laptop_name || laptop.name)}</td>
        <td>${badge(laptop.status)}</td>
        <td></td>
      `;

      const editButton = document.createElement("button");
      editButton.className = "edit-btn";
      editButton.type = "button";
      editButton.innerHTML = '<i class="fas fa-pen"></i> Edit';
      editButton.addEventListener("click", () => openEditLaptop(laptop));

      const removeButton = document.createElement("button");
      removeButton.className = "delete-btn";
      removeButton.type = "button";
      removeButton.textContent = "Remove";
      removeButton.disabled = laptop.status === "borrowed";
      removeButton.addEventListener("click", () => removeLaptop(laptop.id));

      tr.lastElementChild.append(editButton, removeButton);
      tbody.append(tr);
    });
  } catch (error) {
    setMessage("inventoryMessage", error.message, "error");
  }
}

function openEditLaptop(laptop) {
  $("editLaptopId").value = laptop.id;
  $("editLaptopName").value = laptop.laptop_name || laptop.name || "";
  $("editLaptopCode").value = laptop.laptop_code || laptop.code || "";

  setMessage("editLaptopMessage", "");
  $("editLaptopPanel").classList.remove("hidden");
  $("editLaptopPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  $("editLaptopName").focus();
}

function cancelEditLaptop() {
  $("editLaptopForm").reset();
  $("editLaptopPanel").classList.add("hidden");
  setMessage("editLaptopMessage", "");
}

async function saveLaptopChanges(event) {
  event.preventDefault();

  const laptopId = $("editLaptopId").value;
  const laptopName = $("editLaptopName").value.trim();
  const laptopCode = $("editLaptopCode").value.trim();

  if (!laptopName || !laptopCode) {
    setMessage("editLaptopMessage", "Laptop name and code are required.", "error");
    return;
  }

  const saveButton = $("saveLaptopChanges");
  saveButton.disabled = true;
  setMessage("editLaptopMessage", "Saving changes...");

  try {
    const result = await api(
      `/api/admin/laptops/${encodeURIComponent(laptopId)}`,
      {
        method: "PATCH",
        body: { userId: currentUser.id, laptopName, laptopCode }
      }
    );

    setMessage(
      "inventoryMessage",
      result.message || "Laptop updated successfully.",
      "success"
    );

    cancelEditLaptop();
    await loadInventory();
    await loadStudentLaptops();
  } catch (error) {
    setMessage("editLaptopMessage", error.message, "error");
  } finally {
    saveButton.disabled = false;
  }
}

async function addLaptop(event) {
  event.preventDefault();

  try {
    const result = await api("/api/admin/laptops", {
      method: "POST",
      body: {
        userId: currentUser.id,
        laptopName: $("newLaptopName").value.trim(),
        laptopCode: $("newLaptopCode").value.trim()
      }
    });

    setMessage("inventoryMessage", result.message, "success");
    $("addLaptopForm").reset();
    await loadInventory();
  } catch (error) {
    setMessage("inventoryMessage", error.message, "error");
  }
}

async function removeLaptop(id) {
  if (!confirm("Remove this laptop from the inventory?")) return;

  try {
    const result = await api(
      `/api/admin/laptops/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        body: { userId: currentUser.id }
      }
    );

    setMessage("inventoryMessage", result.message, "success");
    await loadInventory();
  } catch (error) {
    setMessage("inventoryMessage", error.message, "error");
  }
}

async function loadUsers() {
  try {
    const result = await api(adminQuery("/api/admin/users"));
    const users = result.users || [];
    const tbody = $("usersTable");
    tbody.replaceChildren();

    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="4">No users found.</td></tr>';
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
        td.textContent = value || "—";
        tr.append(td);
      });

      tbody.append(tr);
    });
  } catch (error) {
    setMessage("usersMessage", error.message, "error");
  }
}

async function loadLogs() {
  try {
    const result = await api(adminQuery("/api/admin/logs"));
    const logs = result.logs || [];
    const tbody = $("logsTable");
    tbody.replaceChildren();

    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="6">No borrowing records.</td></tr>';
    }

    logs.forEach(record => {
      const tr = document.createElement("tr");

      [
        record.student?.name,
        record.student?.institutionalId,
        `${record.laptop?.code || ""} ${record.laptop?.name || ""}`.trim(),
        formatDate(record.borrowedAt),
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
  } catch (error) {
    setMessage("logsMessage", error.message, "error");
  }
}


function openProfileEditor() {
  $("editProfileName").value = currentUser.fullName || "";
  $("editProfileID").value = currentUser.institutionalId || "";
  $("editProfileEmail").value = currentUser.email || "";
  $("editProfileType").value = currentUser.accountType || "";

  $("profileView").classList.add("hidden");
  $("editProfileForm").classList.remove("hidden");
  setMessage("profileMessage", "");
}

function closeProfileEditor() {
  $("editProfileForm").classList.add("hidden");
  $("profileView").classList.remove("hidden");
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

  const saveButton = $("editProfileForm").querySelector(
    'button[type="submit"]'
  );

  saveButton.disabled = true;
  setMessage("profileMessage", "Saving changes...");

  try {
    const result = await api(
      `/api/profile/${encodeURIComponent(currentUser.id)}`,
      {
        method: "PATCH",
        body: { fullName, institutionalId }
      }
    );

    // Update the current session with the saved profile details.
    currentUser.fullName = result.profile.fullName;
    currentUser.institutionalId = result.profile.institutionalId;

    sessionStorage.setItem(
      "cpeBorrowingUser",
      JSON.stringify(currentUser)
    );

    // Refresh displayed profile information.
    $("profileName").textContent = currentUser.fullName;
    $("profileID").textContent = currentUser.institutionalId;
    $("profileEmail").textContent = currentUser.email || "";
    $("profileType").textContent = currentUser.accountType || "";

    $("headerUser").textContent =
      currentUser.fullName || currentUser.email;

    $("welcomeName").textContent = currentUser.fullName;

    closeProfileEditor();
    setMessage("profileMessage", result.message, "success");
  } catch (error) {
    setMessage("profileMessage", error.message, "error");
  } finally {
    saveButton.disabled = false;
  }
}


document.addEventListener("DOMContentLoaded", () => {
  $("loginForm").addEventListener("submit", login);
  $("registerForm").addEventListener("submit", register);
  $("editProfileBtn").addEventListener("click", openProfileEditor);

$("cancelProfileEdit").addEventListener("click", closeProfileEditor);

$("editProfileForm").addEventListener("submit", saveProfile);
  $("showRegister").addEventListener("click", event => {
    event.preventDefault();
    authPage("register");
  });

  $("showLogin").addEventListener("click", event => {
    event.preventDefault();
    authPage("login");
  });

  $("studentLogout").addEventListener("click", logout);
  $("adminLogout").addEventListener("click", logout);

  $("addLaptopForm").addEventListener("submit", addLaptop);
  $("editLaptopForm").addEventListener("submit", saveLaptopChanges);
  $("cancelEditLaptop").addEventListener("click", cancelEditLaptop);

  $("laptopSearch").addEventListener("input", renderLaptops);
  $("refreshRequests").addEventListener("click", loadRequests);

  document.querySelectorAll(".sidebar-menu button[data-page]").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });

  document.querySelectorAll("[data-goto]").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.goto));
  });

  const saved = sessionStorage.getItem("cpeBorrowingUser");

  if (saved) {
    try {
      currentUser = JSON.parse(saved);

      if (
        currentUser?.id &&
        ["student", "admin"].includes(currentUser.accountType)
      ) {
        enterApp();
      } else {
        logout();
      }
    } catch {
      logout();
    }
  } else {
    authPage("login");
  }
  
});