
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env");
  process.exit(1);
}

// This secret key must only be used by the backend.
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

app.use(cors({
  origin: process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(",").map(url => url.trim())
    : true
}));
app.use(express.json({ limit: "1mb" }));

const asyncRoute = handler => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

const clean = value => String(value ?? "").trim();

async function getProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, institutional_id, account_type")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// Authenticate requests using the Supabase access token.
const authenticate = asyncRoute(async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7).trim()
    : "";

  if (!token) return fail(res, 401, "Please log in again.");

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return fail(res, 401, "Your session has expired. Please log in again.");
  }

  req.authUser = data.user;
  req.profile = await getProfile(data.user.id);

  if (!req.profile) {
    return fail(res, 403, "Your account profile was not found.");
  }

  next();
});

const requireStudent = (req, res, next) => {
  if (req.profile?.account_type !== "student") {
    return fail(res, 403, "This action is only available to students.");
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (req.profile?.account_type !== "admin") {
    return fail(res, 403, "Administrator access is required.");
  }
  next();
};

async function getLaptop(laptopId) {
  const { data, error } = await supabase
    .from("laptops")
    .select("id, laptop_name, laptop_code, status")
    .eq("id", laptopId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getBorrowingRows(userId) {
  const { data, error } = await supabase
    .from("borrowings")
    .select("id, user_id, laptop_id, status, borrowed_at, returned_at")
    .eq("user_id", userId)
    .order("borrowed_at", { ascending: false });

  if (error) throw error;

  const laptopIds = [...new Set((data || []).map(row => row.laptop_id))];
  let laptops = [];

  if (laptopIds.length) {
    const result = await supabase
      .from("laptops")
      .select("id, laptop_name, laptop_code, status")
      .in("id", laptopIds);

    if (result.error) throw result.error;
    laptops = result.data || [];
  }

  const laptopMap = new Map(laptops.map(item => [item.id, item]));

  return (data || []).map(row => ({
    ...row,
    laptop: laptopMap.get(row.laptop_id) || null
  }));
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "CPE Laptop Borrowing Backend is running"
  });
});

// -------------------- REGISTER --------------------

app.post("/api/register", asyncRoute(async (req, res) => {
  const fullName = clean(req.body.fullName);
  const institutionalId = clean(req.body.institutionalId);
  const email = clean(req.body.email).toLowerCase();
  const password = String(req.body.password || "");

  if (!fullName || !institutionalId || !email || !password) {
    return fail(res, 400, "Please complete all registration fields.");
  }

  if (fullName.length > 100 || institutionalId.length > 50) {
    return fail(res, 400, "One or more fields are too long.");
  }

  if (password.length < 8) {
    return fail(res, 400, "Password must be at least 8 characters.");
  }

  // The existing profiles schema uses institutional_id as an integer.
  // Reject non-numeric values instead of silently storing invalid data.
  if (!/^\d+$/.test(institutionalId)) {
    return fail(res, 400, "Institutional ID must contain digits only.");
  }

  const numericId = Number(institutionalId);
  if (!Number.isSafeInteger(numericId)) {
    return fail(res, 400, "Institutional ID is invalid.");
  }

  const { data: existing, error: lookupError } = await supabase
    .from("profiles")
    .select("id")
    .eq("institutional_id", numericId)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (existing) return fail(res, 409, "That Institutional ID is already registered.");

  const { data: created, error: createError } =
    await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

  if (createError) {
    const duplicate = /already|registered|exists/i.test(createError.message || "");
    return fail(
      res,
      duplicate ? 409 : 400,
      duplicate ? "That email is already registered." : "Could not create the account. Check the details and try again."
    );
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .insert({
      id: created.user.id,
      full_name: fullName,
      institutional_id: numericId,
      account_type: "student"
    });

  if (profileError) {
    await supabase.auth.admin.deleteUser(created.user.id);
    if (profileError.code === "23505") {
      return fail(res, 409, "That Institutional ID is already registered.");
    }
    throw profileError;
  }

  res.status(201).json({
    success: true,
    message: "Registration successful. You can now log in."
  });
}));

// -------------------- LOGIN --------------------

app.post("/api/login", asyncRoute(async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const password = String(req.body.password || "");

  if (!email || !password) {
    return fail(res, 400, "Enter your email and password.");
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error || !data?.user || !data?.session) {
    return fail(res, 401, "Incorrect email or password.");
  }

  const profile = await getProfile(data.user.id);

  if (!profile || !["student", "admin"].includes(profile.account_type)) {
    return fail(res, 403, "Your account profile is missing or invalid.");
  }

  res.json({
    success: true,
    user: {
      id: profile.id,
      email: data.user.email,
      fullName: profile.full_name,
      institutionalId: profile.institutional_id,
      accountType: profile.account_type
    },
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at
    }
  });
}));

