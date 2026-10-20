
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  console.error("Missing Supabase settings in .env");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

async function getProfile(userId) {
  if (!userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, institutional_id, account_type")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function isAdmin(userId) {
  const profile = await getProfile(userId);
  return profile?.account_type === "admin";
}

async function requireAdmin(userId, res) {
  try {
    if (userId && await isAdmin(userId)) return true;
  } catch (error) {
    console.error("Admin authorization error:", error.message);
  }

  fail(res, 403, "Admin access required.");
  return false;
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "CPE Laptop Borrowing Backend is running"
  });
});

// REGISTER STUDENT
app.post("/api/register", async (req, res) => {
  let userId;

  try {
    const { fullName, institutionalId, email, password } = req.body;

    if (
      !fullName?.trim() ||
      !institutionalId?.trim() ||
      !email?.trim() ||
      !password
    ) {
      return fail(res, 400, "Please complete all fields.");
    }

    if (password.length < 8) {
      return fail(res, 400, "Password must be at least 8 characters.");
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { data: auth, error: authError } =
      await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true
      });

    if (authError) {
      return fail(res, 400, authError.message);
    }

    userId = auth.user.id;

    const { error: profileError } = await supabase
      .from("profiles")
      .insert({
        id: userId,
        full_name: fullName.trim(),
        institutional_id: institutionalId.trim(),
        account_type: "student"
      });

    if (profileError) {
      await supabase.auth.admin.deleteUser(userId);

      return fail(
        res,
        400,
        profileError.code === "23505"
          ? "That institutional ID is already registered."
          : "Unable to create the student profile."
      );
    }

    return res.status(201).json({
      success: true,
      message: "Registration successful. You can now log in."
    });
  } catch (error) {
    console.error("Registration error:", error);

    if (userId) {
      await supabase.auth.admin.deleteUser(userId).catch(() => {});
    }

    return fail(res, 500, "Registration failed.");
  }
});

// LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return fail(res, 400, "Email and password are required.");
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password
    });

    if (error || !data.user) {
      return fail(res, 401, "Invalid email or password.");
    }

    const profile = await getProfile(data.user.id);

    if (!profile) {
      return fail(res, 403, "Your profile was not found.");
    }

    if (!["student", "admin"].includes(profile.account_type)) {
      return fail(res, 403, "Invalid account type.");
    }

    return res.json({
      success: true,
      user: {
        id: data.user.id,
        email: data.user.email,
        fullName: profile.full_name,
        institutionalId: profile.institutional_id,
        accountType: profile.account_type
      },
      session: data.session
    });
  } catch (error) {
    console.error("Login error:", error);
    return fail(res, 500, "Login failed.");
  }
});


/* STUDENT: UPDATE OWN PROFILE */
app.patch("/api/profile/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const { fullName, institutionalId } = req.body;

    if (!fullName?.trim() || !institutionalId?.trim()) {
      return fail(res, 400, "Full name and institutional ID are required.");
    }

    const name = fullName.trim();
    const studentId = institutionalId.trim();

    if (name.length > 100 || studentId.length > 50) {
      return fail(res, 400, "Full name or institutional ID is too long.");
    }

    const profile = await getProfile(userId);

    if (!profile) {
      return fail(res, 404, "Profile not found.");
    }

    if (profile.account_type !== "student") {
      return fail(res, 403, "Only student profiles can be edited here.");
    }

    // Check whether another profile already uses this institutional ID.
    const { data: duplicate, error: duplicateError } = await supabase
      .from("profiles")
      .select("id")
      .eq("institutional_id", studentId)
      .neq("id", userId)
      .limit(1)
      .maybeSingle();

    if (duplicateError) throw duplicateError;

    if (duplicate) {
      return fail(res, 409, "That institutional ID is already registered.");
    }

    const { data: updated, error: updateError } = await supabase
      .from("profiles")
      .update({
        full_name: name,
        institutional_id: studentId
      })
      .eq("id", userId)
      .eq("account_type", "student")
      .select("id, full_name, institutional_id, account_type")
      .maybeSingle();

    if (updateError) {
      if (updateError.code === "23505") {
        return fail(res, 409, "That institutional ID is already registered.");
      }
      throw updateError;
    }

    if (!updated) {
      return fail(res, 404, "Profile could not be updated.");
    }

    return res.json({
      success: true,
      message: "Profile updated successfully.",
      profile: {
        fullName: updated.full_name,
        institutionalId: updated.institutional_id,
        accountType: updated.account_type
      }
    });
  } catch (error) {
    console.error("Profile update error:", error);
    return fail(res, 500, "Unable to update profile.");
  }
});


