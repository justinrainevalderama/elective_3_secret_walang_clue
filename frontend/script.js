// ========================================
// CPE LAPTOP BORROWING SYSTEM
// Express + Supabase backend
// ========================================

const API_BASE_URL = "http://localhost:3000";

const laptopImage =
    "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=800&q=80";

let currentUser = null;
let laptops = [];
let currentSessionBorrowings = [];
let adminLogs = [];

// ========================================
// API HELPER
// ========================================

async function apiRequest(path, options = {}) {
    const config = {
        method: options.method || "GET",
        headers: {
            "Content-Type": "application/json"
        }
    };

    if (options.body !== undefined) {
        config.body = JSON.stringify(options.body);
    }

    let response;

    try {
        response = await fetch(`${API_BASE_URL}${path}`, config);
    } catch (error) {
        throw new Error(
            "Cannot connect to the backend. Make sure your Node.js server is running."
        );
    }

    let data = {};

    try {
        data = await response.json();
    } catch (error) {
        // Response is not JSON.
    }

    if (!response.ok || data.success === false) {
        throw new Error(
            data.message || `Request failed with status ${response.status}.`
        );
    }

    return data;
}

// ========================================
// GENERAL HELPERS
// ========================================

function valueOf(id) {
    const element = document.getElementById(id);
    return element ? element.value.trim() : "";
}

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}

function setVisible(id, visible) {
    const element = document.getElementById(id);

    if (element) {
        element.style.display = visible ? "block" : "none";
    }
}