// -------------------- STUDENT PROFILE --------------------

app.patch("/api/profile/:userId", authenticate, requireStudent,
  asyncRoute(async (req, res) => {
    if (req.params.userId !== req.authUser.id) {
      return fail(res, 403, "You cannot edit another user's profile.");
    }

    const fullName = clean(req.body.fullName);
    const institutionalId = clean(req.body.institutionalId);

    if (!fullName || !institutionalId) {
      return fail(res, 400, "Full name and Institutional ID are required.");
    }

    if (fullName.length > 100 || !/^\d+$/.test(institutionalId)) {
      return fail(res, 400, "Enter a valid full name and numeric Institutional ID.");
    }

    const numericId = Number(institutionalId);
    if (!Number.isSafeInteger(numericId)) {
      return fail(res, 400, "Institutional ID is invalid.");
    }

    const { data: duplicate, error: duplicateError } = await supabase
      .from("profiles")
      .select("id")
      .eq("institutional_id", numericId)
      .neq("id", req.authUser.id)
      .maybeSingle();

    if (duplicateError) throw duplicateError;
    if (duplicate) return fail(res, 409, "That Institutional ID is already in use.");

    const { data, error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        institutional_id: numericId
      })
      .eq("id", req.authUser.id)
      .select("id, full_name, institutional_id, account_type")
      .single();

    if (error) throw error;

    res.json({
      success: true,
      user: {
        id: data.id,
        email: req.authUser.email,
        fullName: data.full_name,
        institutionalId: data.institutional_id,
        accountType: data.account_type
      }
    });
  })
);

// -------------------- LAPTOP INVENTORY (PUBLIC LIST) --------------------

app.get("/api/laptops", asyncRoute(async (req, res) => {
  const { data, error } = await supabase
    .from("laptops")
    .select("id, laptop_name, laptop_code, status")
    .order("laptop_code", { ascending: true });

  if (error) throw error;

  res.json({
    success: true,
    laptops: (data || []).map(item => ({
      id: item.id,
      name: item.laptop_name,
      code: item.laptop_code,
      status: item.status
    }))
  });
}));

// -------------------- STUDENT BORROWING --------------------

app.post("/api/borrow", authenticate, requireStudent,
  asyncRoute(async (req, res) => {
    const laptopId = clean(req.body.laptopId);
    if (!laptopId) return fail(res, 400, "Laptop ID is required.");

    const laptop = await getLaptop(laptopId);
    if (!laptop) return fail(res, 404, "Laptop not found.");
    if (laptop.status !== "available") {
      return fail(res, 409, "This laptop is not currently available.");
    }

    const { data: existing, error: existingError } = await supabase
      .from("borrowings")
      .select("id, status")
      .eq("user_id", req.authUser.id)
      .eq("laptop_id", laptopId)
      .in("status", ["pending", "borrowed"])
      .limit(1);

    if (existingError) throw existingError;
    if (existing?.length) {
      return fail(res, 409, "You already have a pending request or an active borrowing for this laptop.");
    }

    const { data, error } = await supabase
      .from("borrowings")
      .insert({
        user_id: req.authUser.id,
        laptop_id: laptopId,
        status: "pending",
        borrowed_at: new Date().toISOString()
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        return fail(res, 409, "A request for this laptop already exists.");
      }
      throw error;
    }

    res.status(201).json({
      success: true,
      message: "Borrowing request submitted. Wait for admin approval.",
      borrowingId: data.id
    });
  })
);