// PUBLIC LAPTOP LIST
app.get("/api/laptops", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("laptops")
      .select("id, laptop_name, laptop_code, status")
      .order("laptop_code");

    if (error) throw error;

    res.json({
      success: true,
      laptops: (data || []).map(l => ({
        id: l.id,
        name: l.laptop_name,
        code: l.laptop_code,
        status: l.status
      }))
    });
  } catch (error) {
    console.error("Laptop list error:", error);
    fail(res, 500, "Unable to load laptops.");
  }
});

// STUDENT REQUESTS A LAPTOP
app.post("/api/borrow", async (req, res) => {
  try {
    const { userId, laptopId } = req.body;
    if (!userId || !laptopId) {
      return fail(res, 400, "User ID and laptop ID are required.");
    }

    const profile = await getProfile(userId);
    if (!profile || profile.account_type !== "student") {
      return fail(res, 403, "Only registered students can borrow laptops.");
    }

    const { data: laptop, error: laptopError } = await supabase
      .from("laptops")
      .select("id, status")
      .eq("id", laptopId)
      .maybeSingle();

    if (laptopError) throw laptopError;
    if (!laptop) return fail(res, 404, "Laptop not found.");
    if (laptop.status !== "available") {
      return fail(res, 409, "This laptop is not available.");
    }

    const { data: existing, error: existingError } = await supabase
      .from("borrowings")
      .select("id")
      .eq("user_id", userId)
      .eq("laptop_id", laptopId)
      .in("status", ["pending", "borrowed"])
      .limit(1);

    if (existingError) throw existingError;
    if (existing?.length) {
      return fail(res, 409, "You already have a pending request or active borrowing for this laptop.");
    }

    const { error } = await supabase.from("borrowings").insert({
      user_id: userId,
      laptop_id: laptopId,
      status: "pending",
      borrowed_at: new Date().toISOString()
    });

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: "Request submitted. Wait for admin approval."
    });
  } catch (error) {
    console.error("Borrow request error:", error);
    fail(res, 500, "Unable to submit the borrowing request.");
  }
});