function showMessage(message) {
    alert(message);
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

// ========================================
// LOGIN AND REGISTER NAVIGATION
// ========================================

function showLogin() {
    setVisible("loginPage", true);
    setVisible("registerPage", false);
    setVisible("userSystem", false);
    setVisible("adminSystem", false);
}

function showRegister() {
    setVisible("loginPage", false);
    setVisible("registerPage", true);
    setVisible("userSystem", false);
    setVisible("adminSystem", false);
}

// ========================================
// REGISTER STUDENT
// POST /api/register
// ========================================

async function registerUser() {
    const fullName = valueOf("registerName");
    const institutionalId = valueOf("registerStudentID");
    const email = valueOf("registerUsername").toLowerCase();
    const password = valueOf("registerPassword");
    const confirmPassword = valueOf("registerConfirmPassword");

    if (
        !fullName ||
        !institutionalId ||
        !email ||
        !password ||
        !confirmPassword
    ) {
        return showMessage("Please complete all registration fields.");
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return showMessage("Please enter a valid email address.");
    }

    if (password !== confirmPassword) {
        return showMessage("Passwords do not match.");
    }

    if (password.length < 8) {
        return showMessage("Password must be at least 8 characters.");
    }

    try {
        const data = await apiRequest("/api/register", {
            method: "POST",
            body: {
                fullName,
                institutionalId,
                email,
                password
            }
        });

        showMessage(
            data.message || "Student account created successfully."
        );

        [
            "registerName",
            "registerStudentID",
            "registerUsername",
            "registerPassword",
            "registerConfirmPassword"
        ].forEach(id => {
            const element = document.getElementById(id);

            if (element) {
                element.value = "";
            }
        });

        showLogin();
    } catch (error) {
        showMessage(error.message);
    }
}

// ========================================
// LOGIN
// POST /api/login
// ========================================


async function login() {
    // Support either email input ID used in your HTML.
    const emailInput =
        document.getElementById("loginEmail") ||
        document.getElementById("loginUsername");

    const passwordInput = document.getElementById("loginPassword");

    if (!emailInput || !passwordInput) {
        console.error("Login input elements were not found.", {
            emailInputFound: !!emailInput,
            passwordInputFound: !!passwordInput
        });

        showMessage(
            "Login form error. Check the email and password input IDs in index.html."
        );
        return;
    }

    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;

    if (!email || !password) {
        showMessage("Enter your email and password.");
        return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showMessage("Enter a valid email address.");
        return;
    }

    try {
        const data = await apiRequest("/api/login", {
            method: "POST",
            body: {
                email: email,
                password: password
            }
        });

        currentUser = data.user;

        if (!currentUser || !currentUser.id) {
            throw new Error(
                "Login succeeded, but the backend did not return a valid user."
            );
        }

        // Normalize the account type in case the backend returns account_type.
        currentUser.accountType =
            currentUser.accountType || currentUser.account_type;

        if (
            currentUser.accountType !== "admin" &&
            currentUser.accountType !== "student"
        ) {
            throw new Error(
                "Account type is missing or unsupported. Check the /api/login response."
            );
        }

        currentSessionBorrowings = [];

        sessionStorage.setItem(
            "cpeBorrowingUser",
            JSON.stringify(currentUser)
        );

        setVisible("loginPage", false);
        setVisible("registerPage", false);

        if (currentUser.accountType === "admin") {
            setVisible("userSystem", false);
            setVisible("adminSystem", true);
            await showAdminPage("adminDashboard", null);
        } else {
            setVisible("adminSystem", false);
            setVisible("userSystem", true);
            updateUserInformation();
            await showUserPage("dashboardPage", null);
        }

    } catch (error) {
        console.error("Login error:", error);
        showMessage(error.message || "Unable to log in. Please try again.");
    }
}


// ========================================
// STUDENT PROFILE
// ========================================

function updateUserInformation() {
    if (!currentUser) return;

    const fullName = currentUser.fullName || "Student";

    setText("welcomeName", fullName);
    setText("headerUserName", fullName);
    setText("profileName", fullName);
    setText(
        "profileStudentID",
        currentUser.institutionalId || "Not provided"
    );
    setText(
        "profileUsername",
        currentUser.email || "Not provided"
    );
}

function updateProfile() {
    showMessage(
        "Profile editing is not available in the current backend."
    );
}

// ========================================
// STUDENT PAGE NAVIGATION
// IMPORTANT: HTML uses class="page"
// ========================================

async function showUserPage(pageId, button) {
    document
        .querySelectorAll("#userSystem .page")
        .forEach(page => {
            page.style.display =
                page.id === pageId ? "block" : "none";
        });

    document
        .querySelectorAll("#userSystem .sidebar-menu button")
        .forEach(item => {
            item.classList.remove("active");
        });

    if (button) {
        button.classList.add("active");
    }

    if (pageId === "dashboardPage") {
        await loadLaptops();
    }

    if (pageId === "historyPage") {
    await loadBorrowingHistory();
    }

    if (pageId === "profilePage") {
        updateUserInformation();
    }
}

// ========================================
// ADMIN PAGE NAVIGATION
// IMPORTANT: HTML uses class="page"
// ========================================

async function showAdminPage(pageId, button) {
    document
        .querySelectorAll("#adminSystem .page")
        .forEach(page => {
            page.style.display =
                page.id === pageId ? "block" : "none";
        });

    document
        .querySelectorAll("#adminSystem .sidebar-menu button")
        .forEach(item => {
            item.classList.remove("active");
        });

    if (button) {
        button.classList.add("active");
    }

    if (
        pageId === "adminDashboard" ||
        pageId === "manageLaptopsPage"
    ) {
        await loadAdminLaptops();
    }

    if (pageId === "adminDashboard") {
    await loadRegisteredUserCount();
}

    if (pageId === "usersPage") {
        await loadAdminLogs();
        updateRegisteredUsers();
    }
}

// ========================================
// LOAD STUDENT LAPTOPS
// GET /api/laptops
// ========================================

async function loadLaptops() {
    try {
        const data = await apiRequest("/api/laptops");

        laptops = (data.laptops || []).map(item => ({
            id: item.id,
            name: item.name || item.laptop_name,
            number: item.code || item.laptop_code,
            status: String(item.status || "").toLowerCase()
        }));

        renderDashboardLaptops();
        updateStatistics();
    } catch (error) {
        showMessage(error.message);
    }
}

// ========================================
// CREATE LAPTOP CARD
// ========================================

function createLaptopCard(laptop) {
    const card = document.createElement("div");
    card.className = "laptop-card";

    const isAvailable = laptop.status === "available";

    const image = document.createElement("img");
    image.className = "laptop-image";
    image.src = laptopImage;
    image.alt = "Laptop";

    const title = document.createElement("h3");
    title.textContent = laptop.number || laptop.name || "Laptop";

    const status = document.createElement("p");
    status.className = `status ${
        isAvailable ? "available" : "borrowed"
    }`;
    status.textContent = isAvailable ? "Available" : "Borrowed";

    const button = document.createElement("button");
    button.textContent = isAvailable
        ? "Borrow Laptop"
        : "Currently Borrowed";
    button.disabled = !isAvailable;

    if (isAvailable) {
        button.addEventListener("click", () => {
            borrowLaptop(laptop.id);
        });
    }

    card.append(image, title, status, button);
    return card;
}

// ========================================
// DISPLAY LAPTOP CARDS
// ========================================

function renderDashboardLaptops() {
    const grid = document.getElementById("dashboardLaptopGrid");

    if (!grid) return;

    grid.innerHTML = "";

    if (laptops.length === 0) {
        grid.textContent = "No laptops are currently listed.";
        return;
    }

    laptops.forEach(laptop => {
        grid.appendChild(createLaptopCard(laptop));
    });
}


// Prevent multiple borrow requests from this page at once.
const laptopsBeingBorrowed = new Set();

// ========================================
// BORROW LAPTOP
// ========================================
async function borrowLaptop(laptopId) {
    if (!currentUser || !currentUser.id) {
        showMessage("Please log in first.");
        return;
    }

    if (!laptopId) {
        showMessage("Laptop ID is missing. Please refresh the page.");
        return;
    }

    const id = String(laptopId);

    if (laptopsBeingBorrowed.has(id)) {
        return;
    }

    laptopsBeingBorrowed.add(id);

    // Disable the clicked button while processing.
    const buttons = Array.from(
        document.querySelectorAll("button")
    );

    const clickedButton = buttons.find(button => {
        const handlerText = button.getAttribute("onclick") || "";
        return handlerText.includes(id) &&
            /borrowLaptop/.test(handlerText);
    });

    if (clickedButton) {
        clickedButton.disabled = true;
        clickedButton.dataset.originalText = clickedButton.textContent;
        clickedButton.textContent = "Processing...";
    }

    try {
        const data = await apiRequest("/api/borrow", {
            method: "POST",
            body: {
                userId: currentUser.id,
                laptopId: laptopId
            }
        });

        showMessage(data.message || "Laptop borrowed successfully.");

        await loadLaptops();
        await loadBorrowingHistory();

    } catch (error) {
        console.error("Borrow laptop error:", error);
        showMessage(error.message || "Failed to borrow laptop.");

    } finally {
        laptopsBeingBorrowed.delete(id);

        if (clickedButton) {
            clickedButton.disabled = false;
            clickedButton.textContent =
                clickedButton.dataset.originalText || "Borrow";
            delete clickedButton.dataset.originalText;
        }
    }
}



// ========================================
// RETURN LAPTOP FROM HISTORY
// ========================================
async function returnLaptop(laptopId) {
    if (!currentUser || !currentUser.id) {
        showMessage("Please log in first.");
        return;
    }

    if (!laptopId) {
        showMessage("Laptop ID is missing. Please refresh the page.");
        console.error("Invalid laptop ID:", laptopId);
        return;
    }

    try {
        const data = await apiRequest("/api/return", {
            method: "POST",
            body: {
                userId: currentUser.id,
                laptopId: laptopId
            }
        });

        showMessage(data.message || "Laptop returned successfully.");

        // Reload data from the backend and database
        await loadLaptops();
        await loadBorrowingHistory();

    } catch (error) {
        console.error("Return laptop error:", error);
        showMessage(error.message || "Failed to return laptop.");
    }
}



// ========================================
// LOAD STUDENT BORROWING HISTORY
// ========================================
async function loadBorrowingHistory() {
    if (!currentUser || !currentUser.id) {
        currentSessionBorrowings = [];
        await updateHistory();
        return;
    }

    try {
        const data = await apiRequest(
            `/api/borrowings/${encodeURIComponent(currentUser.id)}`
        );

        currentSessionBorrowings = (data.history || []).map(record => ({
            id: record.id,
            laptopId: record.laptopId,
            laptopCode: record.laptopCode,
            laptopName: record.laptopName,
            borrowedAt: record.borrowedAt,
            returnedAt: record.returnedAt,
            status: record.status
        }));

        await updateHistory();

    } catch (error) {
        console.error("Load borrowing history error:", error);
        showMessage(error.message || "Unable to load borrowing history.");
    }
}





// ========================================
// UPDATE BORROWING HISTORY TABLE
// ========================================
async function updateHistory() {
    const table = document.getElementById("historyTable");

    if (!table) {
        console.error("Element #historyTable was not found.");
        return;
    }

    table.innerHTML = "";

    if (!currentSessionBorrowings.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 7;
        cell.textContent = "No borrowing history found.";

        row.appendChild(cell);
        table.appendChild(row);
        return;
    }

    const formatDate = value => {
        if (!value) return "-";

        const date = new Date(value);

        return Number.isNaN(date.getTime())
            ? "-"
            : date.toLocaleDateString();
    };

    const formatTime = value => {
        if (!value) return "-";

        const date = new Date(value);

        return Number.isNaN(date.getTime())
            ? "-"
            : date.toLocaleTimeString();
    };

    currentSessionBorrowings.forEach(record => {
        const row = document.createElement("tr");

        const values = [
            record.laptopCode || record.laptopName || "-",
            formatDate(record.borrowedAt),
            formatTime(record.borrowedAt),
            formatDate(record.returnedAt),
            formatTime(record.returnedAt)
        ];

        values.forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
        });

        // Status
        const statusCell = document.createElement("td");
        const statusBadge = document.createElement("span");
        const isBorrowed = record.status === "borrowed";

        statusBadge.className = `status ${
            isBorrowed ? "borrowed" : "available"
        }`;

        statusBadge.textContent = isBorrowed
            ? "Borrowed"
            : "Returned";

        statusCell.appendChild(statusBadge);
        row.appendChild(statusCell);

        // Action
        const actionCell = document.createElement("td");

        if (isBorrowed) {
            const button = document.createElement("button");

            button.type = "button";
            button.className = "delete-btn";
            button.textContent = "Return";
            button.style.background = "#16a34a";

            button.addEventListener("click", async () => {
                // Pass the real database laptop ID.
                await returnLaptop(record.laptopId);
            });

            actionCell.appendChild(button);
        } else {
            actionCell.textContent = "-";
        }

        row.appendChild(actionCell);
        table.appendChild(row);
    });
}