app.post("/api/cancel-request", authenticate, requireStudent,
  asyncRoute(async (req, res) => {
    const laptopId = clean(req.body.laptopId);
    if (!laptopId) return fail(res, 400, "Laptop ID is required.");

    const { data: request, error: findError } = await supabase
      .from("borrowings")
      .select("id")
      .eq("user_id", req.authUser.id)
      .eq("laptop_id", laptopId)
      .eq("status", "pending")
      .order("borrowed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;
    if (!request) return fail(res, 404, "No pending request was found.");

    const { data, error } = await supabase
      .from("borrowings")
      .update({ status: "cancelled" })
      .eq("id", request.id)
      .eq("user_id", req.authUser.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) return fail(res, 409, "This request has already been processed.");

    res.json({ success: true, message: "Borrowing request cancelled." });
  })
);

app.get("/api/borrowings/:userId", authenticate, requireStudent,
  asyncRoute(async (req, res) => {
    if (req.params.userId !== req.authUser.id) {
      return fail(res, 403, "You cannot view another user's borrowing history.");
    }

    const rows = await getBorrowingRows(req.authUser.id);

    res.json({
      success: true,
      borrowings: rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        laptopId: row.laptop_id,
        laptopName: row.laptop?.laptop_name || "Deleted laptop",
        laptopCode: row.laptop?.laptop_code || "N/A",
        status: row.status,
        requestedAt: row.borrowed_at,
        borrowedAt: row.status === "borrowed" || row.status === "returned"
          ? row.borrowed_at
          : null,
        returnedAt: row.returned_at
      }))
    });
  })
);

app.post("/api/return", authenticate, requireStudent,
  asyncRoute(async (req, res) => {
    const laptopId = clean(req.body.laptopId);
    if (!laptopId) return fail(res, 400, "Laptop ID is required.");

    const { data: borrowing, error: findError } = await supabase
      .from("borrowings")
      .select("id")
      .eq("user_id", req.authUser.id)
      .eq("laptop_id", laptopId)
      .eq("status", "borrowed")
      .order("borrowed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;
    if (!borrowing) return fail(res, 404, "No active borrowing was found for this laptop.");

    const { data: updated, error: updateError } = await supabase
      .from("borrowings")
      .update({
        status: "returned",
        returned_at: new Date().toISOString()
      })
      .eq("id", borrowing.id)
      .eq("status", "borrowed")
      .select("id")
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) return fail(res, 409, "This borrowing has already been processed.");

    const { error: laptopError } = await supabase
      .from("laptops")
      .update({ status: "available" })
      .eq("id", laptopId)
      .eq("status", "borrowed");

    if (laptopError) {
      console.error("Laptop status update failed after return:", laptopError);
      return fail(res, 500, "The return was recorded, but laptop availability could not be updated. Contact the administrator.");
    }

    res.json({ success: true, message: "Laptop return recorded successfully." });
  })
);

// -------------------- ADMIN: INVENTORY --------------------

app.get("/api/admin/laptops", authenticate, requireAdmin,
  asyncRoute(async (req, res) => {
    const { data, error } = await supabase
      .from("laptops")
      .select("id, laptop_name, laptop_code, status")
      .order("laptop_code", { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      laptops: (data || []).map(item => ({
        id: item.id,
        name: item.laptop_name,
        code: item.laptop_code,
        status: item.status
      }))
    });
  })
);

app.post("/api/admin/laptops", authenticate, requireAdmin,
  asyncRoute(async (req, res) => {
    const laptopName = clean(req.body.laptopName);
    const laptopCode = clean(req.body.laptopCode);

    if (!laptopName || !laptopCode) {
      return fail(res, 400, "Laptop name and code are required.");
    }

    const { data, error } = await supabase
      .from("laptops")
      .insert({
        laptop_name: laptopName,
        laptop_code: laptopCode,
        status: "available"
      })
      .select("id, laptop_name, laptop_code, status")
      .single();

    if (error?.code === "23505") {
      return fail(res, 409, "That laptop code is already in use.");
    }
    if (error) throw error;

    res.status(201).json({
      success: true,
      message: "Laptop added successfully.",
      laptop: data
    });
  })
);

app.patch("/api/admin/laptops/:id", authenticate, requireAdmin,
  asyncRoute(async (req, res) => {
    const laptopName = clean(req.body.laptopName);
    const laptopCode = clean(req.body.laptopCode);

    if (!laptopName || !laptopCode) {
      return fail(res, 400, "Laptop name and code are required.");
    }

    const { data, error } = await supabase
      .from("laptops")
      .update({
        laptop_name: laptopName,
        laptop_code: laptopCode
      })
      .eq("id", req.params.id)
      .select("id, laptop_name, laptop_code, status")
      .maybeSingle();

    if (error?.code === "23505") {
      return fail(res, 409, "That laptop code is already in use.");
    }
    if (error) throw error;
    if (!data) return fail(res, 404, "Laptop not found.");

    res.json({ success: true, message: "Laptop updated.", laptop: data });
  })
);