/* STUDENT CANCELS A PENDING REQUEST */
app.post("/api/cancel-request", async (req, res) => {
  try {
    const { userId, laptopId } = req.body;

    if (!userId || !laptopId) {
      return fail(res, 400, "User ID and laptop ID are required.");
    }

    // Verify that this is a registered student.
    const profile = await getProfile(userId);

    if (!profile || profile.account_type !== "student") {
      return fail(res, 403, "Only students can cancel requests.");
    }

    // Find the student's pending request for this laptop.
    const { data: request, error: requestError } = await supabase
      .from("borrowings")
      .select("id")
      .eq("user_id", userId)
      .eq("laptop_id", laptopId)
      .eq("status", "pending")
      .order("borrowed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (requestError) throw requestError;

    if (!request) {
      return fail(res, 404, "No pending request was found.");
    }

    // Cancel only if the request is still pending.
    const { data: cancelled, error: cancelError } = await supabase
      .from("borrowings")
      .update({ status: "cancelled" })
      .eq("id", request.id)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (cancelError) throw cancelError;

    if (!cancelled) {
      return fail(
        res,
        409,
        "The request has already been processed."
      );
    }

    return res.json({
      success: true,
      message: "Request cancelled successfully."
    });
  } catch (error) {
  console.error("Cancel request error:", error);
return fail(res, 500, "Unable to cancel the request.");
}
});


// STUDENT HISTORY
app.get("/api/borrowings/:userId", async (req, res) => {
  try {
    const profile = await getProfile(req.params.userId);
    if (!profile) return fail(res, 404, "Profile not found.");

    const { data: records, error } = await supabase
      .from("borrowings")
      .select("id, user_id, laptop_id, status, borrowed_at, returned_at")
      .eq("user_id", req.params.userId)
      .order("borrowed_at", { ascending: false });

    if (error) throw error;

    const laptopIds = [...new Set((records || []).map(r => r.laptop_id))];
    let laptopMap = new Map();

    if (laptopIds.length) {
      const result = await supabase
        .from("laptops")
        .select("id, laptop_name, laptop_code")
        .in("id", laptopIds);

      if (result.error) throw result.error;
      laptopMap = new Map((result.data || []).map(l => [l.id, l]));
    }

    const history = (records || []).map(r => {
      const laptop = laptopMap.get(r.laptop_id);

      return {
        id: r.id,
        laptopId: r.laptop_id,
        laptopName: laptop?.laptop_name || "Laptop removed",
        laptopCode: laptop?.laptop_code || "—",
        status: r.status,
        requestedAt: r.borrowed_at,
        borrowedAt: r.borrowed_at,
        returnedAt: r.returned_at
      };
    });

    res.json({ success: true, history });
  } catch (error) {
    console.error("History error:", error);
    fail(res, 500, "Unable to load borrowing history.");
  }
});

// STUDENT RETURNS A LAPTOP
app.post("/api/return", async (req, res) => {
  try {
    const { userId, laptopId } = req.body;
    if (!userId || !laptopId) {
      return fail(res, 400, "User ID and laptop ID are required.");
    }

    const { data: record, error } = await supabase
      .from("borrowings")
      .select("id")
      .eq("user_id", userId)
      .eq("laptop_id", laptopId)
      .eq("status", "borrowed")
      .order("borrowed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!record) return fail(res, 404, "No active borrowing found.");

    const { data: updated, error: updateError } = await supabase
      .from("borrowings")
      .update({
        status: "returned",
        returned_at: new Date().toISOString()
      })
      .eq("id", record.id)
      .eq("status", "borrowed")
      .select("id")
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) return fail(res, 409, "This borrowing was already processed.");

    const { error: laptopError } = await supabase
      .from("laptops")
      .update({ status: "available" })
      .eq("id", laptopId)
      .eq("status", "borrowed");

    if (laptopError) throw laptopError;

    res.json({ success: true, message: "Laptop returned successfully." });
  } catch (error) {
    console.error("Return error:", error);
    fail(res, 500, "Unable to return laptop.");
  }
});

// ADMIN: VIEW INVENTORY
app.get("/api/admin/laptops", async (req, res) => {
  try {
    if (!await requireAdmin(req.query.userId, res)) return;

    const { data, error } = await supabase
      .from("laptops")
      .select("id, laptop_name, laptop_code, status")
      .order("laptop_code");

    if (error) throw error;
    res.json({ success: true, laptops: data || [] });
  } catch (error) {
    console.error("Admin inventory error:", error);
    fail(res, 500, "Unable to load inventory.");
  }
});

// ADMIN: ADD LAPTOP
app.post("/api/admin/laptops", async (req, res) => {
  try {
    const { userId, laptopName, laptopCode } = req.body;
    if (!await requireAdmin(userId, res)) return;

    if (!laptopName?.trim() || !laptopCode?.trim()) {
      return fail(res, 400, "Laptop name and code are required.");
    }

    const { data, error } = await supabase
      .from("laptops")
      .insert({
        laptop_name: laptopName.trim(),
        laptop_code: laptopCode.trim(),
        status: "available"
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return fail(res, 409, "That laptop code already exists.");
      }
      throw error;
    }

    res.status(201).json({
      success: true,
      message: "Laptop added successfully.",
      laptop: data
    });
  } catch (error) {
    console.error("Add laptop error:", error);
    fail(res, 500, "Unable to add laptop.");
  }
});

// ADMIN: EDIT LAPTOP NAME AND CODE
app.patch("/api/admin/laptops/:id", async (req, res) => {
  try {
    const { userId, laptopName, laptopCode } = req.body;

    // Verify admin access
    if (!await requireAdmin(userId, res)) return;

    // Validate input
    if (!req.params.id || !laptopName?.trim() || !laptopCode?.trim()) {
      return fail(
        res,
        400,
        "Laptop ID, laptop name, and laptop code are required."
      );
    }

    const cleanName = laptopName.trim();
    const cleanCode = laptopCode.trim();

    if (cleanName.length > 100) {
      return fail(res, 400, "Laptop name must not exceed 100 characters.");
    }

    if (cleanCode.length > 50) {
      return fail(res, 400, "Laptop code must not exceed 50 characters.");
    }

    // Check whether the laptop exists
    const { data: existingLaptop, error: findError } = await supabase
      .from("laptops")
      .select("id")
      .eq("id", req.params.id)
      .maybeSingle();

    if (findError) throw findError;

    if (!existingLaptop) {
      return fail(res, 404, "Laptop not found.");
    }

    // Update laptop name and code
    const { data: updatedLaptop, error: updateError } = await supabase
      .from("laptops")
      .update({
        laptop_name: cleanName,
        laptop_code: cleanCode
      })
      .eq("id", req.params.id)
      .select("id, laptop_name, laptop_code, status")
      .single();

    if (updateError) {
      if (updateError.code === "23505") {
        return fail(
          res,
          409,
          "That laptop code is already being used by another laptop."
        );
      }

      throw updateError;
    }

    return res.json({
      success: true,
      message: "Laptop information updated successfully.",
      laptop: updatedLaptop
    });
  } catch (error) {
    console.error("Edit laptop error:", error);
    return fail(res, 500, "Unable to update laptop information.");
  }
});

// ADMIN: REMOVE LAPTOP
app.delete("/api/admin/laptops/:id", async (req, res) => {
  try {
    if (!await requireAdmin(req.body.userId || req.query.userId, res)) return;

    const { data: laptop, error } = await supabase
      .from("laptops")
      .select("id, status")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!laptop) return fail(res, 404, "Laptop not found.");
    if (laptop.status === "borrowed") {
      return fail(res, 409, "Cannot remove a currently borrowed laptop.");
    }

    const { data: pending, error: pendingError } = await supabase
      .from("borrowings")
      .select("id")
      .eq("laptop_id", laptop.id)
      .eq("status", "pending")
      .limit(1);

    if (pendingError) throw pendingError;
    if (pending?.length) {
      return fail(res, 409, "This laptop has a pending request.");
    }

    const { error: deleteError } = await supabase
      .from("laptops")
      .delete()
      .eq("id", laptop.id);

    if (deleteError) throw deleteError;

    res.json({ success: true, message: "Laptop removed successfully." });
  } catch (error) {
    console.error("Remove laptop error:", error);
    fail(res, 500, "Unable to remove laptop.");
  }
});