// ========================================
// ADMIN: ADD LAPTOP
// POST /api/admin/laptops
// ========================================

async function addLaptop() {
    if (
        !currentUser ||
        currentUser.accountType !== "admin"
    ) {
        return showMessage("Admin access required.");
    }

    const codeInput = document.getElementById("newLaptopNumber");
    const laptopCode = codeInput
        ? codeInput.value.trim()
        : "";

    if (!laptopCode) {
        return showMessage(
            "Enter a laptop code, for example LAP-005."
        );
    }

    try {
        const data = await apiRequest("/api/admin/laptops", {
            method: "POST",
            body: {
                userId: currentUser.id,
                laptopName: `Laptop ${laptopCode}`,
                laptopCode
            }
        });

        if (codeInput) {
            codeInput.value = "";
        }

        showMessage(
            data.message || "Laptop added successfully."
        );

        await loadAdminLaptops();
    } catch (error) {
        showMessage(error.message);
    }
}

// ========================================
// ADMIN: REMOVE LAPTOP
// DELETE /api/admin/laptops/:laptopId
// ========================================

async function removeLaptop(laptopId) {
    if (
        !currentUser ||
        currentUser.accountType !== "admin"
    ) {
        return showMessage("Admin access required.");
    }

    const laptop = laptops.find(
        item => String(item.id) === String(laptopId)
    );

    if (laptop && laptop.status === "borrowed") {
        return showMessage(
            "You cannot remove a laptop that is currently borrowed."
        );
    }

    if (!confirm("Are you sure you want to remove this laptop?")) {
        return;
    }

    try {
        const data = await apiRequest(
            `/api/admin/laptops/${encodeURIComponent(laptopId)}`,
            {
                method: "DELETE",
                body: {
                    userId: currentUser.id
                }
            }
        );

        showMessage(
            data.message || "Laptop removed successfully."
        );

        await loadAdminLaptops();
    } catch (error) {
        showMessage(error.message);
    }
}