app.delete("/api/admin/laptops/:id", authenticate, requireAdmin,
  asyncRoute(async (req, res) => {
    const laptopId = req.params.id;

    const { data: active, error: activeError } = await supabase
      .from("borrowings")
      .select("id")
      .eq("laptop_id", laptopId)
      .in("status", ["pending", "borrowed"])
      .limit(1);

    if (activeError) throw activeError;
    if (active?.length) {
      return fail(res, 409, "Cannot remove a laptop with a pending request or active borrowing.");
    }

    const { error } = await supabase
      .from("laptops")
      .delete()
      .eq("id", laptopId);

    if (error?.code === "23503") {
      return fail(res, 409, "This laptop has borrowing history and cannot be deleted. Edit its details or keep it in the inventory instead.");
    }
    if (error) throw error;

    res.json({ success: true, message: "Laptop removed." });
  })
);

// -------------------- ADMIN: BORROW REQUESTS --------------------

app.get("/api/admin/requests", authenticate, requireAdmin,
  asyncRoute(async (req, res) => {
    const { data: rows, error } = await supabase
      .from("borrowings")
      .select("id, user_id, laptop_id, status, borrowed_at")
      .eq("status", "pending")
      .order("borrowed_at", { ascending: true });

    if (error) throw error;

    const userIds = [...new Set((rows || []).map(row => row.user_id))];
    const laptopIds = [...new Set((rows || []).map(row => row.laptop_id))];

    const [profilesResult, laptopsResult] = await Promise.all([
      userIds.length
        ? supabase.from("profiles")
            .select("id, full_name, institutional_id")
            .in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      laptopIds.length
        ? supabase.from("laptops")
            .select("id, laptop_name, laptop_code, status")
            .in("id", laptopIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (profilesResult.error) throw profilesResult.error;
    if (laptopsResult.error) throw laptopsResult.error;

    const profileMap = new Map((profilesResult.data || []).map(item => [item.id, item]));
    const laptopMap = new Map((laptopsResult.data || []).map(item => [item.id, item]));

    res.json({
      success: true,
      requests: (rows || []).map(row => {
        const profile = profileMap.get(row.user_id);
        const laptop = laptopMap.get(row.laptop_id);

        return {
          id: row.id,
          userId: row.user_id,
          studentName: profile?.full_name || "Unknown student",
          institutionalId: profile?.institutional_id ?? "N/A",
          laptopId: row.laptop_id,
          laptopName: laptop?.laptop_name || "Deleted laptop",
          laptopCode: laptop?.laptop_code || "N/A",
          laptopStatus: laptop?.status || "unknown",
          requestedAt: row.borrowed_at,
          status: row.status
        };
      })
    });
  })
);

app.post("/api/admin/requests/:id", authenticate, requireAdmin,
  asyncRoute(async (req, res) => {
    const decision = clean(req.body.decision).toLowerCase();

    if (!["accept", "reject"].includes(decision)) {
      return fail(res, 400, "Decision must be accept or reject.");
    }

    const { data: request, error: findError } = await supabase
      .from("borrowings")
      .select("id, laptop_id, status")
      .eq("id", req.params.id)
      .maybeSingle();

    if (findError) throw findError;
    if (!request) return fail(res, 404, "Borrowing request not found.");
    if (request.status !== "pending") {
      return fail(res, 409, "This request has already been processed.");
    }

    if (decision === "reject") {
      const { data, error } = await supabase
        .from("borrowings")
        .update({ status: "rejected" })
        .eq("id", request.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!data) return fail(res, 409, "This request has already been processed.");

      return res.json({ success: true, message: "Request rejected." });
    }

    // Only approve if the laptop is still available.
    const { data: laptop, error: laptopError } = await supabase
      .from("laptops")
      .update({ status: "borrowed" })
      .eq("id", request.laptop_id)
      .eq("status", "available")
      .select("id")
      .maybeSingle();

    if (laptopError) throw laptopError;
    if (!laptop) {
      return fail(res, 409, "This laptop is no longer available. Refresh the requests.");
    }

    const { data: updatedRequest, error: requestError } = await supabase
      .from("borrowings")
      .update({ status: "borrowed" })
      .eq("id", request.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (requestError || !updatedRequest) {
      // Best-effort rollback if the request update fails.
      await supabase
        .from("laptops")
        .update({ status: "available" })
        .eq("id", request.laptop_id)
        .eq("status", "borrowed");

      if (requestError) throw requestError;
      return fail(res, 409, "The request changed before it could be approved.");
    }

    res.json({ success: true, message: "Request approved. The laptop is now marked as borrowed." });
  })
);

// -------------------- ADMIN: USERS --------------------

app.get("/api/admin/users", authenticate, requireAdmin,
  asyncRoute(async (req, res) => {
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, full_name, institutional_id, account_type")
      .order("full_name", { ascending: true });

    if (error) throw error;

    const { data: authData, error: authError } =
      await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });

    if (authError) throw authError;

    const emailMap = new Map(
      (authData.users || []).map(user => [user.id, user.email || "N/A"])
    );

    res.json({
      success: true,
      users: (profiles || []).map(profile => ({
        id: profile.id,
        fullName: profile.full_name,
        institutionalId: profile.institutional_id,
        accountType: profile.account_type,
        email: emailMap.get(profile.id) || "N/A"
      }))
    });
  })
);

// -------------------- ADMIN: BORROWING LOGS --------------------

app.get("/api/admin/logs", authenticate, requireAdmin,
  asyncRoute(async (req, res) => {
    const { data: rows, error } = await supabase
      .from("borrowings")
      .select("id, user_id, laptop_id, status, borrowed_at, returned_at")
      .order("borrowed_at", { ascending: false });

    if (error) throw error;

    const userIds = [...new Set((rows || []).map(row => row.user_id))];
    const laptopIds = [...new Set((rows || []).map(row => row.laptop_id))];

    const [profilesResult, laptopsResult] = await Promise.all([
      userIds.length
        ? supabase.from("profiles")
            .select("id, full_name, institutional_id")
            .in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      laptopIds.length
        ? supabase.from("laptops")
            .select("id, laptop_name, laptop_code")
            .in("id", laptopIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (profilesResult.error) throw profilesResult.error;
    if (laptopsResult.error) throw laptopsResult.error;

    const profileMap = new Map((profilesResult.data || []).map(item => [item.id, item]));
    const laptopMap = new Map((laptopsResult.data || []).map(item => [item.id, item]));

    res.json({
      success: true,
      logs: (rows || []).map(row => {
        const profile = profileMap.get(row.user_id);
        const laptop = laptopMap.get(row.laptop_id);

        return {
          id: row.id,
          studentName: profile?.full_name || "Unknown student",
          institutionalId: profile?.institutional_id ?? "N/A",
          laptopName: laptop?.laptop_name || "Deleted laptop",
          laptopCode: laptop?.laptop_code || "N/A",
          requestedAt: row.borrowed_at,
          returnedAt: row.returned_at,
          status: row.status
        };
      })
    });
  })
);

// -------------------- ADMIN: RECENT ACTIVITY --------------------

app.get("/api/admin/activity", authenticate, requireAdmin,
  asyncRoute(async (req, res) => {
    const { data: rows, error } = await supabase
      .from("borrowings")
      .select("id, user_id, laptop_id, status, borrowed_at, returned_at")
      .order("borrowed_at", { ascending: false })
      .limit(20);

    if (error) throw error;

    const userIds = [...new Set((rows || []).map(row => row.user_id))];
    const laptopIds = [...new Set((rows || []).map(row => row.laptop_id))];

    const [profilesResult, laptopsResult] = await Promise.all([
      userIds.length
        ? supabase.from("profiles")
            .select("id, full_name")
            .in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      laptopIds.length
        ? supabase.from("laptops")
            .select("id, laptop_name, laptop_code")
            .in("id", laptopIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (profilesResult.error) throw profilesResult.error;
    if (laptopsResult.error) throw laptopsResult.error;

    const profileMap = new Map((profilesResult.data || []).map(item => [item.id, item]));
    const laptopMap = new Map((laptopsResult.data || []).map(item => [item.id, item]));

    res.json({
      success: true,
      activities: (rows || []).map(row => ({
        id: row.id,
        studentName: profileMap.get(row.user_id)?.full_name || "Unknown student",
        laptopName: laptopMap.get(row.laptop_id)?.laptop_name || "Deleted laptop",
        laptopCode: laptopMap.get(row.laptop_id)?.laptop_code || "N/A",
        status: row.status,
        date: row.returned_at || row.borrowed_at
      }))
    });
  })
);

// -------------------- ERROR HANDLER --------------------

app.use((err, req, res, next) => {
  console.error("API error:", err.message || err);

  if (res.headersSent) return next(err);

  res.status(500).json({
    success: false,
    message: "An unexpected server error occurred. Please try again."
  });
});

app.listen(PORT, () => {
  console.log(`CPE Laptop Borrowing Backend running on port ${PORT}`);
});