// ADMIN: VIEW PENDING REQUESTS
app.get("/api/admin/requests", async (req, res) => {
  try {
    if (!await requireAdmin(req.query.userId, res)) return;

    const { data: requests, error } = await supabase
      .from("borrowings")
      .select("id, user_id, laptop_id, status, borrowed_at")
      .eq("status", "pending")
      .order("borrowed_at", { ascending: true });

    if (error) throw error;

    const userIds = [...new Set((requests || []).map(r => r.user_id))];
    const laptopIds = [...new Set((requests || []).map(r => r.laptop_id))];

    let profileMap = new Map();
    let laptopMap = new Map();

    if (userIds.length) {
      const result = await supabase
        .from("profiles")
        .select("id, full_name, institutional_id")
        .in("id", userIds);

      if (result.error) throw result.error;
      profileMap = new Map((result.data || []).map(p => [p.id, p]));
    }

    if (laptopIds.length) {
      const result = await supabase
        .from("laptops")
        .select("id, laptop_name, laptop_code")
        .in("id", laptopIds);

      if (result.error) throw result.error;
      laptopMap = new Map((result.data || []).map(l => [l.id, l]));
    }

    const formatted = (requests || []).map(r => {
      const student = profileMap.get(r.user_id);
      const laptop = laptopMap.get(r.laptop_id);

      return {
        id: r.id,
        studentName: student?.full_name || "Unknown",
        institutionalId: student?.institutional_id || "Unknown",
        laptopName: laptop?.laptop_name || "Laptop removed",
        laptopCode: laptop?.laptop_code || "—",
        status: r.status,
        requestedAt: r.borrowed_at
      };
    });

    res.json({ success: true, requests: formatted });
  } catch (error) {
    console.error("Request list error:", error);
    fail(res, 500, "Unable to load borrow requests.");
  }
});