// ========================================
// ADMIN: LOAD LAPTOPS
// GET /api/admin/laptops
// ========================================

async function loadAdminLaptops() {
    if (
        !currentUser ||
        currentUser.accountType !== "admin"
    ) {
        return;
    }

    try {
        const data = await apiRequest(
            `/api/admin/laptops?userId=${encodeURIComponent(
                currentUser.id
            )}`
        );

        laptops = (data.laptops || []).map(item => ({
            id: item.id,
            name: item.laptop_name || item.name,
            number: item.laptop_code || item.code,
            status: String(item.status || "").toLowerCase()
        }));

        updateStatistics();
        updateAdminLaptopTable();
        renderDashboardLaptops();
    } catch (error) {
        showMessage(error.message);
    }
}

// ========================================
// ADMIN: BORROWING LOGS
// GET /api/admin/logs
// ========================================

async function loadAdminLogs() {
    if (
        !currentUser ||
        currentUser.accountType !== "admin"
    ) {
        return;
    }

    try {
        const data = await apiRequest(
            `/api/admin/logs?userId=${encodeURIComponent(
                currentUser.id
            )}`
        );

        adminLogs = data.logs || [];
    } catch (error) {
        adminLogs = [];
        showMessage(error.message);
    }
}

// ========================================
// ADMIN: STATISTICS
// ========================================


function updateStatistics() {
    setText("totalLaptops", laptops.length);

    setText(
        "availableLaptops",
        laptops.filter(laptop => laptop.status === "available").length
    );

    setText(
        "borrowedLaptops",
        laptops.filter(laptop => laptop.status === "borrowed").length
    );
}

async function loadRegisteredUserCount() {
    if (!currentUser || currentUser.accountType !== "admin") {
        setText("totalUsers", "—");
        return;
    }

    try {
        const data = await apiRequest(
            `/api/admin/users?userId=${encodeURIComponent(currentUser.id)}`
        );

        const students = (data.users || []).filter(
            user => user.accountType === "student"
        );

        setText("totalUsers", students.length);

    } catch (error) {
        console.error("Failed to load registered-user count:", error);
        setText("totalUsers", "—");
    }
}


// ========================================
// ADMIN: LAPTOP TABLE
// ========================================

function updateAdminLaptopTable() {
    const table = document.getElementById("adminLaptopTable");

    if (!table) return;

    table.innerHTML = "";

    if (laptops.length === 0) {
        table.innerHTML = `
            <tr>
                <td colspan="3">No laptops found.</td>
            </tr>
        `;
        return;
    }

    laptops.forEach(laptop => {
        const row = document.createElement("tr");

        const codeCell = document.createElement("td");
        codeCell.textContent = laptop.number || laptop.name || "Laptop";

        const statusCell = document.createElement("td");
        statusCell.textContent =
            laptop.status === "available"
                ? "Available"
                : "Borrowed";

        const actionCell = document.createElement("td");

        if (laptop.status !== "borrowed") {
            const button = document.createElement("button");
            button.className = "delete-btn";
            button.textContent = "Remove";

            button.addEventListener("click", () => {
                removeLaptop(laptop.id);
            });

            actionCell.appendChild(button);
        } else {
            actionCell.textContent = "Currently borrowed";
        }

        row.append(codeCell, statusCell, actionCell);
        table.appendChild(row);
    });
}