// ADMIN: ACCEPT OR REJECT A REQUEST
app.post("/api/admin/requests/:id", async (req, res) => {
  try {
    const { userId, decision } = req.body;
    if (!await requireAdmin(userId, res)) return;

    if (!["accept", "reject"].includes(decision)) {
      return fail(res, 400, "Decision must be accept or reject.");
    }

    const { data: request, error } = await supabase
      .from("borrowings")
      .select("id, laptop_id, status")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!request) return fail(res, 404, "Request not found.");
    if (request.status !== "pending") {
      return fail(res, 409, "This request has already been processed.");
    }

    if (decision === "reject") {
      const { data: rejected, error: rejectError } = await supabase
        .from("borrowings")
        .update({ status: "rejected" })
        .eq("id", request.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (rejectError) throw rejectError;
      if (!rejected) return fail(res, 409, "Request already processed.");

      return res.json({
        success: true,
        message: "Borrow request rejected."
      });
    }

    // Reserve the laptop only if it is still available.
    const { data: reserved, error: reserveError } = await supabase
      .from("laptops")
      .update({ status: "borrowed" })
      .eq("id", request.laptop_id)
      .eq("status", "available")
      .select("id")
      .maybeSingle();

    if (reserveError) throw reserveError;
    if (!reserved) {
      return fail(res, 409, "Laptop is no longer available.");
    }

    const { data: accepted, error: acceptError } = await supabase
      .from("borrowings")
      .update({ status: "borrowed" })
      .eq("id", request.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (acceptError || !accepted) {
      await supabase.from("laptops")
        .update({ status: "available" })
        .eq("id", request.laptop_id)
        .eq("status", "borrowed");

      if (acceptError) throw acceptError;
      return fail(res, 409, "Request was already processed.");
    }

    res.json({
      success: true,
      message: "Request accepted. Laptop is now marked as borrowed."
    });
  } catch (error) {
    console.error("Decision error:", error);
    fail(res, 500, "Unable to process the request.");
  }
});

// ADMIN: USERS
app.get("/api/admin/users", async (req, res) => {
  try {
    if (!await requireAdmin(req.query.userId, res)) return;

    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, full_name, institutional_id, account_type")
      .order("full_name");

    if (error) throw error;

    const { data: authData, error: authError } =
      await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });

    if (authError) throw authError;

    const emailMap = new Map(
      (authData.users || []).map(u => [u.id, u.email])
    );

    const users = (profiles || []).map(p => ({
      fullName: p.full_name,
      institutionalId: p.institutional_id,
      accountType: p.account_type,
      email: emailMap.get(p.id) || "—"
    }));

    res.json({ success: true, users });
  } catch (error) {
    console.error("Users error:", error);
    fail(res, 500, "Unable to load users.");
  }
});

// ADMIN: BORROWING LOGS
app.get("/api/admin/logs", async (req, res) => {
  try {
    if (!await requireAdmin(req.query.userId, res)) return;

    const { data: records, error } = await supabase
      .from("borrowings")
      .select("id, user_id, laptop_id, status, borrowed_at, returned_at")
      .order("borrowed_at", { ascending: false });

    if (error) throw error;

    const userIds = [...new Set((records || []).map(r => r.user_id))];
    const laptopIds = [...new Set((records || []).map(r => r.laptop_id))];

    let profileMap = new Map();
    let laptopMap = new Map();

    if (userIds.length) {
      const result = await supabase
        .from("profiles")
        .select("id, full_name, institutional_id")
        .in("id", userIds);

      if (result.error) throw result.error;
      profileMap = new Map((result.data || []).map(p => [p.id, p]));
    }

    if (laptopIds.length) {
      const result = await supabase
        .from("laptops")
        .select("id, laptop_name, laptop_code")
        .in("id", laptopIds);

      if (result.error) throw result.error;
      laptopMap = new Map((result.data || []).map(l => [l.id, l]));
    }

    const logs = (records || []).map(r => {
      const p = profileMap.get(r.user_id);
      const l = laptopMap.get(r.laptop_id);

      return {
        student: {
          name: p?.full_name || "Unknown",
          institutionalId: p?.institutional_id || "Unknown"
        },
        laptop: {
          name: l?.laptop_name || "Laptop removed",
          code: l?.laptop_code || "—"
        },
        status: r.status,
        borrowedAt: r.borrowed_at,
        returnedAt: r.returned_at
      };
    });

    res.json({ success: true, logs });
  } catch (error) {
    console.error("Logs error:", error);
    fail(res, 500, "Unable to load borrowing logs.");
  }
});


/* ADMIN: RECENT ACTIVITY */
app.get("/api/admin/activity", async (req, res) => {
  try {
    if (!await requireAdmin(req.query.userId, res)) return;

    const { data: records, error } = await supabase
      .from("borrowings")
      .select("id, user_id, laptop_id, status, borrowed_at, returned_at")
      .order("borrowed_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    const userIds = [...new Set((records || []).map(r => r.user_id))];
    const laptopIds = [...new Set((records || []).map(r => r.laptop_id))];

    let profileMap = new Map();
    let laptopMap = new Map();

    if (userIds.length) {
      const result = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);

      if (result.error) throw result.error;
      profileMap = new Map(
        (result.data || []).map(p => [p.id, p])
      );
    }

    if (laptopIds.length) {
      const result = await supabase
        .from("laptops")
        .select("id, laptop_name, laptop_code")
        .in("id", laptopIds);

      if (result.error) throw result.error;
      laptopMap = new Map(
        (result.data || []).map(l => [l.id, l])
      );
    }

    const activities = [];

    for (const record of records || []) {
      const student = profileMap.get(record.user_id);
      const laptop = laptopMap.get(record.laptop_id);

      const base = {
        studentName: student?.full_name || "Unknown student",
        laptopCode: laptop?.laptop_code || "Laptop",
        laptopName: laptop?.laptop_name || "Laptop removed"
      };

      if (record.status === "pending") {
        activities.push({
          ...base,
          type: "request",
          message: "requested to borrow",
          timestamp: record.borrowed_at
        });
      }

      if (record.status === "cancelled") {
        activities.push({
          ...base,
          type: "cancel",
          message: "cancelled a borrowing request for",
          timestamp: record.borrowed_at
        });
      }

      if (record.status === "borrowed") {
        activities.push({
          ...base,
          type: "approval",
          message: "had a borrowing request approved for",
          timestamp: record.borrowed_at
        });
      }

      if (record.status === "returned") {
        activities.push({
          ...base,
          type: "return",
          message: "returned",
          timestamp: record.returned_at || record.borrowed_at
        });
      }

      if (record.status === "rejected") {
        activities.push({
          ...base,
          type: "cancel",
          message: "had a borrowing request rejected for",
          timestamp: record.borrowed_at
        });
      }
    }

    activities.sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    res.json({
      success: true,
      activities: activities.slice(0, 10)
    });
  } catch (error) {
    console.error("Recent activity error:", error);
    fail(res, 500, "Unable to load recent activity.");
  }
});


app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