// ========================================
// DISPLAY REGISTERED USERS
// ========================================
async function updateRegisteredUsers() {
    const table = document.getElementById("registeredUsersTable");

    if (!table) {
        console.error(
            "Cannot find element with ID registeredUsersTable."
        );
        return;
    }

    table.innerHTML = `
        <tr>
            <td colspan="3">Loading registered users...</td>
        </tr>
    `;

    try {
        if (!currentUser || !currentUser.id) {
            throw new Error("Please log in as an administrator.");
        }

        const data = await apiRequest(
            `/api/admin/users?userId=${encodeURIComponent(currentUser.id)}`
        );

        const users = data.users || [];

        table.innerHTML = "";

        if (users.length === 0) {
            table.innerHTML = `
                <tr>
                    <td colspan="3">No registered users found.</td>
                </tr>
            `;
            return;
        }

        users.forEach(user => {
            // Show student accounts in the student list.
            if (user.accountType !== "student") {
                return;
            }

            const row = document.createElement("tr");

            const nameCell = document.createElement("td");
            nameCell.textContent = user.fullName;

            const idCell = document.createElement("td");
            idCell.textContent = user.institutionalId;

            const emailCell = document.createElement("td");
            emailCell.textContent = user.email;

            row.appendChild(nameCell);
            row.appendChild(idCell);
            row.appendChild(emailCell);

            table.appendChild(row);
        });

        if (table.children.length === 0) {
            table.innerHTML = `
                <tr>
                    <td colspan="3">No registered students found.</td>
                </tr>
            `;
        }

    } catch (error) {
        console.error("Failed to load registered users:", error);

        table.innerHTML = `
            <tr>
                <td colspan="3">Failed to load registered users.</td>
            </tr>
        `;

        showMessage(error.message);
    }
}

// ========================================
// LOGOUT
// ========================================

function logout() {
    currentUser = null;
    laptops = [];
    currentSessionBorrowings = [];
    adminLogs = [];

    sessionStorage.removeItem("cpeBorrowingUser");

    showLogin();
}

// ========================================
// RESTORE SESSION AFTER REFRESH
// ========================================

function restoreSession() {
    try {
        const savedUser = sessionStorage.getItem(
            "cpeBorrowingUser"
        );

        if (!savedUser) {
            showLogin();
            return;
        }

        currentUser = JSON.parse(savedUser);

        if (!currentUser || !currentUser.id) {
            currentUser = null;
            sessionStorage.removeItem("cpeBorrowingUser");
            showLogin();
            return;
        }

        setVisible("loginPage", false);
        setVisible("registerPage", false);

        if (currentUser.accountType === "admin") {
            setVisible("userSystem", false);
            setVisible("adminSystem", true);

            showAdminPage("adminDashboard", null);
        } else if (currentUser.accountType === "student") {
            setVisible("adminSystem", false);
            setVisible("userSystem", true);

            updateUserInformation();
            showUserPage("dashboardPage", null);
        } else {
            logout();
        }
    } catch (error) {
        currentUser = null;
        sessionStorage.removeItem("cpeBorrowingUser");
        showLogin();
    }
}

// ========================================
// INITIALIZE
// ========================================

restoreSession();